import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { requireSession } from "@/lib/auth";
import { alerts, approvalRequests } from "@/lib/db/schema";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const db = await getDb();

  const [alertRows, approvalRows] = await Promise.all([
    db
      .select({ count: sql<string>`count(*)` })
      .from(alerts)
      .where(and(eq(alerts.orgId, session.org.id), eq(alerts.status, "open"))),
    db
      .select({ count: sql<string>`count(*)` })
      .from(approvalRequests)
      .where(and(eq(approvalRequests.orgId, session.org.id), eq(approvalRequests.status, "pending"))),
  ]);

  return (
    <AppShell
      user={{ name: session.user.name, email: session.user.email, role: session.role }}
      org={{
        id: session.org.id,
        name: session.org.name,
        slug: session.org.slug,
        plan: session.org.plan,
        dataMode: session.org.settings.dataMode,
      }}
      memberships={session.memberships.map((m) => ({
        id: m.orgId,
        name: m.orgName,
        slug: m.orgSlug,
        plan: "",
      }))}
      alertCount={Number(alertRows[0]?.count ?? 0)}
      approvalCount={Number(approvalRows[0]?.count ?? 0)}
    >
      {children}
    </AppShell>
  );
}
