import { modelSelectionSchema } from "../models/models.js";
import type { SettingField, SettingsSchema } from "./settings-schema.js";

export type SettingIssue = {
  code: "unknown-field" | "invalid-value";
  field: string;
  message: string;
};

export type FieldValidation =
  | { ok: true; value: unknown }
  | { ok: false; message: string };

/** Public Kroki-style server URL: HTTP(S), no credentials, query or fragment; a trailing slash is added. */
function normalizeServerUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return undefined;
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    return url.href;
  } catch {
    return undefined;
  }
}

export function validateField(
  field: SettingField,
  value: unknown,
): FieldValidation {
  const fail = (message: string): FieldValidation => ({ ok: false, message });
  switch (field.type) {
    case "boolean":
      return typeof value === "boolean"
        ? { ok: true, value }
        : fail("Expected true or false.");
    case "string": {
      if (typeof value !== "string") return fail("Expected text.");
      const text = value.trim();
      if (field.maxLength !== undefined && text.length > field.maxLength)
        return fail(`At most ${field.maxLength} characters.`);
      if (field.format === "url") {
        const url = normalizeServerUrl(text);
        return url
          ? { ok: true, value: url }
          : fail(
              "Use an HTTP(S) URL without credentials, query parameters, or fragments.",
            );
      }
      return { ok: true, value: text };
    }
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value))
        return fail("Expected a number.");
      if (field.min !== undefined && value < field.min)
        return fail(`At least ${field.min}.`);
      if (field.max !== undefined && value > field.max)
        return fail(`At most ${field.max}.`);
      return { ok: true, value };
    case "enum":
      return typeof value === "string" &&
        field.options.some((option) => option.value === value)
        ? { ok: true, value }
        : fail("Not one of the offered options.");
    case "account":
      return typeof value === "string" && value.trim().length > 0
        ? { ok: true, value: value.trim() }
        : fail("Expected an account id.");
    case "model": {
      const parsed = modelSelectionSchema.strict().safeParse(value);
      return parsed.success
        ? { ok: true, value: parsed.data }
        : fail("Expected a model selection.");
    }
  }
}

export type SettingsValidation = {
  /** Valid values, normalized. */
  value: Record<string, unknown>;
  issues: SettingIssue[];
};

/** Compiles a settings schema into a validator; validation never throws. */
export function compileSettingsValidator(schema: SettingsSchema) {
  return (input: unknown): SettingsValidation => {
    const value: Record<string, unknown> = {};
    const issues: SettingIssue[] = [];
    if (input === undefined) return { value, issues };
    if (!input || typeof input !== "object" || Array.isArray(input))
      return {
        value,
        issues: [
          { code: "invalid-value", field: "", message: "Expected an object." },
        ],
      };
    for (const [key, raw] of Object.entries(input)) {
      const field = Object.hasOwn(schema.fields, key)
        ? schema.fields[key]
        : undefined;
      if (!field) {
        issues.push({
          code: "unknown-field",
          field: key,
          message: "Unknown setting.",
        });
        continue;
      }
      const result = validateField(field, raw);
      if (result.ok) value[key] = result.value;
      else
        issues.push({
          code: "invalid-value",
          field: key,
          message: result.message,
        });
    }
    return { value, issues };
  };
}
