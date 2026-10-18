import { isAbsolute } from "node:path";
import type { NativeCompletionQuery } from "./binding.js";

export function prepareFileQuery(
  raw: string,
): NativeCompletionQuery | undefined {
  const value = raw.trim().replace(/^@+/, "").replaceAll("\\", "/");
  if (
    isAbsolute(value) ||
    value.startsWith("/") ||
    /^[A-Za-z]:\//.test(value) ||
    value.split("/").includes("..")
  )
    return undefined;
  const ordered = value.includes("/");
  const lower = value.toLowerCase();
  return {
    value: value,
    lower: lower,
    path: lower.replace(/\/+$/, ""),
    folder: value.endsWith("/"),
    ordered,
    terms: value
      .replace(/\/+$/, "")
      .split(ordered ? /\/+/ : /\s+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => ({ value: t, lower: t.toLowerCase() })),
  };
}
