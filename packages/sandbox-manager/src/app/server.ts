import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { parse as parseUrl } from "node:url";
import {
  commandRequestSchema,
  createSandboxRequestSchema,
} from "../api/request-schemas.js";
import { ok } from "../api/responses.js";
import { errorResponse, HttpError } from "../http/errors.js";
import { createSandboxRecord } from "../routes/sandbox-routes.js";
import { resolveSandboxSecret } from "../routes/secrets-routes.js";
import type { ManagerState } from "./manager-state.js";
import { sandboxManagerVersion } from "./version.js";

export function createManagerServer(state: ManagerState) {
  return createServer(async (req, res) => {
    try {
      await handle(state, req, res);
    } catch (error) {
      const response = errorResponse(error);
      json(res, response.status, response.body);
    }
  });
}
async function handle(
  state: ManagerState,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!authorized(state, req))
    throw new HttpError(401, "Unauthorized", "UNAUTHORIZED");
  const url = parseUrl(req.url ?? "/", true);
  const path = url.pathname ?? "/";
  if (req.method === "GET" && path === "/health")
    return json(res, 200, ok({ version: sandboxManagerVersion }));
  if (req.method === "GET" && path === "/api/sandboxes")
    return json(res, 200, ok(await state.sandboxes.list()));
  if (req.method === "POST" && path === "/api/sandboxes") {
    const body = createSandboxRequestSchema.parse(await readJson(req));
    return json(
      res,
      201,
      ok(await createSandboxRecord(state, body.config, body.image)),
    );
  }
  const sandboxMatch = path.match(/^\/api\/sandboxes\/([^/]+)$/);
  if (req.method === "GET" && sandboxMatch)
    return json(res, 200, ok(await state.sandboxes.get(sandboxMatch[1])));
  const eventMatch = path.match(/^\/api\/sandboxes\/([^/]+)\/events$/);
  if (req.method === "GET" && eventMatch)
    return json(res, 200, ok(await state.events.list(eventMatch[1])));
  const secretMatch = path.match(
    /^\/api\/sandboxes\/([^/]+)\/secrets\/resolve$/,
  );
  if (req.method === "POST" && secretMatch) {
    const body = await readJson(req);
    if (
      !body ||
      typeof body !== "object" ||
      typeof (body as { key?: unknown }).key !== "string"
    )
      throw new HttpError(400, "Secret key is required", "VALIDATION_FAILED");
    return json(
      res,
      200,
      ok(
        await resolveSandboxSecret(
          state,
          secretMatch[1],
          body as { key: string; version?: string },
        ),
      ),
    );
  }
  const commandMatch = path.match(/^\/api\/sandboxes\/([^/]+)\/commands$/);
  if (req.method === "POST" && commandMatch) {
    commandRequestSchema.parse(await readJson(req));
    throw new HttpError(
      503,
      "Sandbox command forwarding requires a connected controller session",
      "UNAVAILABLE",
    );
  }
  throw new HttpError(404, "Not found", "NOT_FOUND");
}
function authorized(state: ManagerState, req: IncomingMessage): boolean {
  if (!state.config.apiKey) return true;
  const header = req.headers.authorization ?? req.headers["x-api-key"];
  return (
    header === state.config.apiKey || header === `Bearer ${state.config.apiKey}`
  );
}
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  if (Buffer.concat(chunks).length > 1024 * 1024)
    throw new HttpError(413, "Request too large", "REQUEST_TOO_LARGE");
  return chunks.length
    ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
    : {};
}
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(`${JSON.stringify(body)}\n`);
}
