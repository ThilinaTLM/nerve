export function encode(value: unknown): Uint8Array {
  return Buffer.from(JSON.stringify(value), "utf8");
}

export function decode(value: Uint8Array | string): unknown {
  const text =
    typeof value === "string" ? value : Buffer.from(value).toString("utf8");
  return JSON.parse(text) as unknown;
}
