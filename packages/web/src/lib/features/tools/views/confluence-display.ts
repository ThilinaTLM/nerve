export type ConfluenceTone =
  | "default"
  | "success"
  | "warning"
  | "info"
  | "muted";

export function confluenceStatusTone(
  status: string | undefined,
): ConfluenceTone {
  const normalized = status?.trim().toLowerCase();
  if (!normalized) return "muted";
  if (normalized === "current") return "success";
  if (normalized === "draft") return "warning";
  if (normalized === "archived" || normalized === "deleted") return "muted";
  return "info";
}

export function confluenceOutcomeTone(
  status: string | undefined,
): ConfluenceTone {
  const normalized = status?.trim().toLowerCase();
  if (normalized === "created" || normalized === "updated") return "success";
  if (normalized === "dry_run" || normalized === "skipped") return "warning";
  if (normalized === "error") return "warning";
  return "muted";
}

export function confluencePageUrl(
  siteUrl: string | undefined,
  webui: string | undefined,
): string | undefined {
  if (!webui) return undefined;
  if (/^https?:\/\//i.test(webui)) return webui;
  if (!siteUrl) return undefined;
  return `${siteUrl.replace(/\/+$/, "")}${webui.startsWith("/") ? "" : "/"}${webui}`;
}

export function confluenceInitials(value: string | undefined): string {
  const text = value?.trim();
  if (!text) return "CF";
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase() || "CF";
}

export function confluenceBytesLabel(
  value: number | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
