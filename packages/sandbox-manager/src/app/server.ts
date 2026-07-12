import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  sandboxSnapshotResultSchema,
  sandboxWorkspaceFileQuerySchema,
} from "@nervekit/contracts";
import {
  createSandboxRequestSchema,
  credentialProfileWriteSchema,
  oauthRespondSchema,
  oauthStartSchema,
  secretWriteSchema,
} from "../api/request-schemas.js";
import { ok } from "../api/responses.js";
import { listSandboxManagerModels } from "../credentials/model-catalog.js";
import {
  authorizedManagerRequest,
  requireSandboxControllerToken,
} from "../http/auth.js";
import { readJsonBody } from "../http/body.js";
import { errorResponse, HttpError } from "../http/errors.js";
import { withIdempotency } from "../http/idempotency.js";
import { lifecycleSummary } from "../lifecycle/lifecycle-state.js";
import {
  deriveSandboxContainerStatus,
  managerDerivedSandboxView,
} from "../protocol/manager-derived-sandbox-view.js";
import { handleManagerProtocolHttpRequest } from "../protocol/manager-protocol-http-dispatcher.js";
import {
  createManagedSandbox,
  getManagedSandbox,
  listManagedSandboxes,
  managedContainerLogs,
  managedSandboxStatus,
  removeManagedSandbox,
  restartManagedSandbox,
  startManagedSandbox,
  stopManagedSandbox,
} from "../protocol/manager-sandbox-operations.js";
import { SandboxWsServer } from "../protocol/sandbox-ws-server.js";
import { tailManagerLogs } from "../routes/manager-logs-routes.js";
import { managerStatus } from "../routes/manager-status-routes.js";
import {
  getSandboxConfigYaml,
  previewSandboxConfigYaml,
} from "../routes/sandbox-routes.js";
import { getSandboxWorkspaceFile } from "../routes/sandbox-workspace-file-routes.js";
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
  if (req.method === "POST" && path === "/api/sandboxes/config/preview") {
    const body = createSandboxRequestSchema.parse(await readJsonBody(req));
    return json(
      res,
      200,
      ok(
        await previewSandboxConfigYaml(
          state,
          body.config,
          body.launch,
          body.auth,
        ),
      ),
    );
  }
  if (req.method === "GET" && path === "/api/sandboxes")
    return json(res, 200, ok(await listManagedSandboxes(state)));
  if (req.method === "POST" && path === "/api/sandboxes") {
    const rawBody = await readJsonBody(req);
    const body = createSandboxRequestSchema.parse(rawBody);
    const result = await withIdempotency(
      state,
      req,
      path,
      rawBody,
      async () => {
        return createManagedSandbox(state, body);
      },
    );
    return json(res, result.replayed ? 200 : 201, ok(result.value));
  }
  const sandboxMatch = path.match(/^\/api\/sandboxes\/([^/]+)$/);
  if (req.method === "GET" && sandboxMatch) {
    return json(res, 200, ok(await getManagedSandbox(state, sandboxMatch[1])));
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
      return removeManagedSandbox(state, {
        sandboxId: sandboxMatch[1],
        ...body,
      });
    });
    return json(res, 200, ok(result.value));
  }
  const configYamlMatch = path.match(/^\/api\/sandboxes\/([^/]+)\/config$/);
  if (req.method === "GET" && configYamlMatch)
    return json(
      res,
      200,
      ok(await getSandboxConfigYaml(state, configYamlMatch[1])),
    );
  const latestSessionMatch = path.match(
    /^\/api\/sandboxes\/([^/]+)\/sessions\/latest$/,
  );
  if (req.method === "GET" && latestSessionMatch)
    return json(
      res,
      200,
      ok(sessionSummary(await state.sessions.get(latestSessionMatch[1]))),
    );
  const workspaceFileMatch = path.match(
    /^\/api\/sandboxes\/([^/]+)\/workspace\/file$/,
  );
  if (req.method === "GET" && workspaceFileMatch) {
    const query = sandboxWorkspaceFileQuerySchema.parse({
      path: url.searchParams.get("path"),
      line: url.searchParams.get("line") ?? undefined,
    });
    return json(
      res,
      200,
      ok(await getSandboxWorkspaceFile(state, workspaceFileMatch[1], query)),
    );
  }
  const actionMatch = path.match(
    /^\/api\/sandboxes\/([^/]+)\/(start|stop|restart|logs|status|snapshot)$/,
  );
  if (actionMatch) {
    const sandboxId = actionMatch[1];
    const action = actionMatch[2];
    if (req.method === "POST" && action === "start") {
      const body = await readJsonBody(req);
      const result = await withIdempotency(state, req, path, body, () =>
        startManagedSandbox(state, sandboxId),
      );
      return json(res, 200, ok(result.value));
    }
    if (req.method === "POST" && action === "stop") {
      const body = await readJsonBody(req);
      const result = await withIdempotency(state, req, path, body, async () =>
        stopManagedSandbox(state, sandboxId),
      );
      return json(res, 200, ok(result.value));
    }
    if (req.method === "POST" && action === "restart") {
      const body = await readJsonBody(req);
      const result = await withIdempotency(state, req, path, body, async () => {
        return restartManagedSandbox(state, sandboxId);
      });
      return json(res, 200, ok(result.value));
    }
    if (req.method === "GET" && action === "logs")
      return json(
        res,
        200,
        ok(
          await managedContainerLogs(state, {
            sandboxId,
            tail: url.searchParams.get("tail")
              ? Number(url.searchParams.get("tail"))
              : undefined,
            since: url.searchParams.get("since") ?? undefined,
          }),
        ),
      );
    if (req.method === "GET" && action === "status")
      return json(
        res,
        200,
        ok(await managedSandboxStatus(state, controller, sandboxId)),
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
  throw new HttpError(404, "Not found", "NOT_FOUND");
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
    const container = await connectedContainerStatus(state, sandboxId);
    return sandboxSnapshotResultSchema.parse({
      connected: true,
      stale: false,
      lifecycle: await connectedLifecycle(state, sandboxId),
      container,
      ...(isObjectRecord(result) ? result : {}),
    });
  }
  return sandboxSnapshotResultSchema.parse(
    await managerDerivedSnapshot(state, sandboxId),
  );
}

async function managerDerivedSnapshot(
  state: ManagerState,
  sandboxId: string,
): Promise<Record<string, unknown>> {
  const view = await managerDerivedSandboxView(state, sandboxId);
  if (!view) throw new HttpError(404, "Sandbox not found", "NOT_FOUND");
  return view.snapshot;
}

async function connectedContainerStatus(
  state: ManagerState,
  sandboxId: string,
): Promise<unknown> {
  const record = await state.sandboxes.get(sandboxId);
  if (!record) return undefined;
  return (await deriveSandboxContainerStatus(state, record)).container;
}

async function connectedLifecycle(
  state: ManagerState,
  sandboxId: string,
): Promise<ReturnType<typeof lifecycleSummary> | undefined> {
  const record = await state.sandboxes.get(sandboxId);
  return record ? lifecycleSummary(record) : undefined;
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
    connectedAt: session.connectedAt ?? session.updatedAt,
    disconnectedAt: session.disconnectedAt,
    readyAt: session.readyAt,
    agentStatus: session.agentStatus,
    closeCode: session.closeCode,
    closeReason: session.closeReason?.trim() || undefined,
    acceptedCapabilities: session.capabilities,
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(`${JSON.stringify(body)}\n`);
}
