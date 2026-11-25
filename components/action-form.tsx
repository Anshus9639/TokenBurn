"use client";

import * as React from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/lib/actions/types";

type ActionFormProps = {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  submitLabel?: string;
  pendingLabel?: string;
  className?: string;
  submitClassName?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  footer?: React.ReactNode;
  onSuccess?: (state: ActionState) => void;
  hideSubmit?: boolean;
  resetOnSuccess?: boolean;
};

export function ActionForm({
  action,
  children,
  submitLabel = "Save",
  pendingLabel = "Saving…",
  className,
  submitClassName,
  variant = "default",
  size = "default",
  footer,
  onSuccess,
  hideSubmit,
  resetOnSuccess,
}: ActionFormProps) {
  const [state, formAction, pending] = React.useActionState(action, {});
  const formRef = React.useRef<HTMLFormElement>(null);
  const lastState = React.useRef<ActionState | null>(null);

  React.useEffect(() => {
    if (lastState.current === state) return;
    lastState.current = state;
    if (state.ok) {
      toast.success(state.message ?? "Saved");
      if (resetOnSuccess) formRef.current?.reset();
      onSuccess?.(state);
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state, onSuccess, resetOnSuccess]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className={cn("space-y-4", className)}
    >
      {children}
      {state.error ? (
        <div className="flex items-start gap-2 rounded-md border border-accent-rose/30 bg-accent-rose/[0.07] px-3 py-2 text-xs leading-relaxed text-[#FDA4AF]">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      ) : null}
      {!hideSubmit ? (
        <div className={cn("flex items-center gap-2", footer)}>
          <Button type="submit" variant={variant} size={size} disabled={pending} className={submitClassName}>
            {pending ? (
              <>
                <Loader2 className="animate-spin" /> {pendingLabel}
              </>
            ) : (
              submitLabel
            )}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
