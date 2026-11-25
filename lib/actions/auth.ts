"use server";

import { redirect } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  environments,
  memberships,
  organizations,
  projects,
  users,
  budgets,
  auditLogs,
  type OrgSettings,
} from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { rateLimit } from "@/lib/cache";
import { clientMeta, createSession, destroySession, switchOrg } from "@/lib/auth";
import { slugify } from "@/lib/utils";
import type { ActionState } from "./types";

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are required." };

  const meta = await clientMeta();
  const limit = await rateLimit(`login:${meta.ip}:${email}`, 10, 5 * 60_000);
  if (!limit.ok) return { error: "Too many sign-in attempts. Try again in a few minutes." };
  // Second bucket keyed on the account only, so rotating a spoofed forwarding header
  // cannot reset the per-IP window.
  const accountLimit = await rateLimit(`login-account:${email}`, 20, 15 * 60_000);
  if (!accountLimit.ok) return { error: "Too many sign-in attempts for this account. Try again later." };

  const db = await getDb();
  const rows = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  const user = rows[0];
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return { error: "Invalid email or password." };
  }

  const membershipRows = await db
    .select({ orgId: memberships.orgId })
    .from(memberships)
    .where(eq(memberships.userId, user.id))
    .orderBy(asc(memberships.createdAt))
    .limit(1);
  if (!membershipRows[0]) return { error: "This account is not attached to an organization." };

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await createSession(user.id, membershipRows[0].orgId, meta.ip, meta.userAgent);
  await db.insert(auditLogs).values({
    orgId: membershipRows[0].orgId,
    actorId: user.id,
    actorEmail: user.email,
    actorType: "user",
    action: "auth.login",
    targetType: "session",
    summary: `${user.name} signed in.`,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  redirect("/dashboard");
}

export async function signupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const orgName = String(formData.get("orgName") ?? "").trim();

  if (name.length < 2) return { error: "Enter your full name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid work email." };
  if (password.length < 10) return { error: "Use at least 10 characters for your password." };
  if (orgName.length < 2) return { error: "Enter an organization name." };

  const meta = await clientMeta();
  const limit = await rateLimit(`signup:${meta.ip}`, 5, 60 * 60_000);
  if (!limit.ok) return { error: "Too many sign-up attempts from this address." };

  const db = await getDb();
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  if (existing.length) return { error: "An account with that email already exists." };

  let slug = slugify(orgName) || "workspace";
  let suffix = 1;
  while (
    (await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug)).limit(1)).length
  ) {
    slug = `${slugify(orgName) || "workspace"}-${++suffix}`;
  }

  const settings: OrgSettings = {
    timezone: "UTC",
    dataMode: "live",
    allowedModels: [],
    blockedModels: [],
    requireApprovalForRouting: true,
    hardLimitsEnabled: false,
    fallbackModel: "openai/gpt-4.1-mini",
  };

  const [org] = await db
    .insert(organizations)
    .values({ name: orgName, slug, plan: "starter", settings })
    .returning({ id: organizations.id });
  if (!org) return { error: "Could not create the organization. Try again." };

  const [user] = await db
    .insert(users)
    .values({ email, name, passwordHash: hashPassword(password), lastLoginAt: new Date() })
    .returning({ id: users.id });
  if (!user) return { error: "Could not create the account. Try again." };

  await db.insert(memberships).values({ orgId: org.id, userId: user.id, role: "owner" });

  const [starter] = await db
    .insert(projects)
    .values({
      orgId: org.id,
      name: "First Project",
      slug: "first-project",
      description: "Created automatically. Rename it or add another project.",
    })
    .returning({ id: projects.id });
  if (starter) {
    await db.insert(environments).values([
      { orgId: org.id, projectId: starter.id, name: "production", slug: "production" },
      { orgId: org.id, projectId: starter.id, name: "development", slug: "development" },
    ]);
    await db.insert(budgets).values({
      orgId: org.id,
      name: "Organization monthly budget",
      scope: "organization",
      period: "monthly",
      limitUsd: "100.00",
      thresholds: [50, 75, 90, 100],
      createdBy: email,
    });
  }

  await db.insert(auditLogs).values({
    orgId: org.id,
    actorId: user.id,
    actorEmail: email,
    action: "org.created",
    targetType: "organization",
    targetId: org.id,
    summary: `${name} created ${orgName}.`,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  await createSession(user.id, org.id, meta.ip, meta.userAgent);
  redirect("/dashboard");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function switchOrgAction(formData: FormData) {
  const orgId = String(formData.get("orgId") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "/dashboard");
  if (orgId) await switchOrg(orgId);
  redirect(returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/dashboard");
}
