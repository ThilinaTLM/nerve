import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time string comparison; hashing equalizes lengths first. */
export function tokensEqual(
  candidate: string | null | undefined,
  token: string,
): boolean {
  if (typeof candidate !== "string") return false;
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(token).digest();
  return timingSafeEqual(a, b);
}
