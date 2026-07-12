import { createHash } from "node:crypto";
import { canonicalJson } from "../config/digest.js";

export function sandboxSha256Digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}
