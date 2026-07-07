import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { ManagerState } from "../app/manager-state.js";
import { readUiAuthCookie } from "../app/web-static.js";
import { HttpError } from "./errors.js";

export function timingSafeTokenEquals(
  actual: string | undefined,
  expected: string | undefined,
): boolean {
  if (!actual || !expected) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function authorizedManagerRequest(
  state: ManagerState,
  req: IncomingMessage,
): boolean {
  if (!state.config.apiKey) return true;
  const header = req.headers.authorization ?? req.headers["x-api-key"];
  const candidates = Array.isArray(header) ? header : [header];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    if (timingSafeTokenEquals(candidate, state.config.apiKey)) return true;
    if (candidate.startsWith("Bearer ")) {
      if (
        timingSafeTokenEquals(
          candidate.slice("Bearer ".length),
          state.config.apiKey,
        )
      )
        return true;
    }
  }
  return timingSafeTokenEquals(readUiAuthCookie(req), state.config.apiKey);
}

export async function requireSandboxControllerToken(
  state: ManagerState,
  sandboxId: string,
  req: IncomingMessage,
): Promise<void> {
  const record = await state.sandboxes.get(sandboxId);
  const token = record?.controller?.token;
  const actual = extractSandboxToken(req);
  if (!timingSafeTokenEquals(actual, token))
    throw new HttpError(401, "Unauthorized", "UNAUTHORIZED");
}

export function extractSandboxToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer "))
    return header.slice("Bearer ".length);
  const sandboxToken = req.headers["x-nerve-sandbox-agent-token"];
  if (typeof sandboxToken === "string") return sandboxToken;
  return undefined;
}
