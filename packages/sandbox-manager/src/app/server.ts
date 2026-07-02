import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { sandboxConfigV1Schema } from "@nervekit/shared";
import { parse as parseYaml } from "yaml";
import {
  commandRequestSchema,
  createSandboxRequestSchema,
} from "../api/request-schemas.js";
import { ok } from "../api/responses.js";
import { buildSandboxLaunchSpec } from "../config/sandbox-launch-spec.js";
import { errorResponse, HttpError } from "../http/errors.js";
import { LogCollector } from "../lifecycle/log-collector.js";
import { SandboxWsServer } from "../protocol/sandbox-ws-server.js";
import { createSandboxRecord } from "../routes/sandbox-routes.js";
import { resolveSandboxSecret } from "../routes/secrets-routes.js";
import type { ManagerState } from "./manager-state.js";
import { sandboxManagerVersion } from "./version.js";

export function createManagerServer(state: ManagerState) {
  const controller = new SandboxWsServer(state);
  const server = createServer(async (req, res) => {
    try {
      await handle(state, controller, req, res);
    } catch (error) {
      const response = errorResponse(error);
      json(res, response.status, response.body);
    }
  });
  server.on("upgrade", (req, socket, head) => {
    controller.handleUpgrade(req, socket, head);
  });
  return server;
}
async function handle(
  state: ManagerState,
  controller: SandboxWsServer,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  if (path.endsWith("/secrets/resolve")) {
    // Secrets are authenticated with the sandbox controller token below.
  } else if (!authorized(state, req)) {
    throw new HttpError(401, "Unauthorized", "UNAUTHORIZED");
  }
  if (req.method === "GET" && path === "/health")
    return json(res, 200, ok({ version: sandboxManagerVersion }));
  if (req.method === "GET" && path === "/api/sandboxes")
    return json(res, 200, ok(await state.sandboxes.list()));
  if (req.method === "POST" && path === "/api/sandboxes") {
    const rawBody = await readJson(req);
    const body = createSandboxRequestSchema.parse(rawBody);
    const result = await withIdempotency(state, req, path, rawBody, () =>
      createSandboxRecord(state, body.config, body.image),
    );
    return json(res, result.replayed ? 200 : 201, ok(result.value));
  }
  const sandboxMatch = path.match(/^\/api\/sandboxes\/([^/]+)$/);
  if (req.method === "GET" && sandboxMatch)
    return json(res, 200, ok(await state.sandboxes.get(sandboxMatch[1])));
  if (req.method === "DELETE" && sandboxMatch) {
    const body = {
      force:
        url.searchParams.get("force") === "1" ||
        url.searchParams.get("force") === "true",
      removeVolumes:
        url.searchParams.get("removeVolumes") === "1" ||
        url.searchParams.get("removeVolumes") === "true",
    };
    const result = await withIdempotency(state, req, path, body, async () => {
      const removed = await state.supervisor.remove(sandboxMatch[1], body);
      await state.sandboxes.delete(sandboxMatch[1]);
      return removed;
    });
    return json(res, 200, ok(result.value));
  }
  const actionMatch = path.match(
    /^\/api\/sandboxes\/([^/]+)\/(start|stop|restart|logs|status|snapshot)$/,
  );
  if (actionMatch) {
    const sandboxId = actionMatch[1];
    const action = actionMatch[2];
    if (req.method === "POST" && action === "start") {
      const body = await readJson(req);
      const result = await withIdempotency(state, req, path, body, () =>
        startSandbox(state, sandboxId),
      );
      return json(res, 200, ok(result.value));
    }
    if (req.method === "POST" && action === "stop") {
      const body = await readJson(req);
      const result = await withIdempotency(state, req, path, body, () =>
        state.supervisor.stop(sandboxId),
      );
      return json(res, 200, ok(result.value));
    }
    if (req.method === "POST" && action === "restart") {
      const body = await readJson(req);
      const result = await withIdempotency(state, req, path, body, async () => {
        await state.supervisor.stop(sandboxId).catch(() => undefined);
        return startSandbox(state, sandboxId);
      });
      return json(res, 200, ok(result.value));
    }
    if (req.method === "GET" && action === "logs")
      return json(res, 200, ok(await collectLogs(state, sandboxId, url)));
    if (req.method === "GET" && action === "status")
      return json(
        res,
        200,
        ok(await sandboxStatus(state, controller, sandboxId)),
      );
    if (req.method === "GET" && action === "snapshot")
      return json(
        res,
        200,
        ok(await sandboxSnapshot(state, controller, sandboxId)),
      );
  }
  const eventMatch = path.match(/^\/api\/sandboxes\/([^/]+)\/events$/);
  if (req.method === "GET" && eventMatch)
    return json(res, 200, ok(await state.events.list(eventMatch[1])));
  const secretMatch = path.match(
    /^\/api\/sandboxes\/([^/]+)\/secrets\/resolve$/,
  );
  if (req.method === "POST" && secretMatch) {
    await requireSandboxToken(state, secretMatch[1], req);
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
    const body = commandRequestSchema.parse(await readJson(req));
    const session = controller.getSession(commandMatch[1]);
    if (!session)
      throw new HttpError(
        503,
        "Sandbox command forwarding requires a connected controller session",
        "UNAVAILABLE",
      );
    return json(
      res,
      200,
      ok(
        await session.forwarder.send(session.socket, body.method, body.params),
      ),
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
async function requireSandboxToken(
  state: ManagerState,
  sandboxId: string,
  req: IncomingMessage,
): Promise<void> {
  const record = await state.sandboxes.get(sandboxId);
  const token = record?.controller?.token;
  const header = req.headers.authorization;
  const actual =
    typeof header === "string" && header.startsWith("Bearer ")
      ? header.slice("Bearer ".length)
      : req.headers["x-nerve-sandbox-token"];
  if (!token || actual !== token)
    throw new HttpError(401, "Unauthorized", "UNAUTHORIZED");
}
async function startSandbox(
  state: ManagerState,
  sandboxId: string,
): Promise<unknown> {
  const record = await state.sandboxes.get(sandboxId);
  if (!record) throw new HttpError(404, "Sandbox not found", "NOT_FOUND");
  if (!record.configRef?.source)
    throw new HttpError(
      409,
      "Sandbox config is not materialized",
      "INVALID_STATE",
    );
  const config = sandboxConfigV1Schema.parse(
    parseYaml(await readFile(record.configRef.source, "utf8")),
  );
  const spec = buildSandboxLaunchSpec(config, {
    image: record.image.reference,
    sandboxId,
    managerBaseUrl: record.controller?.url ?? "",
    workspaceSource: record.workspaceRef.source ?? "",
    stateSource: record.stateRef.source ?? "",
    configSource: record.configRef.source,
    secretsSource: record.secretMountRefs?.[0]?.source ?? "",
  });
  const stableSpec = {
    ...spec,
    instanceId: record.instanceId ?? spec.instanceId,
  };
  return state.supervisor.start(sandboxId, stableSpec);
}
async function collectLogs(
  state: ManagerState,
  sandboxId: string,
  url: URL,
): Promise<{
  chunks: Array<{ stream: string; chunk: string; ts?: string }>;
  truncated: boolean;
}> {
  const record = await state.sandboxes.get(sandboxId);
  if (!record?.containerRef) return { chunks: [], truncated: false };
  const collector = new LogCollector(state.driver);
  const chunks: Array<{ stream: string; chunk: string; ts?: string }> = [];
  let bytes = 0;
  let truncated = false;
  const maxBytes = Math.min(
    Number(url.searchParams.get("maxBytes") ?? 256 * 1024),
    1024 * 1024,
  );
  const tail = url.searchParams.get("tail");
  const since = url.searchParams.get("since") ?? undefined;
  for await (const chunk of collector.logs(record.containerRef, {
    tail: tail ? Number(tail) : undefined,
    since,
  })) {
    const redacted = redactText(chunk.chunk);
    bytes += Buffer.byteLength(redacted);
    if (bytes > maxBytes) {
      truncated = true;
      break;
    }
    chunks.push({ ...chunk, chunk: redacted });
  }
  return { chunks, truncated };
}
async function sandboxStatus(
  state: ManagerState,
  controller: SandboxWsServer,
  sandboxId: string,
): Promise<unknown> {
  const session = controller.getSession(sandboxId);
  if (session)
    return session.forwarder.send(session.socket, "sandbox.status.get", {});
  return {
    record: await state.sandboxes.get(sandboxId),
    session: await state.sessions.get(sandboxId),
    connected: false,
  };
}
async function sandboxSnapshot(
  state: ManagerState,
  controller: SandboxWsServer,
  sandboxId: string,
): Promise<unknown> {
  const session = controller.getSession(sandboxId);
  if (session)
    return session.forwarder.send(session.socket, "sandbox.snapshot.get", {});
  return {
    record: await state.sandboxes.get(sandboxId),
    events: await state.events.list(sandboxId),
    session: await state.sessions.get(sandboxId),
    connected: false,
  };
}
async function withIdempotency<T>(
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
  const dir = path.join(state.config.storageDir, "idempotency");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${Buffer.from(key).toString("base64url")}.json`);
  try {
    const stored = JSON.parse(await readFile(file, "utf8")) as {
      hash: string;
      value: T;
    };
    if (stored.hash !== hash)
      throw new HttpError(
        409,
        "Idempotency key reused with different request",
        "IDEMPOTENCY_CONFLICT",
      );
    return { value: stored.value, replayed: true };
  } catch (error) {
    if (
      !(
        typeof error === "object" &&
        error &&
        "code" in error &&
        (error as { code?: unknown }).code === "ENOENT"
      )
    )
      throw error;
  }
  const value = await run();
  await writeFile(file, `${JSON.stringify({ hash, value }, null, 2)}\n`, {
    mode: 0o600,
  });
  return { value, replayed: false };
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
function redactText(value: string): string {
  return value.replace(
    /(token|secret|password|api[_-]?key)=\S+/gi,
    "$1=[REDACTED]",
  );
}
