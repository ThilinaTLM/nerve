import type { StatusTone } from "@nervekit/ui-kit/display/status";

export function confluenceStatusBadgeVariant(
  status: string | undefined,
): StatusTone {
  return confluenceStatusTone(status);
}

export function confluenceStatusTone(status: string | undefined): StatusTone {
  const normalized = status?.trim().toLowerCase();
  if (!normalized) return "neutral";
  if (normalized === "current") return "success";
  if (normalized === "draft") return "warning";
  if (normalized === "archived" || normalized === "deleted") return "neutral";
  return "info";
}

export function confluencePageUrl(
  siteUrl: string | undefined,
  webui: string | undefined,
): string | undefined {
  if (!webui) return undefined;
  if (/^https?:\/\//i.test(webui)) return webui;
  if (!siteUrl) return undefined;

  const baseUrl = siteUrl.replace(/\/+$/, "").replace(/\/wiki$/i, "");
  const path = webui.startsWith("/") ? webui : `/${webui}`;
  const wikiPath =
    path === "/wiki" || path.startsWith("/wiki/") ? path : `/wiki${path}`;
  return `${baseUrl}${wikiPath}`;
}
