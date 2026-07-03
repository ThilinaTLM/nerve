import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import {
  type ManagedSandboxRecord,
  sandboxConfigV1Schema,
  sandboxManagerStatusSchema,
  sandboxSnapshotResultSchema,
  sandboxStatusGetResultSchema,
} from "@nervekit/shared";
import { parse as parseYaml } from "yaml";
import {
  commandRequestSchema,
  createSandboxRequestSchema,
} from "../api/request-schemas.js";
import { ok } from "../api/responses.js";
import { buildSandboxLaunchSpec } from "../config/sandbox-launch-spec.js";
import { recordManagerLifecycleEvent } from "../events/manager-events.js";
import { errorResponse, HttpError } from "../http/errors.js";
import { LogCollector } from "../lifecycle/log-collector.js";
import { SandboxWsServer } from "../protocol/sandbox-ws-server.js";
import { createSandboxRecord } from "../routes/sandbox-routes.js";
import { resolveSandboxSecret } from "../routes/secrets-routes.js";
import type { ManagerState } from "./manager-state.js";
import { sandboxManagerVersion } from "./version.js";

export function createManagerServer(state: ManagerState) {
  const controller = new SandboxWsServer(state, authorized);
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
  if (req.method === "GET" && path === "/api/manager/status")
    return json(res, 200, ok(await managerStatus(state)));
  if (req.method === "GET" && path === "/api/sandboxes")
    return json(
      res,
      200,
      ok((await state.sandboxes.list()).map(publicSandboxRecord)),
    );
  if (req.method === "POST" && path === "/api/sandboxes") {
    const rawBody = await readJson(req);
    const body = createSandboxRequestSchema.parse(rawBody);
    const result = await withIdempotency(
      state,
      req,
      path,
      rawBody,
      async () => {
        const record = await createSandboxRecord(
          state,
          body.config,
          body.image,
          body.name,
        );
        await recordManagerLifecycleEvent(state, {
          type: "manager.sandbox.created",
          sandboxId: record.sandboxId,
          payload: {
            sandboxId: record.sandboxId,
            instanceId: record.instanceId,
            name: record.name,
            backend: record.backend,
            image: record.image,
            desiredState: record.desiredState,
            observedState: record.observedState,
          },
        });
        return publicSandboxRecord(record);
      },
    );
    return json(res, result.replayed ? 200 : 201, ok(result.value));
  }
  const sandboxMatch = path.match(/^\/api\/sandboxes\/([^/]+)$/);
  if (req.method === "GET" && sandboxMatch) {
    const record = await state.sandboxes.get(sandboxMatch[1]);
    return json(res, 200, ok(record ? publicSandboxRecord(record) : undefined));
  }
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
      await recordManagerLifecycleEvent(state, {
        type: "manager.sandbox.deleted",
        sandboxId: sandboxMatch[1],
        payload: {
          sandboxId: sandboxMatch[1],
          removeVolumes: body.removeVolumes,
          force: body.force,
        },
      });
      return publicSandboxRecord(removed);
    });
    return json(res, 200, ok(result.value));
  }
  const latestSessionMatch = path.match(
    /^\/api\/sandboxes\/([^/]+)\/sessions\/latest$/,
  );
  if (req.method === "GET" && latestSessionMatch)
    return json(
      res,
      200,
      ok(sessionSummary(await state.sessions.get(latestSessionMatch[1]))),
    );
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
      const result = await withIdempotency(state, req, path, body, async () =>
        publicSandboxRecord(await state.supervisor.stop(sandboxId)),
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
    const prepared = prepareForwardedCommand(req, body);
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
        await session.forwarder.send(
          session.socket,
          prepared.method,
          prepared.params,
          prepared.requestId,
        ),
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
async function managerStatus(state: ManagerState): Promise<unknown> {
  const runtime = await state.driver.capabilities();
  const mode = state.config.mode ?? "development";
  const encryptionAtRest = state.config.encryptionKey
    ? "enabled"
    : state.config.allowCleartextSecretsInDevelopment
      ? "development_cleartext"
      : mode === "production"
        ? "unavailable"
        : "unknown";
  return sandboxManagerStatusSchema.parse({
    managerId: managerId(state),
    version: sandboxManagerVersion,
    backend: state.config.backend,
    runtime,
    hardening: {
      mode,
      apiAuth: state.config.apiKey ? "configured" : "disabled",
      secretStorage: {
        encryptionAtRest,
        keyId: state.config.encryptionKeyRef,
        warning:
          encryptionAtRest === "unavailable"
            ? "Secret encryption key is not configured"
            : encryptionAtRest === "development_cleartext"
              ? "Development cleartext secret storage is enabled"
              : undefined,
      },
    },
    lifecycle: {
      reconcileOnStartup: state.config.reconcileOnStartup ?? true,
      reconcileIntervalMs: state.config.reconcileIntervalMs,
      gcIntervalMs: state.config.gcIntervalMs,
      orphanPolicy: state.config.orphanPolicy ?? "stop_remove",
      heartbeatTimeoutMs: state.config.heartbeatTimeoutMs ?? 45_000,
      maxPendingCommands: state.config.maxPendingCommands ?? 256,
      maxCommandBytes: state.config.maxCommandBytes ?? 1_000_000,
    },
    updatedAt: new Date().toISOString(),
  });
}

function managerId(state: ManagerState): string {
  return `mgr_${createHash("sha256")
    .update(`${state.config.backend}:${state.config.storageDir}`)
    .digest("hex")
    .slice(0, 16)}`;
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
  return publicSandboxRecord(
    await state.supervisor.start(sandboxId, stableSpec),
  );
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
  if (session) {
    const result = await session.forwarder.send(
      session.socket,
      "sandbox.status.get",
      {},
    );
    return sandboxStatusGetResultSchema.parse({
      connected: true,
      stale: false,
      ...(isObjectRecord(result) ? result : {}),
    });
  }
  return sandboxStatusGetResultSchema.parse(
    await managerDerivedStatus(state, sandboxId),
  );
}
async function sandboxSnapshot(
  state: ManagerState,
  controller: SandboxWsServer,
  sandboxId: string,
): Promise<unknown> {
  const session = controller.getSession(sandboxId);
  if (session) {
    const result = await session.forwarder.send(
      session.socket,
      "sandbox.snapshot.get",
      {},
    );
    return sandboxSnapshotResultSchema.parse({
      connected: true,
      stale: false,
      ...(isObjectRecord(result) ? result : {}),
    });
  }
  return sandboxSnapshotResultSchema.parse(
    await managerDerivedSnapshot(state, sandboxId),
  );
}
async function managerDerivedStatus(
  state: ManagerState,
  sandboxId: string,
): Promise<Record<string, unknown>> {
  const record = await state.sandboxes.get(sandboxId);
  if (!record) throw new HttpError(404, "Sandbox not found", "NOT_FOUND");
  const session = await state.sessions.get(sandboxId);
  const events = await state.events.list(sandboxId);
  const lastEvent = events
    .filter((event) => typeof event.seq === "number" || event.ts)
    .sort((a, b) => Number(a.seq ?? -1) - Number(b.seq ?? -1))
    .at(-1);
  const now = new Date().toISOString();
  const disconnectedAt = session?.disconnectedAt ?? record.stoppedAt;
  return {
    sandboxId: record.sandboxId,
    instanceId: record.instanceId ?? "unknown",
    status: daemonStatusFromRecord(record, session?.state),
    connected: false,
    stale: true,
    staleness: {
      stale: true,
      reason: session ? "controller_disconnected" : "no_controller_session",
      asOf: now,
      lastConnectedAt: session?.updatedAt,
      disconnectedAt,
      ageMs: disconnectedAt
        ? Math.max(0, Date.now() - Date.parse(disconnectedAt))
        : undefined,
    },
    lastEventSeq: lastEvent?.seq,
    lastEventAt: lastEvent?.ts,
    lastSession: sessionSummary(session),
    limitations: [
      "Status is manager-derived because no controller session is connected",
    ],
    configDigest: record.configDigest,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    connectivity: {
      state:
        session?.state === "reconnecting" ? "reconnecting" : "disconnected",
      connectedAt: session?.updatedAt,
      disconnectedAt,
      lastErrorCode: record.lastError?.code,
    },
    cursors: cursorSummary(session?.cursors),
    conversations: [],
    agents: [],
    runs: [],
  };
}

async function managerDerivedSnapshot(
  state: ManagerState,
  sandboxId: string,
): Promise<Record<string, unknown>> {
  const status = await managerDerivedStatus(state, sandboxId);
  const events = await state.events.list(sandboxId);
  return {
    ...status,
    conversations: [],
    agents: [],
    runs: [],
    replayCursors: cursorSummary((await state.sessions.get(sandboxId))?.cursors)
      ?.streams,
    lastEventSeq: events.at(-1)?.seq ?? status.lastEventSeq,
    lastEventAt: events.at(-1)?.ts ?? status.lastEventAt,
  };
}

function daemonStatusFromRecord(
  record: ManagedSandboxRecord,
  sessionState?: string,
): string {
  if (sessionState === "reconnecting") return "reconnecting";
  if (record.observedState === "running") return "reconnecting";
  if (
    record.observedState === "starting" ||
    record.observedState === "creating"
  )
    return "booting";
  if (record.observedState === "failed") return "failed";
  if (record.observedState === "stopping") return "stopping";
  return "reconnecting";
}

function sessionSummary(
  session: Awaited<ReturnType<ManagerState["sessions"]["get"]>>,
) {
  if (!session) return undefined;
  return {
    sessionId: session.sessionId,
    status:
      session.state === "exited"
        ? "closed"
        : session.state === "reconnecting"
          ? "disconnected"
          : session.state,
    connectedAt: session.updatedAt,
    disconnectedAt: session.disconnectedAt,
    closeCode: session.closeCode,
    closeReason: session.closeReason,
    acceptedCapabilities: session.capabilities,
  };
}

function cursorSummary(
  cursors: unknown,
): { streams: Array<{ stream: string; processedSeq: number }> } | undefined {
  if (
    cursors &&
    typeof cursors === "object" &&
    Array.isArray((cursors as { streams?: unknown }).streams)
  ) {
    const streams = (cursors as { streams: unknown[] }).streams.flatMap(
      (cursor) => {
        if (
          cursor &&
          typeof cursor === "object" &&
          typeof (cursor as { stream?: unknown }).stream === "string" &&
          typeof (cursor as { processedSeq?: unknown }).processedSeq ===
            "number"
        )
          return [
            {
              stream: (cursor as { stream: string }).stream,
              processedSeq: (cursor as { processedSeq: number }).processedSeq,
            },
          ];
        return [];
      },
    );
    return { streams };
  }
  return undefined;
}

function prepareForwardedCommand(
  req: IncomingMessage,
  body: { method: string; params: unknown; idempotencyKey?: string },
): { method: string; params: unknown; requestId: string } {
  const idempotencyKey = String(
    req.headers["idempotency-key"] ?? body.idempotencyKey ?? "",
  );
  const mutating = !["sandbox.status.get", "sandbox.snapshot.get"].includes(
    body.method,
  );
  if (!mutating) {
    return {
      method: body.method,
      params: body.params,
      requestId: idempotencyKey || `req_${Date.now()}`,
    };
  }
  const params = isObjectRecord(body.params) ? { ...body.params } : {};
  const commandId =
    typeof params.commandId === "string" && params.commandId.trim()
      ? params.commandId
      : idempotencyKey;
  if (!commandId)
    throw new HttpError(
      400,
      "Mutating sandbox commands require params.commandId or Idempotency-Key",
      "VALIDATION_FAILED",
    );
  params.commandId = commandId;
  return { method: body.method, params, requestId: commandId };
}

function publicSandboxRecord(
  record: ManagedSandboxRecord,
): ManagedSandboxRecord {
  return record.controller
    ? { ...record, controller: { ...record.controller, token: "[REDACTED]" } }
    : record;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
