import type { AppDb } from "@/lib/db/client";
import { auditLogs } from "@/lib/db/schema";

type AuditInput = {
  orgId: string;
  actorId?: string | null;
  actorEmail: string;
  actorType?: "user" | "api_key" | "system";
  action: string;
  targetType: string;
  targetId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
};

export async function writeAudit(db: AppDb, input: AuditInput) {
  await db.insert(auditLogs).values({
    orgId: input.orgId,
    actorId: input.actorId ?? null,
    actorEmail: input.actorEmail,
    actorType: input.actorType ?? "user",
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    summary: input.summary,
    metadata: input.metadata ?? null,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  });
}
