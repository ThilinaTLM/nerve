/* eslint-disable @typescript-eslint/no-explicit-any -- polyfills extend the sandbox's global object */
/*
 * Plain-data wire format shared by the sandbox runtimes (`extension-runtime.ts`,
 * `credential-runtime.ts`) and the host adapters: bytes travel as `{ $nerve: "bytes", base64 }`.
 * Importing this module also gives the engine the `TextEncoder`/`TextDecoder` it lacks.
 */

const g = globalThis as any;

// ── UTF-8 (the engine has no TextEncoder/TextDecoder) ───────────────────────

if (typeof g.TextEncoder === "undefined") {
  g.TextEncoder = class TextEncoder {
    readonly encoding = "utf-8";
    encode(input = ""): Uint8Array {
      const text = String(input);
      const out: number[] = [];
      for (let index = 0; index < text.length; index++) {
        let code = text.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
          const next = text.charCodeAt(index + 1);
          if (next >= 0xdc00 && next <= 0xdfff) {
            code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
            index++;
          }
        }
        if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
        if (code < 0x80) out.push(code);
        else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
        else if (code < 0x10000)
          out.push(
            0xe0 | (code >> 12),
            0x80 | ((code >> 6) & 63),
            0x80 | (code & 63),
          );
        else
          out.push(
            0xf0 | (code >> 18),
            0x80 | ((code >> 12) & 63),
            0x80 | ((code >> 6) & 63),
            0x80 | (code & 63),
          );
      }
      return Uint8Array.from(out);
    }
  };
}

if (typeof g.TextDecoder === "undefined") {
  g.TextDecoder = class TextDecoder {
    readonly encoding = "utf-8";
    decode(input?: ArrayBufferView | ArrayBuffer): string {
      if (input === undefined) return "";
      const bytes = ArrayBuffer.isView(input)
        ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
        : new Uint8Array(input);
      let out = "";
      for (let index = 0; index < bytes.length;) {
        const first = bytes[index++];
        let code = 0xfffd;
        let extra = 0;
        if (first < 0x80) code = first;
        else if (first >= 0xc2 && first < 0xe0) {
          code = first & 31;
          extra = 1;
        } else if (first >= 0xe0 && first < 0xf0) {
          code = first & 15;
          extra = 2;
        } else if (first >= 0xf0 && first < 0xf5) {
          code = first & 7;
          extra = 3;
        }
        for (let step = 0; step < extra; step++) {
          const next = bytes[index];
          if (next === undefined || (next & 0xc0) !== 0x80) {
            code = 0xfffd;
            break;
          }
          code = (code << 6) | (next & 63);
          index++;
        }
        if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
          code = 0xfffd;
        out += String.fromCodePoint(code);
      }
      return out;
    }
  };
}

// ── Wire format ──────────────────────────────────────────────────────────────

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function toBase64(bytes: Uint8Array): string {
  if (typeof g.btoa === "function") {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000)
      binary += String.fromCharCode.apply(
        null,
        bytes.subarray(index, index + 0x8000) as unknown as number[],
      );
    return g.btoa(binary);
  }
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    out += ALPHABET[a >> 2] + ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out +=
      b === undefined
        ? "=="
        : ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)] +
          (c === undefined ? "=" : ALPHABET[c & 63]);
  }
  return out;
}

export function fromBase64(text: string): Uint8Array {
  if (typeof g.atob === "function") {
    const binary: string = g.atob(text);
    const out = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++)
      out[index] = binary.charCodeAt(index);
    return out;
  }
  const clean = text.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let position = 0;
  for (let index = 0; index < clean.length; index++) {
    buffer = (buffer << 6) | ALPHABET.indexOf(clean[index]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[position++] = (buffer >> bits) & 255;
    }
  }
  return out;
}

/** Plain data out: bytes become the tagged envelope; everything else is JSON data. */
export function encode(value: unknown): unknown {
  if (value instanceof ArrayBuffer)
    return { $nerve: "bytes", base64: toBase64(new Uint8Array(value)) };
  if (ArrayBuffer.isView(value))
    return {
      $nerve: "bytes",
      base64: toBase64(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      ),
    };
  if (Array.isArray(value)) return value.map(encode);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) out[key] = encode(entry);
    return out;
  }
  return value;
}

export function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.$nerve === "bytes" && typeof record.base64 === "string")
      return fromBase64(record.base64);
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record)) out[key] = decode(entry);
    return out;
  }
  return value;
}
