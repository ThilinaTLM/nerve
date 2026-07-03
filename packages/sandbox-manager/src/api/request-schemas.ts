import { sandboxCreateRequestSchema } from "@nervekit/shared";

/**
 * Manager create-request schema. Accepts UI-friendly create input where
 * `config.controller` may be omitted (the manager injects controller wiring),
 * and remains backward-compatible with full `SandboxConfigV1` bodies.
 */
export const createSandboxRequestSchema = sandboxCreateRequestSchema;

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
