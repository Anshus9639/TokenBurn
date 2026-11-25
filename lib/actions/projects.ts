"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { apiKeys, environments, features, projects } from "@/lib/db/schema";
import { requireAction, clientMeta, AuthError } from "@/lib/auth";
import { generateApiKey } from "@/lib/crypto";
import { writeAudit } from "@/lib/audit";
import { slugify } from "@/lib/utils";
import type { ActionState } from "./types";

async function uniqueProjectSlug(orgId: string, base: string) {
  const db = await getDb();
  let slug = base || "project";
  let suffix = 1;
  while (
    (await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.orgId, orgId), eq(projects.slug, slug)))
      .limit(1)).length
  ) {
    slug = `${base || "project"}-${++suffix}`;
  }
  return slug;
}

export async function createProjectAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await requireAction("manage_keys");
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    if (name.length < 2) return { error: "Project name must be at least 2 characters." };

    const db = await getDb();
    const slug = await uniqueProjectSlug(session.org.id, slugify(name));
    const [project] = await db
      .insert(projects)
      .values({
        orgId: session.org.id,
        name,
        slug,
        description: description || null,
      })
      .returning({ id: projects.id, name: projects.name });
    if (!project) return { error: "Could not create the project." };

    await db.insert(environments).values([
      { orgId: session.org.id, projectId: project.id, name: "production", slug: "production" },
      { orgId: session.org.id, projectId: project.id, name: "staging", slug: "staging" },
      { orgId: session.org.id, projectId: project.id, name: "development", slug: "development" },
    ]);

    const meta = await clientMeta();
    await writeAudit(db, {
      orgId: session.org.id,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "project.created",
      targetType: "project",
      targetId: project.id,
      summary: `Created project ${project.name}.`,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    revalidatePath("/projects");
    revalidatePath("/dashboard");
    return { ok: true, message: `${project.name} created with 3 environments.` };
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    console.error("[projects] create failed", error);
    return { error: "Could not create the project." };
  }
}

export async function createFeatureAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await requireAction("manage_keys");
    const projectId = String(formData.get("projectId") ?? "");
    const rawName = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    if (!projectId) return { error: "Missing project." };
    const name = slugify(rawName);
    if (name.length < 2) return { error: "Feature name must contain at least 2 letters." };

    const db = await getDb();
    const projectRows = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.orgId, session.org.id)))
      .limit(1);
    if (!projectRows[0]) return { error: "Project not found." };

    const existing = await db
      .select({ id: features.id })
      .from(features)
      .where(and(eq(features.projectId, projectId), eq(features.name, name)))
      .limit(1);
    if (existing.length) return { error: `A feature named "${name}" already exists.` };

    await db.insert(features).values({
      orgId: session.org.id,
      projectId,
      name,
      description: description || null,
    });

    const meta = await clientMeta();
    await writeAudit(db, {
      orgId: session.org.id,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "feature.created",
      targetType: "feature",
      targetId: projectId,
      summary: `Created feature ${name} in ${projectRows[0].name}.`,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    revalidatePath(`/projects/${projectId}`);
    return { ok: true, message: `Feature ${name} attached. Events tagged "${name}" will attribute automatically.` };
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    console.error("[projects] createFeature failed", error);
    return { error: "Could not create the feature." };
  }
}

export async function createApiKeyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await requireAction("manage_keys");
    const projectId = String(formData.get("projectId") ?? "");
    const environmentId = String(formData.get("environmentId") ?? "") || null;
    const name = String(formData.get("name") ?? "").trim();
    const kind = String(formData.get("kind") ?? "live") === "test" ? "test" : "live";
    if (!projectId) return { error: "Missing project." };
    if (name.length < 2) return { error: "Give the key a descriptive name." };

    const db = await getDb();
    const projectRows = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.orgId, session.org.id)))
      .limit(1);
    if (!projectRows[0]) return { error: "Project not found." };

    if (environmentId) {
      const envRows = await db
        .select({ id: environments.id })
        .from(environments)
        .where(and(eq(environments.id, environmentId), eq(environments.projectId, projectId)))
        .limit(1);
      if (!envRows[0]) return { error: "Environment not found for this project." };
    }

    const generated = generateApiKey(kind);
    const [key] = await db
      .insert(apiKeys)
      .values({
        orgId: session.org.id,
        projectId,
        environmentId,
        name,
        prefix: generated.prefix,
        lastFour: generated.lastFour,
        hash: generated.hash,
        createdBy: session.user.email,
      })
      .returning({ id: apiKeys.id });

    const meta = await clientMeta();
    await writeAudit(db, {
      orgId: session.org.id,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "api_key.created",
      targetType: "api_key",
      targetId: key?.id ?? null,
      summary: `Created ${kind} key "${name}" for ${projectRows[0].name}.`,
      metadata: { prefix: generated.prefix, lastFour: generated.lastFour },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/explorer");
    return {
      ok: true,
      message: "API key created. Copy it now — it is shown once.",
      data: { id: key?.id, token: generated.plaintext, prefix: generated.prefix },
    };
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    console.error("[projects] createKey failed", error);
    return { error: "Could not create the API key." };
  }
}

export async function revokeApiKeyAction(formData: FormData): Promise<void> {
  const session = await requireAction("manage_keys");
  const keyId = String(formData.get("keyId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  if (!keyId || !projectId) return;
  const db = await getDb();
  const rows = await db
    .select({ id: apiKeys.id, name: apiKeys.name })
    .from(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.orgId, session.org.id), eq(apiKeys.projectId, projectId)))
    .limit(1);
  if (!rows[0]) return;

  await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, keyId));
  const meta = await clientMeta();
  await writeAudit(db, {
    orgId: session.org.id,
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "api_key.revoked",
    targetType: "api_key",
    targetId: keyId,
    summary: `Revoked key "${rows[0].name}".`,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/explorer");
}
