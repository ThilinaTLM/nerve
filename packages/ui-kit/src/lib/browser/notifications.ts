import { toast as sonnerToast } from "svelte-sonner";

type NotifyKind = "success" | "error" | "message";

export type NotifyOptions = {
  description?: string;
};

function showToast(
  kind: NotifyKind,
  title: string,
  description?: string,
): void {
  const options = description ? { description } : undefined;
  if (kind === "success") sonnerToast.success(title, options);
  else if (kind === "error") sonnerToast.error(title, options);
  else sonnerToast(title, options);
}

/**
 * Lightweight, non-interruptive in-app toast feedback shared across Nerve apps.
 * Renders through the app-mounted `<Toaster />` (svelte-sonner singleton).
 */
export const notify = {
  success(title: string, options: NotifyOptions = {}): void {
    showToast("success", title, options.description);
  },
  error(title: string, options: NotifyOptions = {}): void {
    showToast("error", title, options.description);
  },
  message(title: string, options: NotifyOptions = {}): void {
    showToast("message", title, options.description);
  },
};

export function notifyCopyResult(ok: boolean, label = "code block"): void {
  if (ok) notify.success(`Copied ${label}`);
  else notify.error(`Could not copy ${label}`);
}
