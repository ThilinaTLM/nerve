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
  type Tool,
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
  readMcpConfig,
  resolveMcpServer,
  type McpServerEntry,
  type ResolvedMcpServer,
} from "./mcp-config.js";

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
  home: string;
  version: string;
  idleMs?: number;
  /** Replaces the real transports (tests). */
  transport?: (server: ResolvedMcpServer) => McpTransport;
  warn?: (message: string, context: Record<string, unknown>) => void;
};

type RequestOptions = { signal?: AbortSignal };

const failure = (code: "NOT_FOUND" | "SERVER_ERROR", message: string) =>
  new ToolExecutionError(code, message);

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * The daemon's MCP connections. A server is started (stdio) or connected (HTTP) on first use and
 * shared by later calls with the same resolved entry; a stdio server runs per project directory,
 * which is its default `cwd` and the root offered to it. Idle connections close after ten
 * minutes. The configuration is re-read on every call, so edits to mcp.json apply to the next one.
 */
export class McpServerHub {
  /** Every connection, including ones still connecting, by key. */
  readonly #connections = new Map<string, Connection>();
  readonly #pending = new Map<string, Promise<Connection>>();
  /** Last connection failure per key, until a later attempt succeeds. */
  readonly #failures = new Map<string, string>();
  #closed = false;

  constructor(private readonly options: McpServerHubOptions) {}

  /** The port a quick_script run uses; `projectDirectory` is the default cwd and the root offered to stdio servers. */
  port(projectDirectory: string): McpAgentPort {
    return {
      listServers: () => this.listServers(projectDirectory),
      listTools: (server, options) =>
        this.#use(server, projectDirectory, options, (connection) =>
          this.#tools(connection, options),
        ),
      callTool: (server, tool, args, options) =>
        this.#use(server, projectDirectory, options, async (connection) => {
          try {
            return await connection.client.callTool(tool, args, {
              signal: options?.signal,
              timeoutMs: connection.timeoutMs,
            });
          } catch (error) {
            throw await this.#toolFailure(connection, tool, error, options);
          }
        }),
      listResources: (server, options) =>
        this.#use(server, projectDirectory, options, async (connection) => {
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
        }),
      readResource: (server, uri, options) =>
        this.#use(server, projectDirectory, options, async (connection) => {
          const result = await connection.client.readResource(uri, {
            signal: options?.signal,
            timeoutMs: connection.timeoutMs,
          });
          return result.contents;
        }),
    };
  }

  /** Every configured server with its state; connects to none and waits for none. */
  async listServers(projectDirectory: string): Promise<McpServerSummary[]> {
    const file = await readMcpConfig(this.options.home);
    return file.servers.map((entry): McpServerSummary => {
      const base = {
        name: entry.name,
        ...(entry.config.description
          ? { description: entry.config.description }
          : {}),
        transport: entry.kind,
      };
      if (entry.config.enabled === false) return { ...base, state: "disabled" };
      let key: string;
      try {
        key = keyOf(
          entry,
          resolveMcpServer(entry, projectDirectory),
          projectDirectory,
        );
      } catch (error) {
        return { ...base, state: "failed", error: messageOf(error) };
      }
      const connection = this.#connections.get(key);
      if (connection?.ready) {
        const info = connection.client.serverInfo;
        const instructions = connection.client.instructions;
        return {
          ...base,
          state: "connected",
          ...(info
            ? { server: { name: info.name, version: info.version } }
            : {}),
          ...(instructions ? { instructions } : {}),
        };
      }
      const failed = this.#failures.get(key);
      return failed
        ? { ...base, state: "failed", error: failed }
        : { ...base, state: "idle" };
    });
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

  async #entry(name: string): Promise<McpServerEntry> {
    const file = await readMcpConfig(this.options.home);
    const entry = file.servers.find((server) => server.name === name);
    if (entry) {
      if (entry.config.enabled === false)
        throw failure(
          "NOT_FOUND",
          `MCP server "${name}" is disabled in ${file.path} ("enabled": false).`,
        );
      return entry;
    }
    const invalid = file.problems.find((problem) =>
      problem.startsWith(`server "${name}"`),
    );
    if (invalid)
      throw failure("NOT_FOUND", `MCP server "${name}": ${invalid}.`);
    if (file.servers.length > 0)
      throw failure(
        "NOT_FOUND",
        `No MCP server "${name}". Configured: ${file.servers.map((server) => server.name).join(", ")}.`,
      );
    throw failure(
      "NOT_FOUND",
      file.problems.length > 0
        ? `${file.path} is invalid: ${file.problems.join("; ")}.`
        : `No MCP servers are configured. Add them to ${file.path} (see the configure-nerve skill).`,
    );
  }

  async #use<T>(
    name: string,
    projectDirectory: string,
    options: RequestOptions | undefined,
    run: (connection: Connection) => Promise<T>,
  ): Promise<T> {
    if (this.#closed) throw failure("SERVER_ERROR", "Nerve is shutting down.");
    const entry = await this.#entry(name);
    let resolved: ResolvedMcpServer;
    try {
      resolved = resolveMcpServer(entry, projectDirectory);
    } catch (error) {
      throw failure(
        "SERVER_ERROR",
        `MCP server "${name}": ${messageOf(error)}.`,
      );
    }
    options?.signal?.throwIfAborted();
    const connection = await this.#connect(
      keyOf(entry, resolved, projectDirectory),
      entry,
      resolved,
      projectDirectory,
    );
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
        `MCP server "${name}": ${messageOf(error)}`,
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
        `${prefix}: ${error.message} (invalid arguments: check the tool's inputSchema with mcp.tools.get).`,
      );
    }
    if (error instanceof McpTimeoutError || error instanceof McpAbortError)
      return failure(
        "SERVER_ERROR",
        `${prefix}: ${error.message}. The tool may have run; check its effect before calling it again.`,
      );
    return error instanceof Error ? error : new Error(String(error));
  }

  #connect(
    key: string,
    entry: McpServerEntry,
    resolved: ResolvedMcpServer,
    projectDirectory: string,
  ): Promise<Connection> {
    const existing = this.#pending.get(key);
    if (existing) return existing;
    const timeoutMs = entry.config.timeout
      ? entry.config.timeout * 1000
      : DEFAULT_TIMEOUT_MS;
    const connection: Connection = {
      key,
      name: entry.name,
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
        const reason = `${messageOf(error)}${stderr ? `\nstderr: ${stderr}` : ""}`;
        this.options.warn?.(`MCP server failed to ${verb}`, {
          server: entry.name,
          error: reason,
        });
        throw new Error(reason, { cause: error });
      }
      if (this.#closed) {
        await connection.client.close().catch(() => undefined);
        throw new Error("Nerve is shutting down");
      }
      connection.ready = true;
      return connection;
    })();
    this.#connections.set(key, connection);
    this.#pending.set(key, pending);
    pending.then(
      () => this.#failures.delete(key),
      (error: unknown) => {
        this.#drop(connection);
        this.#failures.set(key, messageOf(error));
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
    return connection.tools;
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

/** Calls share a connection when the resolved entry is the same; a stdio server also per project (its roots). */
function keyOf(
  entry: McpServerEntry,
  resolved: ResolvedMcpServer,
  projectDirectory: string,
): string {
  return JSON.stringify([
    entry.name,
    resolved,
    resolved.kind === "stdio" ? projectDirectory : "",
  ]);
}

function toTool(server: string, tool: Tool): McpTool {
  return {
    server,
    name: tool.name,
    ...(tool.title ? { title: tool.title } : {}),
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
