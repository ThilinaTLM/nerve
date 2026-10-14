import {
  htmlPreviewApprovalSchema,
  htmlPreviewResourceMessageSchema,
  type HtmlPreviewApproval,
} from "@nervekit/contracts/filesystem";
export type { HtmlPreviewApproval } from "@nervekit/contracts/filesystem";

export function isHtmlPreviewResourceMessage(
  event: { source: unknown; data: unknown },
  frameWindow: unknown,
  appOrigin: string,
): boolean {
  return Boolean(
    frameWindow &&
    event.source === frameWindow &&
    htmlPreviewResourceCandidate(event.data, appOrigin),
  );
}

/** A message is only an untrusted consent candidate, never authorization. */
export function htmlPreviewResourceCandidate(
  data: unknown,
  appOrigin: string,
): HtmlPreviewApproval | undefined {
  const parsed = htmlPreviewResourceMessageSchema.safeParse(data);
  if (!parsed.success) return;
  try {
    const url = new URL(parsed.data.url);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.origin === new URL(appOrigin).origin
    )
      return;
    const approval = htmlPreviewApprovalSchema.safeParse({
      origin: url.origin,
      category: parsed.data.category,
    });
    return approval.success ? approval.data : undefined;
  } catch {
    return;
  }
}
