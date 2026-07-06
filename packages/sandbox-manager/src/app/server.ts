import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  type ManagedSandboxRecord,
  type SandboxConfigV1,
  sandboxConfigV1Schema,
  sandboxSnapshotResultSchema,
  sandboxStatusGetResultSchema,
} from "@nervekit/shared";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  commandRequestSchema,
  createSandboxRequestSchema,
  credentialProfileWriteSchema,
  oauthRespondSchema,
  oauthStartSchema,
  secretWriteSchema,
} from "../api/request-schemas.js";
import { ok } from "../api/responses.js";
import { buildSandboxLaunchSpec } from "../config/sandbox-launch-spec.js";
import { listSandboxManagerModels } from "../credentials/model-catalog.js";
import { recordManagerLifecycleEvent } from "../events/manager-events.js";
import {
  authorizedManagerRequest,
  requireSandboxControllerToken,
} from "../http/auth.js";
import { readJsonBody } from "../http/body.js";
import { errorResponse, HttpError } from "../http/errors.js";
import { withIdempotency } from "../http/idempotency.js";
import { LogCollector } from "../lifecycle/log-collector.js";
import { handleManagerProtocolHttpRequest } from "../protocol/manager-protocol-http-dispatcher.js";
import { SandboxWsServer } from "../protocol/sandbox-ws-server.js";
import { tailManagerLogs } from "../routes/manager-logs-routes.js";
import { managerStatus } from "../routes/manager-status-routes.js";
import { createSandboxRecord } from "../routes/sandbox-routes.js";
import { resolveSandboxSecret } from "../routes/secrets-routes.js";
import { createLoggedRequestListener } from "./http-logging.js";
import type { ManagerState } from "./manager-state.js";
import { sandboxManagerVersion } from "./version.js";
import { maybeServeManagerWeb } from "./web-static.js";

