import { z } from "zod";

const secretLikeKey =
  /(?:^|[_-])(authorization|cookie|credential|password|passwd|secret|token|api[_-]?key|private[_-]?key)(?:$|[_-])/i;
const credentialUrl = /^[a-z][a-z0-9+.-]*:\/\/[^/\s]*@/i;
export const PUBLIC_EVENT_MAX_BYTES = 64 * 1024;
export const PUBLIC_EVENT_MAX_STRING_CHARS = 16_384;
/**
 * Total byte ceiling for events whose payloads carry authoritative content
 * (e.g. conversation entries with message text and thinking blocks). Content
 * is unbounded by nature, so such payloads keep the overall byte bound for
 * broadcast safety but drop the per-string length cap.
 */
export const PUBLIC_EVENT_MAX_CONTENT_BYTES = 1024 * 1024;

const maximumDepth = 12;
const maximumEntries = 256;

function boundedPublicJson(
  maxBytes: number,
  maxStringChars: number | undefined,
) {
  return z
    .preprocess(stripUndefined, z.json())
    .superRefine((value, context) => {
      let bytes: number;
      try {
        bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
      } catch {
        context.addIssue({
          code: "custom",
          message: "public data must be JSON-safe",
        });
        return;
      }
      if (bytes > maxBytes) {
        context.addIssue({
          code: "custom",
          message: `public data may not exceed ${maxBytes} bytes`,
        });
      }
      validateValue(value, context, [], 0, maxStringChars);
    });
}

/** Safety guard composed before every concrete public event payload schema. */
export const publicEventDataGuardSchema = boundedPublicJson(
  PUBLIC_EVENT_MAX_BYTES,
  PUBLIC_EVENT_MAX_STRING_CHARS,
);

/** Bounded JSON for provider/domain values whose shape is intentionally opaque. */
export const boundedPublicJsonSchema = boundedPublicJson(
  PUBLIC_EVENT_MAX_BYTES,
  PUBLIC_EVENT_MAX_STRING_CHARS,
);

/**
 * Content-sized guard for events that carry authoritative content payloads
 * (e.g. conversation entries). Keeps the total byte ceiling and the shape
 * checks, but drops the per-string length cap so single long strings (message
 * text, thinking blocks) are not rejected.
 */
export const boundedPublicContentJsonSchema = boundedPublicJson(
  PUBLIC_EVENT_MAX_CONTENT_BYTES,
  undefined,
);

export const boundedPublicObjectSchema = z
  .preprocess(
    stripUndefined,
    z.record(z.string().min(1).max(128), boundedPublicJsonSchema),
  )
  .superRefine((value, context) => {
    validateValue(value, context, [], 0, PUBLIC_EVENT_MAX_STRING_CHARS);
    if (Object.keys(value).length > maximumEntries) {
      context.addIssue({
        code: "custom",
        message: `public objects may contain at most ${maximumEntries} fields`,
      });
    }
  });

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, stripUndefined(entry)]),
  );
}

function validateValue(
  value: unknown,
  context: z.core.$RefinementCtx<unknown>,
  path: PropertyKey[],
  depth: number,
  maxStringChars: number | undefined,
): void {
  if (depth > maximumDepth) {
    context.addIssue({
      code: "custom",
      path,
      message: "public data is too deep",
    });
    return;
  }
  if (typeof value === "string") {
    if (maxStringChars !== undefined && value.length > maxStringChars)
      context.addIssue({
        code: "custom",
        path,
        message: "public text is too long",
      });
    if (credentialUrl.test(value))
      context.addIssue({
        code: "custom",
        path,
        message: "credential-bearing URLs are forbidden",
      });
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > maximumEntries)
      context.addIssue({
        code: "custom",
        path,
        message: "public arrays are too large",
      });
    value.forEach((entry, index) =>
      validateValue(
        entry,
        context,
        [...path, index],
        depth + 1,
        maxStringChars,
      ),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > maximumEntries)
    context.addIssue({
      code: "custom",
      path,
      message: "public objects are too large",
    });
  for (const [key, entry] of entries) {
    if (secretLikeKey.test(key)) {
      context.addIssue({
        code: "custom",
        path: [...path, key],
        message: "secret-like public data keys are forbidden",
      });
    }
    validateValue(entry, context, [...path, key], depth + 1, maxStringChars);
  }
}
