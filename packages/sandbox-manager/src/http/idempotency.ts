import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { ManagerState } from "../app/manager-state.js";
import { HttpError } from "./errors.js";

export async function withIdempotency<T>(
  state: ManagerState,
  req: IncomingMessage,
  route: string,
  body: unknown,
  run: () => Promise<T>,
): Promise<{ value: T; replayed: boolean }> {
  const key = String(
    req.headers["idempotency-key"] ??
      (body as { idempotencyKey?: unknown })?.idempotencyKey ??
      "",
  );
  if (!key) return { value: await run(), replayed: false };
  const hash = createHash("sha256")
    .update(JSON.stringify({ method: req.method, route, body }))
    .digest("hex");
  const stored = await state.idempotency.get<T>(key);
  if (stored) {
    if (stored.hash !== hash)
      throw new HttpError(
        409,
        "Idempotency key reused with different request",
        "IDEMPOTENCY_CONFLICT",
      );
    return { value: stored.value, replayed: true };
  }
  const value = await run();
  await state.idempotency.put(key, hash, value);
  return { value, replayed: false };
}
