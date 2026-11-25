"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { updateMemberRoleAction } from "@/lib/actions/settings";

const ROLES = ["owner", "admin", "member", "viewer"] as const;

export function MemberRoleControl({
  memberId,
  role,
  canManage,
  canGrantOwner,
  isSelf,
}: {
  memberId: string;
  role: string;
  canManage: boolean;
  canGrantOwner: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [value, setValue] = React.useState(role);

  if (!canManage || isSelf) {
    return <Badge variant={role === "owner" ? "chrome" : "outline"}>{role}</Badge>;
  }

  return (
    <div className="relative inline-flex items-center">
      <select
        value={value}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          startTransition(async () => {
            const res = await updateMemberRoleAction(memberId, next);
            if (res.error) {
              toast.error(res.error);
              setValue(role);
            } else {
              toast.success(res.message ?? "Role updated");
            }
            router.refresh();
          });
        }}
        className="h-7 rounded-md border border-hairline-strong bg-[#0D0D0D] pl-2 pr-6 text-[11px] text-ink-muted focus-visible:border-[#6B6B6B] focus-visible:outline-none disabled:opacity-60"
      >
        {ROLES.filter((r) => r !== "owner" || canGrantOwner || role === "owner").map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      {pending ? <Loader2 className="pointer-events-none absolute right-1.5 size-3 animate-spin text-ink-faint" /> : null}
    </div>
  );
}
