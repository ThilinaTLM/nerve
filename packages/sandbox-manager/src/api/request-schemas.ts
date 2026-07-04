import {
  sandboxCreateRequestSchema,
  sandboxManagerCredentialProfileWriteSchema,
} from "@nervekit/shared";

/**
 * Manager create-request schema. Accepts UI-friendly create input where
 * `config.controller` may be omitted (the manager injects controller wiring),
 * and remains backward-compatible with full `SandboxConfigV1` bodies.
 */
export const createSandboxRequestSchema = sandboxCreateRequestSchema;
export const credentialProfileWriteSchema =
  sandboxManagerCredentialProfileWriteSchema;

export const secretWriteSchema = {
  parse(input: unknown) {
    if (!input || typeof input !== "object")
      throw new Error("request body must be an object");
    const body = input as Record<string, unknown>;
    if (typeof body.key !== "string" || !body.key.trim())
      throw new Error("key is required");
    if (typeof body.value !== "string") throw new Error("value is required");
    return {
      key: body.key,
      value: body.value,
      version: typeof body.version === "string" ? body.version : undefined,
      expiresAt:
        typeof body.expiresAt === "string" ? body.expiresAt : undefined,
    };
  },
};

export const commandRequestSchema = {
  parse(input: unknown) {
    if (!input || typeof input !== "object")
      throw new Error("request body must be an object");
    const body = input as Record<string, unknown>;
    if (typeof body.method !== "string") throw new Error("method is required");
    return {
      method: body.method,
      params: body.params,
      idempotencyKey:
        typeof body.idempotencyKey === "string"
          ? body.idempotencyKey
          : undefined,
    };
  },
};
