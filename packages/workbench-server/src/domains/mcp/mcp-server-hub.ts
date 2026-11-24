import {
  McpAbortError,
  McpClient,
  McpConnectionClosedError,
  McpError,
  McpSessionExpiredError,
  McpTimeoutError,
  StdioTransport,
  StreamableHttpTransport,
  type McpTransport,
} from "@earendil-works/pi-mcp";
import { pathToFileURL } from "node:url";
import { ToolExecutionError } from "@nervekit/tools/execution";
import type {
  McpAgentPort,
  McpResource,
  McpServerSummary,
  McpTool,
} from "@nervekit/tools/quick-script";
import {
  mcpEntrySecretNames,
  mcpRedactor,
  resolveMcpServer,
  type ResolvedMcpServer,
} from "./mcp-config.js";
import {
  MCP_SETTINGS_PAGE,
  type CatalogEntry,
  type McpCatalog,
} from "./mcp-catalog.js";
import type { McpSecrets } from "./mcp-secrets.js";
import type { McpToolIndex } from "./mcp-tool-index.js";
import { mcpBlock, mcpBlockMessage, type McpRun } from "./mcp-enablement.js";
import {
  failure,
  indexKeyOf,
  isApprovedAs,
  keyOf,
  notFound,
  projectOf,
  sameEntry,
  toTool,
  withTimeout,
  type Prepared,
} from "./mcp-hub-support.js";

/** Default per-request timeout when the entry sets none. */
const DEFAULT_TIMEOUT_MS = 120_000;
/** Connecting includes starting the program (`npx -y …` may download it). */
const CONNECT_TIMEOUT_MS = 60_000;
/** A connection nobody used for this long is closed; the next call reconnects. */
const DEFAULT_IDLE_MS = 10 * 60_000;
/** Stderr kept from a stdio server, to explain a failed start. */
const STDERR_TAIL_CHARS = 2_000;
/** JSON-RPC "invalid params"; servers also answer it for an unknown tool. */
const INVALID_PARAMS = -32602;

type Connection = {
  key: string;
  name: string;
  /** The catalog entry it was started from; a changed or withdrawn entry drops it. */
  entry: CatalogEntry;
  projectId?: string;
  projectDirectory: string;
  /** Where its tools are indexed. */
  indexKey: string;
  /** Hides the values this entry expanded in text that leaves the host. */
  redact: (text: string) => string;
  /** Closed on purpose (disconnect, a changed or withdrawn entry): a failure after that is not recorded. */
  superseded: boolean;
  client: McpClient;
  stderr: string;
  tools?: McpTool[];
  timeoutMs: number;
  idle?: NodeJS.Timeout;
  busy: number;
  /** Set once `connect` finished. */
  ready: boolean;
};

export type McpServerHubOptions = {
  version: string;
  catalog: McpCatalog;
  secrets: McpSecrets;
  index: McpToolIndex;
  idleMs?: number;
  /** Replaces the real transports (tests). */
  transport?: (server: ResolvedMcpServer) => McpTransport;
  warn?: (message: string, context: Record<string, unknown>) => void;
};

/** How a configured server stands, apart from consent and settings. */
export type McpConnectionStatus = {
  state: "connected" | "idle" | "failed";
  error?: string;
  server?: { name: string; version: string };
  instructions?: string;
  /** Tools in the index, once known. */
  toolCount?: number;
};

type RequestOptions = { signal?: AbortSignal };

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * The daemon's MCP connections. A server is started (stdio) or connected (HTTP) on first use and
 * shared by later calls with the same resolved entry; a stdio server runs per project directory,
 * which is its default `cwd` and the root offered to it. Idle connections close after ten
 * minutes. The files are re-read on every call, so edits apply to the next one. Nothing starts,
 * connects or is indexed before the user approved the exact entry, and a server the conversation's
 * settings turn off is left alone.
 */
