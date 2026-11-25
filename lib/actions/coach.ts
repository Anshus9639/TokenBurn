"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { requireAction, clientMeta } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { refreshRecommendations, markRecommendation, askCoach } from "@/lib/coach";
import { rateLimit } from "@/lib/cache";
import type { ActionState } from "./types";

export async function refreshCoachAction(): Promise<ActionState> {
  try {
    const session = await requireAction("manage_budgets");
    const db = await getDb();
    const rows = await refreshRecommendations(db, session.org.id, true);
    const meta = await clientMeta();
    await writeAudit(db, {
      orgId: session.org.id,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "coach.refresh",
      targetType: "recommendation",
      summary: `Re-ran usage analysis; ${rows.filter((r) => r.status === "new").length} open findings`,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    revalidatePath("/coach");
    revalidatePath("/dashboard");
    return { ok: true, message: `Analysis refreshed — ${rows.filter((r) => r.status === "new").length} open findings` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not refresh analysis." };
  }
}

export async function decideRecommendationAction(
  id: string,
  decision: "accepted" | "dismissed",
): Promise<ActionState> {
  try {
    const session = await requireAction("manage_budgets");
    const db = await getDb();
    await markRecommendation(db, session.org.id, id, decision);
    const meta = await clientMeta();
    await writeAudit(db, {
      orgId: session.org.id,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: `coach.${decision}`,
      targetType: "recommendation",
      targetId: id,
      summary: decision === "accepted" ? "Accepted a cost recommendation" : "Dismissed a cost recommendation",
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    revalidatePath("/coach");
    revalidatePath("/dashboard");
    return { ok: true, message: decision === "accepted" ? "Marked as accepted" : "Dismissed" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not update the recommendation." };
  }
}

export async function askCoachAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await requireAction("view");
    const question = String(formData.get("question") ?? "").trim();
    if (question.length < 4) return { error: "Ask a slightly longer question." };
    if (question.length > 500) return { error: "Keep questions under 500 characters." };
    const limit = await rateLimit(`coach:${session.user.id}`, 20, 60 * 60_000);
    if (!limit.ok) return { error: "Coach rate limit reached. Try again in a few minutes." };

    const db = await getDb();
    const result = await askCoach(db, session.org.id, question);
    return {
      ok: true,
      data: {
        answer: result.answer,
        source: result.source,
        cited: result.citedRecommendationIds,
        question,
      },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "The coach could not answer that." };
  }
}
