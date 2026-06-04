export type IdPrefix =
  | "daemon"
  | "evt"
  | "proj"
  | "ses"
  | "agent"
  | "run"
  | "proc"
  | "entry"
  | "tool"
  | "approval"
  | "question"
  | "plan_review"
  | "worker"
  | "authflow";

const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(time: number, length: number): string {
  let value = time;
  let output = "";
  for (let i = length - 1; i >= 0; i -= 1) {
    output = crockford[value % 32] + output;
    value = Math.floor(value / 32);
  }
  return output;
}

function encodeRandom(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let output = "";
  for (const byte of bytes) {
    output += crockford[byte % 32];
  }
  return output;
}

export function createId(prefix: IdPrefix): `${IdPrefix}_${string}` {
  return `${prefix}_${encodeTime(Date.now(), 10)}${encodeRandom(16)}`;
}

export function parseCookieHeader(
  header: string | null | undefined,
): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName) continue;
    cookies[rawName] = decodeURIComponent(rawValue.join("="));
  }
  return cookies;
}
