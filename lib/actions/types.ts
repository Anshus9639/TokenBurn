export type ActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  data?: Record<string, unknown> | null;
};

export const initialActionState: ActionState = {};
