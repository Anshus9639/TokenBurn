import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb, type AppDb } from "@/lib/db/client";
import {
  apiKeys,
  memberships,
  organizations,
  sessions,
  users,
  type OrgSettings,
} from "@/lib/db/schema";
import { hashApiKey, sha256 } from "@/lib/crypto";
import { rateLimit } from "@/lib/cache";
import { trustProxyHeaders } from "@/lib/env";
import { ROLE_RANK, type Role } from "@/lib/constants";

export const SESSION_COOKIE = "tb_session";
const SESSION_DAYS = 30;

export type SessionContext = {
  user: { id: string; email: string; name: string; jobTitle: string | null };
  org: { id: string; name: string; slug: string; plan: string; settings: OrgSettings };
  role: Role;
  sessionId: string;
  memberships: Array<{ orgId: string; orgName: string; orgSlug: string; role: Role }>;
};

export class AuthError extends Error {
  code: string;
  constructor(message: string, code = "unauthorized") {
    super(message);
    this.code = code;
  }
}

export async function createSession(userId: string, orgId: string, ip?: string, userAgent?: string) {
  const db = await getDb();
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({
    id: sha256(token),
    userId,
    activeOrgId: orgId,
    expiresAt,
    ip,
    userAgent,
  });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return token;
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.id, sha256(token)));
  }
  store.delete(SESSION_COOKIE);
}

export async function getSession(): Promise<SessionContext | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const rows = await db
    .select({
      sessionId: sessions.id,
      activeOrgId: sessions.activeOrgId,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      email: users.email,
      name: users.name,
      jobTitle: users.jobTitle,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sha256(token)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, row.sessionId));
    return null;
  }

  const membershipRows = await db
    .select({
      orgId: organizations.id,
      orgName: organizations.name,
      orgSlug: organizations.slug,
      role: memberships.role,
      plan: organizations.plan,
      settings: organizations.settings,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(eq(memberships.userId, row.userId))
    .orderBy(asc(memberships.createdAt));

  if (!membershipRows.length) return null;
  const active =
    membershipRows.find((m) => m.orgId === row.activeOrgId) ?? membershipRows[0]!;

  return {
    user: { id: row.userId, email: row.email, name: row.name, jobTitle: row.jobTitle },
    org: {
      id: active.orgId,
      name: active.orgName,
      slug: active.orgSlug,
      plan: active.plan,
      settings: active.settings,
    },
    role: active.role as Role,
    sessionId: row.sessionId,
    memberships: membershipRows.map((m) => ({
      orgId: m.orgId,
      orgName: m.orgName,
      orgSlug: m.orgSlug,
      role: m.role as Role,
    })),
  };
}

export async function requireSession(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function switchOrg(orgId: string) {
  const session = await getSession();
  if (!session) throw new AuthError("Sign in required");
  const allowed = session.memberships.some((m) => m.orgId === orgId);
  if (!allowed) throw new AuthError("You are not a member of that organization");
  const db = await getDb();
  await db.update(sessions).set({ activeOrgId: orgId }).where(eq(sessions.id, session.sessionId));
}

export function can(role: Role, action: string): boolean {
  const rank = ROLE_RANK[role];
  switch (action) {
    case "view":
      return rank >= 1;
    case "ingest":
      return rank >= 2;
    case "create_policy":
      return rank >= 2;
    case "manage_keys":
      return rank >= 2;
    case "ack_alerts":
      return rank >= 2;
    case "manage_budgets":
      return rank >= 3;
    case "manage_rules":
      return rank >= 3;
    case "manage_providers":
      return rank >= 3;
    case "manage_members":
      return rank >= 3;
    case "approve":
      return rank >= 3;
    case "manage_org":
      return rank >= 4;
    default:
      return false;
  }
}

export async function requireAction(action: string): Promise<SessionContext> {
  const session = await requireSession();
  if (!can(session.role, action)) {
    throw new AuthError(`Your role (${session.role}) cannot perform this action`, "forbidden");
  }
  return session;
}

export async function clientMeta() {
  const h = await headers();
  const forwarded = trustProxyHeaders() ? h.get("x-forwarded-for")?.split(",")[0]?.trim() : undefined;
  return {
    ip: forwarded ?? h.get("x-real-ip") ?? "127.0.0.1",
    userAgent: h.get("user-agent") ?? "unknown",
  };
}

export type ApiKeyContext = {
  orgId: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  environment: string | null;
  apiKeyId: string;
  apiKeyName: string;
  rateLimit: { ok: boolean; remaining: number; resetAt: number };
};

export async function authenticateApiKey(request: Request): Promise<ApiKeyContext> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new AuthError("Missing bearer token. Pass a TokenBurn project key.", "missing_key");

  const limit = await rateLimit(`key:${sha256(token)}`, 300, 60_000);
  if (!limit.ok) throw new AuthError("Rate limit exceeded for this key (300 req/min)", "rate_limited");

  const db = await getDb();
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      orgId: apiKeys.orgId,
      projectId: apiKeys.projectId,
      environmentId: apiKeys.environmentId,
      revokedAt: apiKeys.revokedAt,
      hash: apiKeys.hash,
      requestCount: apiKeys.requestCount,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.hash, hashApiKey(token)), isNull(apiKeys.revokedAt)))
    .limit(1);

  const key = rows[0];
  if (!key) throw new AuthError("Invalid or revoked API key", "invalid_key");

  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date(), requestCount: key.requestCount + 1 })
    .where(eq(apiKeys.id, key.id));

  let environmentName: string | null = null;
  const { projects, environments } = await import("@/lib/db/schema");
  const projectRows = await db
    .select({ id: projects.id, slug: projects.slug, name: projects.name })
    .from(projects)
    .where(and(eq(projects.id, key.projectId), eq(projects.orgId, key.orgId)))
    .limit(1);
  const project = projectRows[0];
  if (key.environmentId) {
    const envRows = await db
      .select({ name: environments.name })
      .from(environments)
      .where(and(eq(environments.id, key.environmentId), eq(environments.projectId, key.projectId)))
      .limit(1);
    environmentName = envRows[0]?.name ?? null;
  }

  if (!project) throw new AuthError("API key is not attached to a valid project", "invalid_project");

  return {
    orgId: key.orgId,
    projectId: key.projectId,
    projectSlug: project.slug,
    projectName: project.name,
    environment: environmentName,
    apiKeyId: key.id,
    apiKeyName: key.name,
    rateLimit: { ok: limit.ok, remaining: limit.remaining, resetAt: limit.resetAt },
  };
}

export async function getOrgRole(db: AppDb, orgId: string, userId: string): Promise<Role | null> {
  const rows = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
    .limit(1);
  return (rows[0]?.role as Role | undefined) ?? null;
}