export function createManagerServer(state: ManagerState) {
  const controller = new SandboxWsServer(state, authorizedManagerRequest);
  const server = createServer(
    createLoggedRequestListener(
      state.logger,
      (req, res) => handle(state, controller, req, res),
      errorResponse,
      json,
    ),
  );
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
  if (await maybeServeManagerWeb(state, req, res, url)) return;
  if (path.endsWith("/secrets/resolve")) {
    // Secrets are authenticated with the sandbox controller token below.
  } else if (!authorizedManagerRequest(state, req)) {
    throw new HttpError(401, "Unauthorized", "UNAUTHORIZED");
  }
  if (req.method === "GET" && path === "/health")
    return json(res, 200, ok({ version: sandboxManagerVersion }));
  if (req.method === "GET" && path === "/api/manager/status")
    return json(res, 200, ok(await managerStatus(state)));
  if (req.method === "GET" && path === "/api/manager/logs")
    return json(res, 200, ok(tailManagerLogs(state, url.searchParams)));
  if (path === "/api/protocol/v1")
    return handleManagerProtocolHttpRequest(state, controller, req, res);
  if (req.method === "GET" && path === "/api/manager/secrets/metadata") {
    return json(res, 200, ok(await (state.secrets.listMetadata?.() ?? [])));
  }
  if (req.method === "POST" && path === "/api/manager/secrets") {
    const body = secretWriteSchema.parse(await readJsonBody(req));
    await state.secrets.set(body.key, body.value, {
      version: body.version,
      expiresAt: body.expiresAt,
    });
    await state.audit.append({
      action: "secret.write",
      success: true,
      details: { key: "[REDACTED]" },
    });
    return json(res, 201, ok({ key: body.key, version: body.version }));
  }
  const managerSecretMatch = path.match(/^\/api\/manager\/secrets\/(.+)$/);
  if (req.method === "DELETE" && managerSecretMatch) {
    const key = decodeURIComponent(managerSecretMatch[1]);
    await state.secrets.delete?.(key);
    await state.audit.append({
      action: "secret.delete",
      success: true,
      details: { key: "[REDACTED]" },
    });
    return json(res, 200, ok({ deleted: true }));
  }
  if (req.method === "GET" && path === "/api/manager/models")
    return json(res, 200, ok(listSandboxManagerModels()));
  if (req.method === "GET" && path === "/api/manager/auth/providers")
    return json(
      res,
      200,
      ok([
        { provider: "anthropic", supportsOAuth: true, supportsApiKey: true },
        {
          provider: "openai-codex",
          supportsOAuth: true,
          supportsApiKey: false,
        },
        { provider: "openai", supportsOAuth: false, supportsApiKey: true },
        {
          provider: "github-copilot",
          supportsOAuth: true,
          supportsApiKey: false,
        },
        { provider: "github", supportsOAuth: true, supportsApiKey: true },
        { provider: "jira", supportsOAuth: true, supportsApiKey: true },
        { provider: "confluence", supportsOAuth: true, supportsApiKey: true },
      ]),
    );
  if (req.method === "POST" && path === "/api/manager/auth/oauth/start") {
    return json(
      res,
      201,
      ok(
        state.oauthFlows.start(oauthStartSchema.parse(await readJsonBody(req))),
      ),
    );
  }
  const oauthMatch = path.match(/^\/api\/manager\/auth\/oauth\/([^/]+)$/);
  if (oauthMatch) {
    const flowId = decodeURIComponent(oauthMatch[1]);
    if (req.method === "GET")
      return json(res, 200, ok(state.oauthFlows.get(flowId)));
  }
  const oauthRespondMatch = path.match(
    /^\/api\/manager\/auth\/oauth\/([^/]+)\/respond$/,
  );
  if (req.method === "POST" && oauthRespondMatch) {
    const flowId = decodeURIComponent(oauthRespondMatch[1]);
    return json(
      res,
      200,
      ok(
        await state.oauthFlows.respond(
          flowId,
          oauthRespondSchema.parse(await readJsonBody(req)),
        ),
      ),
    );
  }
  const oauthCancelMatch = path.match(
    /^\/api\/manager\/auth\/oauth\/([^/]+)\/cancel$/,
  );
  if (req.method === "POST" && oauthCancelMatch) {
    const flowId = decodeURIComponent(oauthCancelMatch[1]);
    return json(res, 200, ok(await state.oauthFlows.cancel(flowId)));
  }
  if (req.method === "GET" && path === "/api/manager/credential-profiles")
    return json(res, 200, ok(await state.credentials.list()));
  if (req.method === "POST" && path === "/api/manager/credential-profiles") {
    const body = credentialProfileWriteSchema.parse(await readJsonBody(req));
    const profile = await state.credentialProfiles.create(body);
    await state.audit.append({
      action: "credential_profile.write",
      success: true,
      details: { profileId: profile.profileId, kind: profile.kind },
    });
    return json(res, 201, ok(profile));
  }
  const credentialRefreshMatch = path.match(
    /^\/api\/manager\/credential-profiles\/([^/]+)\/refresh$/,
  );
  if (req.method === "POST" && credentialRefreshMatch) {
    const profileId = decodeURIComponent(credentialRefreshMatch[1]);
    return json(
      res,
      200,
      ok(
        await state.credentialResolver.resolveProfile(profileId, undefined, {
          minTtlMs: Number.MAX_SAFE_INTEGER,
        }),
      ),
    );
  }
  const credentialMatch = path.match(
    /^\/api\/manager\/credential-profiles\/([^/]+)$/,
  );
  if (credentialMatch) {
    const profileId = decodeURIComponent(credentialMatch[1]);
    if (req.method === "GET")
      return json(res, 200, ok(await state.credentials.get(profileId)));
    if (req.method === "PUT") {
      const body = credentialProfileWriteSchema.parse(await readJsonBody(req));
      const profile = await state.credentialProfiles.update(profileId, body);
      await state.audit.append({
        action: "credential_profile.write",
        success: true,
        details: { profileId, kind: profile.kind },
      });
      return json(res, 200, ok(profile));
    }
    if (req.method === "DELETE") {
      await state.credentialProfiles.delete(profileId);
      await state.audit.append({
        action: "credential_profile.delete",
        success: true,
        details: { profileId },
      });
      return json(res, 200, ok({ deleted: true }));
    }
  }
  if (req.method === "GET" && path === "/api/sandboxes")
    return json(
      res,
      200,
      ok((await state.sandboxes.list()).map(publicSandboxRecord)),
    );
  if (req.method === "POST" && path === "/api/sandboxes") {
    const rawBody = await readJsonBody(req);
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
          body.auth,
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
      const body = await readJsonBody(req);
      const result = await withIdempotency(state, req, path, body, () =>
        startSandbox(state, sandboxId),
      );
      return json(res, 200, ok(result.value));
    }
    if (req.method === "POST" && action === "stop") {
      const body = await readJsonBody(req);
      const result = await withIdempotency(state, req, path, body, async () =>
        publicSandboxRecord(await state.supervisor.stop(sandboxId)),
      );
      return json(res, 200, ok(result.value));
    }
    if (req.method === "POST" && action === "restart") {
      const body = await readJsonBody(req);
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
    await requireSandboxControllerToken(state, secretMatch[1], req);
    const body = await readJsonBody(req);
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
    const body = commandRequestSchema.parse(await readJsonBody(req));
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
async function loadSandboxConfigForStart(
  state: ManagerState,
  record: ManagedSandboxRecord,
): Promise<SandboxConfigV1> {
  if (record.configRef?.source) {
    try {
      return sandboxConfigV1Schema.parse(
        parseYaml(await readFile(record.configRef.source, "utf8")),
      );
    } catch {
      // Fall through and regenerate runtime materialization from PostgreSQL.
    }
  }
  const result = await state.pool.query<{ materialized_config: unknown }>(
    "select materialized_config from sandboxes where sandbox_id = $1",
    [record.sandboxId],
  );
  const config = sandboxConfigV1Schema.parse(
    result.rows[0]?.materialized_config,
  );
  const materialized = await state.volumeProvider.materialize?.(
    record.sandboxId,
    {
      configYaml: materializeConfigYaml(config),
      controllerToken: record.controller?.token ?? "",
    },
  );
  if (materialized) {
    const next = {
      ...record,
      workspaceRef: materialized.workspace,
      stateRef: materialized.state,
      secretMountRefs: [materialized.secrets],
      configRef: materialized.config,
    };
    await state.volumeStore.put(
      record.sandboxId,
      state.volumeProvider.kind,
      materialized,
    );
    await state.sandboxes.put(next);
  }
  return config;
}

function materializeConfigYaml(config: SandboxConfigV1): string {
  return stringifyYaml(config, { sortMapEntries: true });
}

async function startSandbox(
  state: ManagerState,
  sandboxId: string,
): Promise<unknown> {
  const record = await state.sandboxes.get(sandboxId);
  if (!record) throw new HttpError(404, "Sandbox not found", "NOT_FOUND");
  const config = await loadSandboxConfigForStart(state, record);
  const refreshed = (await state.sandboxes.get(sandboxId)) ?? record;
  if (!refreshed.configRef?.source)
    throw new HttpError(
      409,
      "Sandbox config is not materialized for this container backend",
      "INVALID_STATE",
    );
  const spec = buildSandboxLaunchSpec(config, {
    image: refreshed.image.reference,
    sandboxId,
    managerBaseUrl: refreshed.controller?.url ?? "",
    workspaceSource: refreshed.workspaceRef.source ?? "",
    stateSource: refreshed.stateRef.source ?? "",
    configSource: refreshed.configRef.source,
    secretsSource: refreshed.secretMountRefs?.[0]?.source ?? "",
    logLevel: state.config.logLevel,
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
    closeReason: session.closeReason?.trim() || undefined,
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
