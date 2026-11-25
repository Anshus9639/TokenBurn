"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { memberships, organizations, providers, users, type OrgSettings } from "@/lib/db/schema";
import { requireAction, clientMeta, AuthError } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { envKeyName, envProviderKey } from "@/lib/providers/env-keys";
import { verifyProviderCompletion } from "@/lib/gateway/verification";
import { PROVIDERS, type Provider } from "@/lib/constants";
import type { ActionState } from "./types";

const ROLES = ["owner", "admin", "member", "viewer"] as const;
const DATA_MODES: OrgSettings["dataMode"][] = ["synthetic", "live", "hybrid"];

export async function updateOrgProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await requireAction("manage_org");
    const db = await getDb();
    const name = String(formData.get("name") ?? "").trim();
    const dataMode = String(formData.get("dataMode") ?? "synthetic") as OrgSettings["dataMode"];
    if (name.length < 2 || name.length > 80) return { error: "Organization name must be 2–80 characters." };
    if (!DATA_MODES.includes(dataMode)) return { error: "Invalid data mode." };

    const rows = await db
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, session.org.id))
      .limit(1);
    const current = rows[0]?.settings;
    const nextSettings: OrgSettings = {
      timezone: current?.timezone ?? "UTC",
      dataMode,
      allowedModels: current?.allowedModels ?? [],
      blockedModels: current?.blockedModels ?? [],
      requireApprovalForRouting: current?.requireApprovalForRouting ?? true,
      hardLimitsEnabled: current?.hardLimitsEnabled ?? false,
      fallbackModel: current?.fallbackModel ?? "openai/gpt-4o-mini",
      webhookUrl: current?.webhookUrl,
    };

    await db
      .update(organizations)
      .set({ name, settings: nextSettings })
      .where(eq(organizations.id, session.org.id));

    const meta = await clientMeta();
    await writeAudit(db, {
      orgId: session.org.id,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "org.profile_updated",
      targetType: "organization",
      targetId: session.org.id,
      summary: `Updated organization profile (${dataMode} data mode)`,
      metadata: { name, dataMode },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    revalidatePath("/settings");
    revalidatePath("/", "layout");
    return { ok: true, message: "Organization profile saved." };
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    console.error("[settings] updateProfile failed", error);
    return { error: "Could not save the organization profile." };
  }
}

export async function addMemberAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await requireAction("manage_members");
    const db = await getDb();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const role = String(formData.get("role") ?? "member");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email address." };
    if (!(ROLES as readonly string[]).includes(role)) return { error: "Invalid role." };
    if (role === "owner" && session.role !== "owner") return { error: "Only an owner can grant the owner role." };

    const userRows = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.email, email)).limit(1);
    const user = userRows[0];
    if (!user) return { error: "No TokenBurn account uses that email. Ask them to sign up first, then add them." };

    const existing = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.orgId, session.org.id), eq(memberships.userId, user.id)))
      .limit(1);
    if (existing[0]) return { error: `${user.name} is already a member of this organization.` };

    await db.insert(memberships).values({ orgId: session.org.id, userId: user.id, role });

    const meta = await clientMeta();
    await writeAudit(db, {
      orgId: session.org.id,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "member.added",
      targetType: "membership",
      targetId: user.id,
      summary: `Added ${email} as ${role}`,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    revalidatePath("/settings");
    return { ok: true, message: `${user.name} added as ${role}.` };
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    console.error("[settings] addMember failed", error);
    return { error: "Could not add the member." };
  }
}