export class McpServerHub {
  /** Every connection, including ones still connecting, by key. */
  readonly #connections = new Map<string, Connection>();
  readonly #pending = new Map<string, Promise<Connection>>();
  /** Last connection failure per key, until a later attempt succeeds. */
  readonly #failures = new Map<
    string,
    { message: string; entry: CatalogEntry; projectDirectory: string }
  >();
  /** Advances whenever approvals may have changed (`reconcile`); a start that began earlier checks again. */
  #generation = 0;
  #closed = false;

  constructor(private readonly options: McpServerHubOptions) {}

  /** The port a quick_script run uses. */
  port(run: McpRun): McpAgentPort {
    return {
      listServers: () => this.listServers(run),
      listTools: async (server, options) => {
        const target = await this.#target(server, run);
        // A server that was indexed answers without being started.
        if (!this.#connections.get(target.key)?.ready) {
          const indexed = await this.options.index
            .get(target.indexKey)
            .catch(() => undefined);
          if (indexed) return indexed;
        }
        return this.#use(target, options, (connection) =>
          this.#tools(connection, options),
        );
      },
      callTool: async (server, tool, args, options) =>
        this.#use(
          await this.#target(server, run),
          options,
          async (connection) => {
            try {
              return await connection.client.callTool(tool, args, {
                signal: options?.signal,
                timeoutMs: connection.timeoutMs,
              });
            } catch (error) {
              throw await this.#toolFailure(connection, tool, error, options);
            }
          },
        ),
      listResources: async (server, options) =>
        this.#use(
          await this.#target(server, run),
          options,
          async (connection) => {
            if (!connection.client.serverCapabilities?.resources) return [];
            const resources = await connection.client.listResources({
              signal: options?.signal,
              timeoutMs: connection.timeoutMs,
            });
            return resources.map(
              (resource): McpResource => ({
                server,
                uri: resource.uri,
                name: resource.name,
                ...(resource.title ? { title: resource.title } : {}),
                ...(resource.description
                  ? { description: resource.description }
                  : {}),
                ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
                ...(resource.size !== undefined ? { size: resource.size } : {}),
              }),
            );
          },
        ),
      readResource: async (server, uri, options) =>
        this.#use(
          await this.#target(server, run),
          options,
          async (connection) => {
            const result = await connection.client.readResource(uri, {
              signal: options?.signal,
              timeoutMs: connection.timeoutMs,
            });
            return result.contents;
          },
        ),
    };
  }

  /** Every configured server with its state; connects to none and waits for none. */
  async listServers(run: McpRun): Promise<McpServerSummary[]> {
    const view = await this.options.catalog.load(projectOf(run));
    const enablement = await run.enablement();
    const summaries: McpServerSummary[] = [];
    const rows = [
      ...view.active.map((entry) => ({ entry, duplicate: false })),
      ...view.waiting.map((entry) => ({ entry, duplicate: true })),
    ];
    for (const { entry, duplicate } of rows) {
      const base = {
        name: entry.name,
        ...(entry.server.config.description
          ? { description: entry.server.config.description }
          : {}),
        transport: entry.server.kind,
        scope: entry.scope,
        ...(duplicate ? { duplicate: true as const } : {}),
      };
      const block = mcpBlock(entry, enablement);
      if (block) {
        summaries.push({
          ...base,
          state: block,
          error: mcpBlockMessage(entry, block, enablement),
        });
        continue;
      }
      const status = await this.status(entry, run.projectDirectory);
      summaries.push({
        ...base,
        state: status.state,
        ...(status.error ? { error: status.error } : {}),
        ...(status.server ? { server: status.server } : {}),
        ...(status.instructions ? { instructions: status.instructions } : {}),
      });
    }
    return summaries;
  }

  /**
   * Whether the conversation has a server its settings leave on: then the `mcp` namespace is listed
   * in quick_script's description. A server waiting for approval counts, so the agent can say so.
   */
  async hasEnabledServers(run: McpRun): Promise<boolean> {
    const view = await this.options.catalog.load(projectOf(run));
    const enablement = await run.enablement();
    return view.active.some(
      (entry) => mcpBlock(entry, enablement) !== "disabled",
    );
  }

  /** Connections started from this entry (any project directory). */
  #matching(entry: CatalogEntry): Connection[] {
    return [...this.#connections.values()].filter((connection) =>
      sameEntry(connection.entry, entry),
    );
  }

  /** The connection state of an approved entry; `failed` also for variables or secrets that are not set. */
  async status(
    entry: CatalogEntry,
    projectDirectory: string,
  ): Promise<McpConnectionStatus> {
    let prepared: Prepared;
    try {
      prepared = await this.#prepare(entry, projectDirectory);
    } catch (error) {
      return { state: "failed", error: messageOf(error) };
    }
    // A stdio server runs per project directory: any of its connections says it is up.
    const live = this.#matching(entry).find((connection) => connection.ready);
    const toolCount = (
      await this.options.index
        .get(live?.indexKey ?? prepared.indexKey)
        .catch(() => undefined)
    )?.length;
    if (live) {
      const info = live.client.serverInfo;
      const instructions = live.client.instructions;
      return {
        state: "connected",
        ...(info ? { server: { name: info.name, version: info.version } } : {}),
        ...(instructions ? { instructions } : {}),
        ...(toolCount !== undefined ? { toolCount } : {}),
      };
    }
    const failed = [...this.#failures.values()].find((failure) =>
      sameEntry(failure.entry, entry),
    );
    return {
      state: failed ? "failed" : "idle",
      ...(failed ? { error: failed.message } : {}),
      ...(toolCount !== undefined ? { toolCount } : {}),
    };
  }

  /** Connects an approved entry and reports what the server offers (Settings → Test). */
  async inspect(
    entry: CatalogEntry,
    projectDirectory: string,
  ): Promise<
    | {
        ok: true;
        server?: { name: string; version: string };
        instructions?: string;
        tools: McpTool[];
        resources: McpResource[];
      }
    | { ok: false; error: string }
  > {
    // Consent is checked here, whatever the caller did: a pending entry is never started.
    const review = this.options.catalog.review(
      entry.scope,
      entry.projectId,
      entry.name,
      entry.digest,
    );
    if (review !== "approved")
      return {
        ok: false,
        error: mcpBlockMessage(entry, review),
      };
    try {
      const prepared = await this.#prepare(entry, projectDirectory);
      return await this.#use(prepared, undefined, async (connection) => {
        const tools = await this.#tools(connection, undefined);
        const resources = connection.client.serverCapabilities?.resources
          ? (
              await connection.client.listResources({
                timeoutMs: connection.timeoutMs,
              })
            ).map(
              (resource): McpResource => ({
                server: entry.name,
                uri: resource.uri,
                name: resource.name,
                ...(resource.description
                  ? { description: resource.description }
                  : {}),
                ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
              }),
            )
          : [];
        const info = connection.client.serverInfo;
        const instructions = connection.client.instructions;
        return {
          ok: true as const,
          ...(info
            ? { server: { name: info.name, version: info.version } }
            : {}),
          ...(instructions ? { instructions } : {}),
          tools,
          resources,
        };
      });
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
  }

  /** Closes every running connection of the entry, whatever project directory it started in; true when there was one. */
  async disconnect(entry: CatalogEntry): Promise<boolean> {
    const connections = this.#matching(entry);
    for (const [key, failure] of this.#failures)
      if (sameEntry(failure.entry, entry)) this.#failures.delete(key);
    for (const connection of connections) {
      connection.superseded = true;
      this.#drop(connection);
    }
    return connections.length > 0;
  }

  /**
   * After an approval, a file edit or a removal: closes connections whose entry is gone, changed or
   * no longer approved, and forgets their failures and index.
   */
  async reconcile(): Promise<void> {
    // A start that began before this must check approval again before it connects.
    this.#generation++;
    const currentOf = async (entry: CatalogEntry, projectDirectory: string) => {
      const view = await this.options.catalog.load(
        entry.projectId
          ? { projectId: entry.projectId, projectDirectory }
          : undefined,
      );
      return view.active.find((candidate) => candidate.name === entry.name);
    };
    for (const connection of [...this.#connections.values()]) {
      const current = await currentOf(
        connection.entry,
        connection.projectDirectory,
      );
      if (current && isApprovedAs(current, connection.entry)) continue;
      connection.superseded = true;
      this.#drop(connection);
      this.#failures.delete(connection.key);
      if (!current || current.digest !== connection.entry.digest)
        await this.options.index
          .delete(connection.indexKey)
          .catch(() => undefined);
    }
    for (const [key, failure] of [...this.#failures]) {
      const current = await currentOf(failure.entry, failure.projectDirectory);
      if (!current || !isApprovedAs(current, failure.entry))
        this.#failures.delete(key);
    }
    this.#generation++;
  }

  /** Closes every connection, including ones still connecting (daemon shutdown). */
  async close(): Promise<void> {
    this.#closed = true;
    const connections = [...this.#connections.values()];
    this.#connections.clear();
    this.#pending.clear();
    await Promise.allSettled(
      connections.map(async (connection) => {
        clearTimeout(connection.idle);
        await connection.client.close();
      }),
    );
  }

  /** The entry a name resolves to for this run, if it may run. */
  async #target(name: string, run: McpRun): Promise<Prepared> {
    if (this.#closed) throw failure("SERVER_ERROR", "Nerve is shutting down.");
    const view = await this.options.catalog.load(projectOf(run));
    const entry = view.active.find((candidate) => candidate.name === name);
    if (!entry) throw notFound(name, view);
    const enablement = await run.enablement();
    const block = mcpBlock(entry, enablement);
    if (block)
      throw failure(
        "FORBIDDEN",
        `MCP server "${name}": ${mcpBlockMessage(entry, block, enablement)} Retrying does not help until then; tell the user.`,
      );
    try {
      return await this.#prepare(entry, run.projectDirectory);
    } catch (error) {
      throw failure(
        "SERVER_ERROR",
        `MCP server "${name}": ${messageOf(error)}.`,
      );
    }
  }

  /** Expands the entry (variables and secrets of its own scope) and keys it. Starts nothing. */
  async #prepare(
    entry: CatalogEntry,
    projectDirectory: string,
  ): Promise<Prepared> {
    const generation = this.#generation;
    const secrets = await this.options.secrets.values(
      entry.scope,
      entry.projectId,
      mcpEntrySecretNames(entry.server.config),
    );
    const expansion = { env: process.env, secrets };
    const resolved = resolveMcpServer(
      entry.server,
      projectDirectory,
      expansion,
      MCP_SETTINGS_PAGE[entry.scope],
    );
    return {
      entry,
      resolved,
      projectDirectory,
      generation,
      key: keyOf(entry, resolved, projectDirectory),
      indexKey: indexKeyOf(entry, resolved, projectDirectory),
      redact: mcpRedactor(entry.server.config, expansion),
    };
  }

  /**
   * Approval may be withdrawn between choosing the entry and starting it: when approvals changed
   * since the target was prepared, look at the files and the decision again.
   */
  async #assertStillApproved(target: Prepared): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (target.generation === this.#generation) return;
      target.generation = this.#generation;
      const view = await this.options.catalog.load(
        target.entry.projectId
          ? {
              projectId: target.entry.projectId,
              projectDirectory: target.projectDirectory,
            }
          : undefined,
      );
      const current = view.active.find(
        (entry) => entry.name === target.entry.name,
      );
      if (!current || !isApprovedAs(current, target.entry))
        throw failure(
          "FORBIDDEN",
          `MCP server "${target.entry.name}": the entry changed or lost its approval while the call started. ${mcpBlockMessage(current ?? target.entry, current?.review === "rejected" ? "rejected" : "needs_approval")} Retrying does not help until then; tell the user.`,
        );
    }
  }

  async #use<T>(
    target: Prepared,
    options: RequestOptions | undefined,
    run: (connection: Connection) => Promise<T>,
  ): Promise<T> {
    if (this.#closed) throw failure("SERVER_ERROR", "Nerve is shutting down.");
    options?.signal?.throwIfAborted();
    await this.#assertStillApproved(target);
    const connection = await this.#connect(target);
    connection.busy += 1;
    clearTimeout(connection.idle);
    try {
      return await run(connection);
    } catch (error) {
      // A dropped connection or an expired HTTP session never recovers: the next call reconnects.
      if (
        error instanceof McpSessionExpiredError ||
        error instanceof McpConnectionClosedError
      )
        this.#drop(connection);
      if (error instanceof ToolExecutionError) throw error;
      throw failure(
        "SERVER_ERROR",
        `MCP server "${target.entry.name}": ${target.redact(messageOf(error))}`,
      );
    } finally {
      connection.busy -= 1;
      this.#scheduleIdle(connection);
    }
  }

  /** A failed `tools/call`, said so the agent knows whether retrying is safe. */
  async #toolFailure(
    connection: Connection,
    tool: string,
    error: unknown,
    options: RequestOptions | undefined,
  ): Promise<Error> {
    const prefix = `MCP server "${connection.name}"`;
    if (error instanceof McpError && error.code === INVALID_PARAMS) {
      const tools = await this.#tools(connection, options).catch(
        () => undefined,
      );
      if (tools && !tools.some((entry) => entry.name === tool))
        return failure(
          "NOT_FOUND",
          `${prefix} has no tool "${tool}". Its tools: ${tools.map((entry) => entry.name).join(", ") || "none"}.`,
        );
      return failure(
        "SERVER_ERROR",
        `${prefix}: ${connection.redact(error.message)} (invalid arguments: check the tool's inputSchema with mcp.tools.get).`,
      );
    }
    if (error instanceof McpTimeoutError || error instanceof McpAbortError)
      return failure(
        "SERVER_ERROR",
        `${prefix}: ${connection.redact(error.message)}. The tool may have run; check its effect before calling it again.`,
      );
    return error instanceof Error
      ? new Error(connection.redact(error.message), { cause: error })
      : new Error(connection.redact(String(error)));
  }

  #connect(target: Prepared): Promise<Connection> {
    const { key, entry, resolved, projectDirectory } = target;
    const existing = this.#pending.get(key);
    if (existing) return existing;
    const timeoutMs = entry.server.config.timeout
      ? entry.server.config.timeout * 1000
      : DEFAULT_TIMEOUT_MS;
    const connection: Connection = {
      key,
      name: entry.name,
      entry,
      ...(entry.projectId ? { projectId: entry.projectId } : {}),
      projectDirectory,
      indexKey: target.indexKey,
      redact: target.redact,
      superseded: false,
      client: new McpClient({
        name: "nerve",
        version: this.options.version,
        requestTimeoutMs: timeoutMs,
        // Only a local server can use a local path.
        ...(resolved.kind === "stdio"
          ? {
              roots: [
                { uri: pathToFileURL(projectDirectory).href, name: "project" },
              ],
            }
          : {}),
      }),
      stderr: "",
      timeoutMs,
      busy: 0,
      ready: false,
    };
    const verb = resolved.kind === "stdio" ? "start" : "connect";
    const pending = (async (): Promise<Connection> => {
      const transport =
        this.options.transport?.(resolved) ??
        (resolved.kind === "stdio"
          ? new StdioTransport({
              command: resolved.command,
              args: resolved.args,
              env: resolved.env,
              cwd: resolved.cwd,
              stderr: "pipe",
              onStderr: (chunk) => {
                connection.stderr = (connection.stderr + chunk).slice(
                  -STDERR_TAIL_CHARS,
                );
              },
            })
          : new StreamableHttpTransport({
              url: resolved.url,
              headers: resolved.headers,
            }));
      connection.client.onClose(() => this.#drop(connection));
      connection.client.onNotification(
        "notifications/tools/list_changed",
        () => {
          connection.tools = undefined;
          void this.#refreshIndex(connection);
        },
      );
      try {
        await withTimeout(
          connection.client.connect(transport),
          CONNECT_TIMEOUT_MS,
          `no answer within ${CONNECT_TIMEOUT_MS / 1000} s`,
        );
      } catch (error) {
        await connection.client.close().catch(() => undefined);
        const stderr = connection.stderr.trim();
        // Servers print what they were given, and HTTP errors echo headers: hide expanded values.
        const reason = target.redact(
          `${messageOf(error)}${stderr ? `\nstderr: ${stderr}` : ""}`,
        );
        this.options.warn?.(`MCP server failed to ${verb}`, {
          server: entry.name,
          error: reason,
        });
        throw new Error(reason, { cause: error });
      }
      if (this.#closed || connection.superseded) {
        await connection.client.close().catch(() => undefined);
        throw new Error(
          this.#closed
            ? "Nerve is shutting down"
            : "The entry changed or lost its approval while it started",
        );
      }
      connection.ready = true;
      // Fill the index in the background: a later search answers without starting the server.
      void this.#refreshIndex(connection);
      return connection;
    })();
    this.#connections.set(key, connection);
    this.#pending.set(key, pending);
    pending.then(
      () => this.#failures.delete(key),
      (error: unknown) => {
        this.#drop(connection);
        // An entry withdrawn while it started has no failure to remember.
        if (!connection.superseded)
          this.#failures.set(key, {
            message: messageOf(error),
            entry,
            projectDirectory,
          });
      },
    );
    return pending.catch((error: unknown) => {
      throw failure(
        "SERVER_ERROR",
        `MCP server "${entry.name}" could not ${verb}: ${messageOf(error)}`,
      );
    });
  }

  /** Forgets a connection (only if it is still the one registered under its key) and closes it. */
  #drop(connection: Connection) {
    clearTimeout(connection.idle);
    if (this.#connections.get(connection.key) === connection) {
      this.#connections.delete(connection.key);
      this.#pending.delete(connection.key);
    }
    if (connection.client.connectionState !== "closed")
      void connection.client.close().catch(() => undefined);
  }

  async #tools(
    connection: Connection,
    options: RequestOptions | undefined,
  ): Promise<McpTool[]> {
    if (connection.tools) return connection.tools;
    if (!connection.client.serverCapabilities?.tools) return [];
    const tools = await connection.client.listTools({
      signal: options?.signal,
      timeoutMs: connection.timeoutMs,
    });
    connection.tools = tools.map((tool) => toTool(connection.name, tool));
    await this.options.index
      .set(connection.indexKey, connection.tools)
      .catch(() => undefined);
    return connection.tools;
  }

  /** Re-reads the tools after connecting or a `list_changed` notification; a failure drops the stale index. */
  async #refreshIndex(connection: Connection): Promise<void> {
    if (!this.#connections.has(connection.key)) return;
    try {
      await this.#tools(connection, undefined);
    } catch {
      await this.options.index
        .delete(connection.indexKey)
        .catch(() => undefined);
    }
  }

  #scheduleIdle(connection: Connection) {
    if (
      connection.busy > 0 ||
      this.#closed ||
      this.#connections.get(connection.key) !== connection
    )
      return;
    clearTimeout(connection.idle);
    connection.idle = setTimeout(() => {
      if (connection.busy === 0) this.#drop(connection);
    }, this.options.idleMs ?? DEFAULT_IDLE_MS);
    connection.idle.unref();
  }
}
