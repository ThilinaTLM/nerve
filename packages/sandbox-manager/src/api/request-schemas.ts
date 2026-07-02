import { sandboxConfigV1Schema } from "@nervekit/shared";

export const createSandboxRequestSchema = {
  parse(input: unknown) {
    if (!input || typeof input !== "object")
      throw new Error("request body must be an object");
    const body = input as Record<string, unknown>;
    return {
      config: sandboxConfigV1Schema.parse(body.config),
      image: typeof body.image === "string" ? body.image : undefined,
      name: typeof body.name === "string" ? body.name : undefined,
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
