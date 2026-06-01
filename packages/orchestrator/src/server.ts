import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compactSessionRequestSchema,
  createAgentRequestSchema,
  createId,
  createProjectRequestSchema,
  createSessionRequestSchema,
  type DaemonFile,
  executeToolRequestSchema,
  importSessionRequestSchema,
  navigateSessionRequestSchema,
  parseCookieHeader,
  processLogQuerySchema,
  promptRequestSchema,
  resolveApprovalRequestSchema,
  type StatusResponse,
  setProviderApiKeyRequestSchema,
  startProcessRequestSchema,
  stopProcessRequestSchema,
  updateAgentRequestSchema,
  updateSettingsRequestSchema,
} from "@nerve/shared";
import { Hono } from "hono";
import { EventBus } from "./events.js";
import { IndexStore } from "./index-store.js";
import {
  errorResponse,
  providerEnvVar,
  providerSecretName,
  RuntimeRegistry,
} from "./registry.js";
import type { SecretProvider } from "./secrets.js";
import { EncryptedFileSecretProvider } from "./secrets.js";
import type { InitializedStorage } from "./storage.js";
import { writeSettings } from "./storage.js";

export const version = "0.0.0";

export interface OrchestratorState {
  daemonId: string;
  startedAt: string;
  host: string;
  port: number;
  storage: InitializedStorage;
  events: EventBus;
  registry: RuntimeRegistry;
  index: IndexStore;
  secrets: SecretProvider;
}

export function createOrchestratorState(
  storage: InitializedStorage,
  host: string,
  port: number,
): OrchestratorState {
  const index = new IndexStore(storage.paths.sqlitePath);
  index.initialize();
  const events = new EventBus(storage.paths.home, index);
  const secrets = new EncryptedFileSecretProvider(storage.paths.home);
  return {
    daemonId: createId("daemon"),
    startedAt: new Date().toISOString(),
    host,
    port,
    storage,
    events,
    registry: new RuntimeRegistry(storage, events, index, secrets),
    index,
    secrets,
  };
}

export function toDaemonFile(state: OrchestratorState): DaemonFile {
  return {
    daemonId: state.daemonId,
    pid: process.pid,
    host: state.host,
    port: state.port,
    url: `http://${state.host}:${state.port}`,
    startedAt: state.startedAt,
    dataDir: state.storage.paths.home,
    version,
  };
}

export function statusResponse(state: OrchestratorState): StatusResponse {
  return {
    daemonId: state.daemonId,
    version,
    startedAt: state.startedAt,
    dataDir: state.storage.paths.home,
    storage: {
      home: state.storage.paths.home,
      sqlitePath: state.storage.paths.sqlitePath,
      indexHealthy: state.index.isHealthy,
    },
  };
}

function isAuthorized(request: Request, token: string): boolean {
  const authorization = request.headers.get("authorization");
  if (authorization === `Bearer ${token}`) return true;
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  return cookies.nerve_token === token;
}

function unauthorized() {
  return new Response(
    JSON.stringify({
      error: {
        code: "UNAUTHORIZED",
        message: "Missing or invalid local token.",
      },
    }),
    {
      status: 401,
      headers: { "content-type": "application/json" },
    },
  );
}

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function cookieHeader(token: string): string {
  return `nerve_token=${encodeURIComponent(token)}; Path=/; SameSite=Strict; Max-Age=31536000`;
}

