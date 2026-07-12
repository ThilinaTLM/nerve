import { z } from "zod";

const secretLikeKey =
  /(?:^|[_-])(authorization|cookie|credential|password|passwd|secret|token|api[_-]?key|private[_-]?key)(?:$|[_-])/i;
const credentialUrl = /^[a-z][a-z0-9+.-]*:\/\/[^/\s]*@/i;
const maximumBytes = 64 * 1024;
const maximumDepth = 8;
const maximumEntries = 256;
const maximumStringLength = 16_384;

function boundedPublicJson() {
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
      if (bytes > maximumBytes) {
        context.addIssue({
          code: "custom",
          message: `public data may not exceed ${maximumBytes} bytes`,
        });
      }
      validateValue(value, context, [], 0);
    });
}

/** Safety guard composed before every concrete public event payload schema. */
export const publicEventDataGuardSchema = boundedPublicJson();

/** Bounded JSON for provider/domain values whose shape is intentionally opaque. */
export const boundedPublicJsonSchema = boundedPublicJson();

export const boundedPublicObjectSchema = z
  .preprocess(
    stripUndefined,
    z.record(z.string().min(1).max(128), boundedPublicJsonSchema),
  )
  .superRefine((value, context) => {
    validateValue(value, context, [], 0);
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
    if (value.length > maximumStringLength)
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
      validateValue(entry, context, [...path, index], depth + 1),
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
    validateValue(entry, context, [...path, key], depth + 1);
  }
}
