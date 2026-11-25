"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ActionForm } from "@/components/action-form";
import type { ActionState } from "@/lib/actions/types";

type DialogFormProps = {
  trigger: React.ReactNode;
  title: string;
  description?: string;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel?: string;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
};

export function DialogForm({
  trigger,
  title,
  description,
  action,
  submitLabel,
  children,
  className,
  resetOnSuccess = true,
}: DialogFormProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className={className}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="px-6 py-5">
          <ActionForm
            action={action}
            submitLabel={submitLabel}
            resetOnSuccess={resetOnSuccess}
            onSuccess={() => setOpen(false)}
            className="space-y-4"
          >
            {children}
          </ActionForm>
        </div>
      </DialogContent>
    </Dialog>
  );
}