function fallbackHtml(state: OrchestratorState): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>nerve</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #070a10; color: #eef2ff; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
      main { width: min(760px, calc(100vw - 48px)); border: 1px solid #243047; border-radius: 24px; padding: 32px; background: linear-gradient(145deg, #111827, #0b1020); box-shadow: 0 30px 100px rgba(0,0,0,.45); }
      .eyebrow { color: #7dd3fc; text-transform: uppercase; letter-spacing: .2em; font-size: 12px; }
      h1 { font-size: 44px; margin: 12px 0; }
      p { color: #b9c4d8; line-height: 1.6; }
      code { background: #020617; border: 1px solid #243047; border-radius: 8px; padding: 3px 7px; }
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">orchestrator online</div>
      <h1>nerve</h1>
      <p>The daemon is running at <code>http://${state.host}:${state.port}</code>.</p>
      <p>Build the Svelte UI with <code>pnpm --filter @nerve/web build</code> to replace this fallback shell.</p>
    </main>
  </body>
</html>`;
}

async function serveStatic(
  pathname: string,
  state: OrchestratorState,
): Promise<Response> {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const webDist = resolve(moduleDir, "..", "..", "web", "dist");
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const normalizedPath = resolve(webDist, `.${requestedPath}`);
  const finalPath = normalizedPath.startsWith(webDist)
    ? normalizedPath
    : join(webDist, "index.html");

  try {
    const contents = await readFile(finalPath);
    return new Response(contents, {
      headers: {
        "content-type":
          contentTypes[extname(finalPath)] ?? "application/octet-stream",
        "set-cookie": cookieHeader(state.storage.localToken),
      },
    });
  } catch {
    if (pathname.includes("."))
      return new Response("Not found", { status: 404 });
    return new Response(fallbackHtml(state), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "set-cookie": cookieHeader(state.storage.localToken),
      },
    });
  }
}

type CompletionItem = {
  label: string;
  detail?: string;
  info?: string;
  kind: "slash" | "file" | "directory";
  apply?: string;
};

const slashCompletionItems: CompletionItem[] = [
  {
    label: "/plan",
    detail: "Start in planning mode",
    info: "Ask the agent to inspect first and produce a short plan before changing files.",
    kind: "slash",
  },
  {
    label: "/code",
    detail: "Switch to implementation",
    info: "Frame the next prompt as a coding task.",
    kind: "slash",
  },
  {
    label: "/status",
    detail: "Summarize current session state",
    info: "Useful before handing off or resuming a durable session.",
    kind: "slash",
  },
  {
    label: "/abort",
    detail: "Stop the active run",
    info: "Cancels the active agent run from the UI.",
    kind: "slash",
  },
];

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function numberQuery(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function fileCompletionItems(
  state: OrchestratorState,
  projectId: string | undefined,
  query: string,
): Promise<CompletionItem[]> {
  if (!projectId) return [];
  const project = state.registry.getProject(projectId);
  const root = resolve(project.dir);
  const normalizedQuery = query.replace(/^@/, "").replaceAll("\\", "/");
  const directoryPart = normalizedQuery.endsWith("/")
    ? normalizedQuery
    : dirname(normalizedQuery);
  const basePart = normalizedQuery.endsWith("/")
    ? ""
    : basename(normalizedQuery);
  const relativeDirectory = directoryPart === "." ? "" : directoryPart;
  const targetDirectory = resolve(root, relativeDirectory);
  if (!isInside(root, targetDirectory)) return [];

  const entries = await readdir(targetDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => !entry.name.startsWith("."))
    .filter((entry) =>
      entry.name.toLowerCase().startsWith(basePart.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.isDirectory()) - Number(a.isDirectory()) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 40)
    .map((entry) => {
      const relativePath = join(relativeDirectory, entry.name).replaceAll(
        "\\",
        "/",
      );
      const isDirectory = entry.isDirectory();
      return {
        label: `@${relativePath}${isDirectory ? "/" : ""}`,
        apply: `@${relativePath}${isDirectory ? "/" : ""}`,
        detail: isDirectory ? "folder" : "file",
        info: relativePath,
        kind: isDirectory ? "directory" : "file",
      } satisfies CompletionItem;
    });
}

export function createApp(state: OrchestratorState): Hono {
  const app = new Hono();

  app.use("/api/*", async (c, next) => {
    if (!isAuthorized(c.req.raw, state.storage.localToken))
      return c.body(await unauthorized().text(), 401, {
        "content-type": "application/json",
      });
    await next();
  });

  app.get("/api/status", (c) => c.json(statusResponse(state)));
  app.get("/api/settings", (c) => c.json(state.storage.settings));
  app.put("/api/settings", async (c) => {
    try {
      const body = updateSettingsRequestSchema.parse(await c.req.json());
      const settings = await writeSettings(state.storage, body);
      await state.events.publish("settings.updated", { settings });
      return c.json({ settings });
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.get("/api/provider-keys", async (c) => {
    const providers = new Set(
      state.registry
        .listModels()
        .map((model) => model.provider)
        .filter((provider) => provider !== "nerve-faux"),
    );
    for (const name of await state.secrets.list()) {
      const match = /^provider:(.+):apiKey$/.exec(name);
      if (match) providers.add(match[1]);
    }
    const configured = new Set(await state.secrets.list());
    return c.json({
      keys: [...providers].sort().map((provider) => ({
        provider,
        envVar: providerEnvVar(provider),
        configured: configured.has(providerSecretName(provider)),
      })),
    });
  });
  app.put("/api/provider-keys", async (c) => {
    try {
      const body = setProviderApiKeyRequestSchema.parse(await c.req.json());
      await state.secrets.set(providerSecretName(body.provider), body.apiKey);
      await state.events.publish("secrets.provider_key_set", {
        provider: body.provider,
        envVar: providerEnvVar(body.provider),
      });
      return c.json({ ok: true });
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.delete("/api/provider-keys/:provider", async (c) => {
    const provider = c.req.param("provider");
    await state.secrets.delete(providerSecretName(provider));
    await state.events.publish("secrets.provider_key_deleted", { provider });
    return c.json({ ok: true });
  });
  app.get("/api/storage", (c) =>
    c.json({
      dataDir: state.storage.paths.home,
      sqlitePath: state.storage.paths.sqlitePath,
      configPath: state.storage.paths.configPath,
      counts: state.index.counts(),
    }),
  );
  app.post("/api/storage/rebuild-index", async (c) => {
    try {
      await state.registry.rebuildIndex();
      return c.json({ ok: true, counts: state.index.counts() });
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.get("/api/events", async (c) => {
    const since = Number(c.req.query("since") ?? "0");
    return c.json({
      events: await state.events.replayPersistedSince(
        Number.isFinite(since) ? since : 0,
      ),
    });
  });
  app.get("/api/models", (c) =>
    c.json({ models: state.registry.listModels() }),
  );
  app.get("/api/tools", (c) =>
    c.json({ tools: state.registry.tools.listTools() }),
  );
  app.get("/api/tool-calls", (c) =>
    c.json({ toolCalls: state.registry.tools.listToolCalls() }),
  );
  app.get("/api/workers", (c) =>
    c.json({ workers: state.registry.listWorkers() }),
  );
  app.get("/api/workers/:workerId", (c) => {
    try {
      return c.json({
        worker: state.registry.getWorker(c.req.param("workerId")),
      });
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.get("/api/processes", (c) =>
    c.json({ processes: state.registry.listProcesses() }),
  );
  app.post("/api/processes", async (c) => {
    try {
      const body = startProcessRequestSchema.parse(await c.req.json());
      return c.json({ process: await state.registry.startProcess(body) }, 201);
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.get("/api/processes/:processId", (c) => {
    try {
      return c.json({
        process: state.registry.getProcess(c.req.param("processId")),
      });
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.post("/api/processes/:processId/stop", async (c) => {
    try {
      const body = stopProcessRequestSchema.parse(
        await c.req.json().catch(() => ({})),
      );
      return c.json({
        process: await state.registry.stopProcess(
          c.req.param("processId"),
          body,
        ),
      });
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.post("/api/processes/:processId/restart", async (c) => {
    try {
      return c.json({
        process: await state.registry.restartProcess(c.req.param("processId")),
      });
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.get("/api/processes/:processId/logs", async (c) => {
    try {
      const query = processLogQuerySchema.parse({
        mode: c.req.query("mode"),
        sinceSeq: numberQuery(c.req.query("sinceSeq")),
        contains: c.req.query("contains"),
        regex: c.req.query("regex"),
        contextLines: numberQuery(c.req.query("contextLines")),
        limit: numberQuery(c.req.query("limit")),
      });
      return c.json(
        await state.registry.queryProcessLogs(c.req.param("processId"), query),
      );
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.get("/api/approvals", (c) => {
    const status = c.req.query("status");
    return c.json({
      approvals: state.registry.tools.listApprovals(
        status === "pending" || status === "granted" || status === "denied"
          ? status
          : undefined,
      ),
    });
  });
  app.get("/api/completions/slash", (c) =>
    c.json({ items: slashCompletionItems }),
  );
  app.get("/api/completions/files", async (c) => {
    try {
      return c.json({
        items: await fileCompletionItems(
          state,
          c.req.query("projectId"),
          c.req.query("q") ?? "",
        ),
      });
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.post("/api/projects", async (c) => {
    try {
      const body = createProjectRequestSchema.parse(await c.req.json());
      return c.json({ project: await state.registry.createProject(body) }, 201);
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.get("/api/projects", (c) =>
    c.json({ projects: state.registry.listProjects() }),
  );
  app.get("/api/projects/:projectId", (c) => {
    try {
      return c.json({
        project: state.registry.getProject(c.req.param("projectId")),
      });
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.post("/api/sessions", async (c) => {
    try {
      const body = createSessionRequestSchema.parse(await c.req.json());
      return c.json({ session: await state.registry.createSession(body) }, 201);
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.post("/api/import/session", async (c) => {
    try {
      const body = importSessionRequestSchema.parse(await c.req.json());
      return c.json(await state.registry.importSession(body), 201);
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.get("/api/sessions", (c) =>
    c.json({ sessions: state.registry.listSessions() }),
  );
  app.get("/api/sessions/:sessionId", (c) => {
    try {
      return c.json({
        session: state.registry.getSession(c.req.param("sessionId")),
      });
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.get("/api/sessions/:sessionId/messages", (c) => {
    try {
      return c.json({
        entries: state.registry.getSessionEntries(c.req.param("sessionId")),
      });
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.get("/api/sessions/:sessionId/export", (c) => {
    try {
      return c.json(state.registry.exportSession(c.req.param("sessionId")));
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.get("/api/sessions/:sessionId/export.md", (c) => {
    try {
      return c.text(
        state.registry.exportSessionMarkdown(c.req.param("sessionId")),
        200,
        {
          "content-type": "text/markdown; charset=utf-8",
        },
      );
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.get("/api/sessions/:sessionId/export.html", (c) => {
    try {
      return c.html(state.registry.exportSessionHtml(c.req.param("sessionId")));
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.get("/api/sessions/:sessionId/tree", (c) => {
    try {
      return c.json({
        tree: state.registry.getSessionTree(c.req.param("sessionId")),
      });
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.post("/api/sessions/:sessionId/navigate", async (c) => {
    try {
      const body = navigateSessionRequestSchema.parse(await c.req.json());
      return c.json({
        session: await state.registry.navigateSession(
          c.req.param("sessionId"),
          body,
        ),
      });
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.post("/api/sessions/:sessionId/compact", async (c) => {
    try {
      const body = compactSessionRequestSchema.parse(
        await c.req.json().catch(() => ({})),
      );
      return c.json(
        await state.registry.compactSession(c.req.param("sessionId"), body),
      );
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.post("/api/agents", async (c) => {
    try {
      const body = createAgentRequestSchema.parse(await c.req.json());
      return c.json({ agent: await state.registry.createAgent(body) }, 201);
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.get("/api/agents", (c) =>
    c.json({ agents: state.registry.listAgents() }),
  );
  app.get("/api/agents/:agentId", (c) => {
    try {
      return c.json({ agent: state.registry.getAgent(c.req.param("agentId")) });
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.patch("/api/agents/:agentId", async (c) => {
    try {
      const body = updateAgentRequestSchema.parse(await c.req.json());
      return c.json({
        agent: await state.registry.configureAgent(
          c.req.param("agentId"),
          body,
        ),
      });
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.post("/api/agents/:agentId/prompt", async (c) => {
    try {
      const body = promptRequestSchema.parse(await c.req.json());
      await state.registry.promptAgent(c.req.param("agentId"), body);
      return c.json({ ok: true }, 202);
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.post("/api/agents/:agentId/tools", async (c) => {
    try {
      const body = executeToolRequestSchema.parse(await c.req.json());
      const result = await state.registry.requestTool(
        c.req.param("agentId"),
        body.toolName,
        body.args,
      );
      return c.json(result, result.approval ? 202 : 200);
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.post("/api/approvals/:approvalId/grant", async (c) => {
    try {
      const body = resolveApprovalRequestSchema.parse(
        await c.req.json().catch(() => ({})),
      );
      return c.json({
        toolCall: await state.registry.grantApproval(
          c.req.param("approvalId"),
          body.note,
        ),
      });
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.post("/api/approvals/:approvalId/deny", async (c) => {
    try {
      const body = resolveApprovalRequestSchema.parse(
        await c.req.json().catch(() => ({})),
      );
      return c.json({
        toolCall: await state.registry.denyApproval(
          c.req.param("approvalId"),
          body.note,
        ),
      });
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.post("/api/agents/:agentId/abort", async (c) => {
    try {
      await state.registry.abortAgent(c.req.param("agentId"));
      return c.json({ ok: true });
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.get("/api/client-config", (c) =>
    c.json({
      url: `http://${state.host}:${state.port}`,
      wsUrl: `ws://${state.host}:${state.port}/ws`,
      status: statusResponse(state),
    }),
  );

  app.get("*", async (c) => serveStatic(new URL(c.req.url).pathname, state));

  return app;
}

export function isWebSocketAuthorized(
  request: import("node:http").IncomingMessage,
  token: string,
): boolean {
  const authorization = request.headers.authorization;
  if (authorization === `Bearer ${token}`) return true;
  const cookies = parseCookieHeader(request.headers.cookie);
  if (cookies.nerve_token === token) return true;
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  return url.searchParams.get("token") === token;
}