export async function updateMemberRoleAction(memberId: string, role: string): Promise<ActionState> {
  try {
    const session = await requireAction("manage_members");
    if (!(ROLES as readonly string[]).includes(role)) return { error: "Invalid role." };
    if (role === "owner" && session.role !== "owner") return { error: "Only an owner can grant the owner role." };
    const db = await getDb();

    const rows = await db
      .select({ id: memberships.id, role: memberships.role, email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.id, memberId), eq(memberships.orgId, session.org.id)))
      .limit(1);
    const membership = rows[0];
    if (!membership) return { error: "Member not found." };
    if (membership.role === role) return { ok: true, message: "Role unchanged." };

    if (membership.role === "owner" && role !== "owner") {
      const owners = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.orgId, session.org.id), eq(memberships.role, "owner")));
      if (owners.length <= 1) return { error: "This is the last owner. Grant another owner before changing this role." };
    }

    await db.update(memberships).set({ role }).where(eq(memberships.id, memberId));

    const meta = await clientMeta();
    await writeAudit(db, {
      orgId: session.org.id,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "member.role_changed",
      targetType: "membership",
      targetId: memberId,
      summary: `Changed ${membership.email} from ${membership.role} to ${role}`,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    revalidatePath("/settings");
    return { ok: true, message: `${membership.email} is now ${role}.` };
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    console.error("[settings] updateRole failed", error);
    return { error: "Could not update the role." };
  }
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  const session = await requireAction("manage_members");
  const memberId = String(formData.get("memberId") ?? "");
  if (!memberId) return;
  const db = await getDb();

  const rows = await db
    .select({ id: memberships.id, userId: memberships.userId, role: memberships.role, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.id, memberId), eq(memberships.orgId, session.org.id)))
    .limit(1);
  const membership = rows[0];
  if (!membership) return;
  if (membership.userId === session.user.id) return;
  if (membership.role === "owner") {
    const owners = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.orgId, session.org.id), eq(memberships.role, "owner")));
    if (owners.length <= 1) return;
  }

  await db.delete(memberships).where(eq(memberships.id, memberId));

  const meta = await clientMeta();
  await writeAudit(db, {
    orgId: session.org.id,
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "member.removed",
    targetType: "membership",
    targetId: memberId,
    summary: `Removed ${membership.email} from the organization`,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  revalidatePath("/settings");
}

export async function saveProviderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await requireAction("manage_providers");
    const db = await getDb();
    const provider = String(formData.get("provider") ?? "");
    const apiKey = String(formData.get("apiKey") ?? "").trim();
    const label = String(formData.get("label") ?? "").trim() || null;
    if (!(PROVIDERS as readonly string[]).includes(provider)) return { error: "Unknown provider." };
    if (apiKey.length < 12) return { error: "That key looks too short. Paste the full provider key." };

    const encrypted = encryptSecret(apiKey);
    const last4 = apiKey.slice(-4);

    await db
      .insert(providers)
      .values({
        orgId: session.org.id,
        provider,
        status: "configured",
        credentialsEnc: encrypted,
        keyLast4: last4,
        label,
        lastSyncedAt: null,
        lastError: null,
      })
      .onConflictDoUpdate({
        target: [providers.orgId, providers.provider],
        set: {
          status: "configured",
          credentialsEnc: encrypted,
          keyLast4: last4,
          label,
          lastSyncedAt: null,
          lastError: null,
        },
      });

    const meta = await clientMeta();
    await writeAudit(db, {
      orgId: session.org.id,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "provider.credential_saved",
      targetType: "provider",
      targetId: provider,
      summary: `Stored encrypted ${provider} credential ending ${last4}`,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    revalidatePath("/settings");
    return { ok: true, message: `${provider} credential encrypted and saved.` };
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    console.error("[settings] saveProvider failed", error);
    return { error: "Could not save the provider credential." };
  }
}

export async function verifyProviderConnectionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireAction("manage_providers");
    const provider = String(formData.get("provider") ?? "");
    if (!(PROVIDERS as readonly string[]).includes(provider)) return { error: "Unknown provider." };
    const db = await getDb();

    const rows = await db
      .select({ credentialsEnc: providers.credentialsEnc })
      .from(providers)
      .where(and(eq(providers.orgId, session.org.id), eq(providers.provider, provider)))
      .limit(1);
    const row = rows[0];

    let apiKey: string | null = null;
    let keySource: "stored" | "environment" = "stored";
    if (row?.credentialsEnc) {
      try {
        apiKey = decryptSecret(row.credentialsEnc);
      } catch {
        return { error: "The stored credential could not be decrypted. Save the key again." };
      }
    } else {
      apiKey = envProviderKey(provider);
      keySource = "environment";
    }
    if (!apiKey) {
      return {
        error: `No ${provider} credential is stored and ${envKeyName(provider) ?? "the provider key variable"} is not set.`,
      };
    }

    // Real completion: proves auth, model availability, usage reporting and server-side pricing.
    const result = await verifyProviderCompletion(db, provider as Provider, apiKey);
    const checkedAt = new Date();

    await db
      .insert(providers)
      .values({
        orgId: session.org.id,
        provider,
        status: result.ok ? "verified" : "error",
        credentialsEnc: null,
        keyLast4: null,
        label: keySource === "environment" ? "Environment key" : null,
        lastSyncedAt: checkedAt,
        lastError: result.ok ? null : result.message.slice(0, 500),
      })
      .onConflictDoUpdate({
        target: [providers.orgId, providers.provider],
        set: {
          status: result.ok ? "verified" : "error",
          lastSyncedAt: checkedAt,
          lastError: result.ok ? null : result.message.slice(0, 500),
        },
      });

    const meta = await clientMeta();
    await writeAudit(db, {
      orgId: session.org.id,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: result.ok ? "provider.verification_passed" : "provider.verification_failed",
      targetType: "provider",
      targetId: provider,
      summary: result.ok
        ? `Verified ${provider} with a real completion (${result.model}, ${result.usage?.inputTokens ?? 0} in / ${result.usage?.outputTokens ?? 0} out tokens, ${result.latencyMs}ms, $${(result.costUsd ?? 0).toFixed(6)})`
        : `Completion verification failed for ${provider}: ${result.message}`,
      metadata: {
        keySource,
        status: result.status,
        model: result.model,
        attempts: result.attempts,
        latencyMs: result.latencyMs,
        inputTokens: result.usage?.inputTokens ?? null,
        cachedInputTokens: result.usage?.cachedInputTokens ?? null,
        cacheWriteTokens: result.usage?.cacheWriteTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
        reasoningTokens: result.usage?.reasoningTokens ?? null,
        costUsd: result.costUsd,
        pricingId: result.pricingId,
        pricingVersion: result.pricingVersion,
        requestId: result.requestId,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    revalidatePath("/settings");
    return result.ok
      ? { ok: true, message: `${result.message}${keySource === "environment" ? " (operator environment key)" : ""}` }
      : { error: result.message };
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    console.error("[settings] verifyProviderConnection failed", error);
    return { error: "Could not verify the provider credential." };
  }
}

export async function disconnectProviderAction(formData: FormData): Promise<void> {
  const session = await requireAction("manage_providers");
  const provider = String(formData.get("provider") ?? "");
  if (!(PROVIDERS as readonly string[]).includes(provider)) return;
  const db = await getDb();

  await db
    .update(providers)
    .set({ status: "disconnected", credentialsEnc: null, keyLast4: null, lastSyncedAt: null, lastError: null })
    .where(and(eq(providers.orgId, session.org.id), eq(providers.provider, provider)));

  const meta = await clientMeta();
  await writeAudit(db, {
    orgId: session.org.id,
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "provider.disconnected",
    targetType: "provider",
    targetId: provider,
    summary: `Removed stored ${provider} credential`,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  revalidatePath("/settings");
}
