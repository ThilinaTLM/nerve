import {
  McpClient,
  McpError,
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
  type McpConfigFile,
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

type Connection = {
  key: string;
  name: string;
  client: McpClient;
  stderr: string;
  tools?: McpTool[];
  timeoutMs: number;
  idle?: NodeJS.Timeout;
  busy: number;
};

export type McpServerHubOptions = {
  home: string;
  version: string;
  idleMs?: number;
  /** Replaces the real transports (tests). */
  transport?: (server: ResolvedMcpServer) => McpTransport;
  warn?: (message: string, context: Record<string, unknown>) => void;
};

const failure = (code: "NOT_FOUND" | "SERVER_ERROR", message: string) =>
  new ToolExecutionError(code, message);

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * The daemon's MCP connections. A server is started (stdio) or connected (HTTP) on first use and
 * shared by every conversation whose resolved entry is the same (a stdio server per project
 * directory, since that is its default `cwd`); idle connections close after ten minutes. The
 * configuration is re-read on every call, so edits to mcp.json apply to the next call.
 */
export class McpServerHub {
  readonly #connections = new Map<string, Promise<Connection>>();
  /** Last connection failure per key, until a later attempt succeeds. */
  readonly #failures = new Map<string, string>();
  #closed = false;

  constructor(private readonly options: McpServerHubOptions) {}

  /** The port a quick_script run uses; `projectDirectory` is the default cwd and the root offered to servers. */
  port(projectDirectory: string): McpAgentPort {
    return {
      listServers: () => this.listServers(projectDirectory),
      listTools: (server, options) =>
        this.#use(server, projectDirectory, async (connection) =>
          this.#tools(connection, options?.signal),
        ),
      callTool: (server, tool, args, options) =>
        this.#use(server, projectDirectory, async (connection) => {
          const result = await connection.client.callTool(tool, args, {
            signal: options?.signal,
            timeoutMs: connection.timeoutMs,
          });
          return result;
        }),
      listResources: (server, options) =>
        this.#use(server, projectDirectory, async (connection) => {
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
        this.#use(server, projectDirectory, async (connection) => {
          const result = await connection.client.readResource(uri, {
            signal: options?.signal,
            timeoutMs: connection.timeoutMs,
          });
          return result.contents;
        }),
    };
  }

  async listServers(projectDirectory: string): Promise<McpServerSummary[]> {
    const file = await readMcpConfig(this.options.home);
    const summaries: McpServerSummary[] = [];
    for (const entry of file.servers) {
      const base = {
        name: entry.name,
        ...(entry.config.description
          ? { description: entry.config.description }
          : {}),
        transport: entry.kind,
      };
      if (entry.config.enabled === false) {
        summaries.push({ ...base, state: "disabled" });
        continue;
      }
      let key: string;
      try {
        key = this.#key(entry, projectDirectory);
      } catch (error) {
        summaries.push({ ...base, state: "failed", error: messageOf(error) });
        continue;
      }
      const failed = this.#failures.get(key);
      const pending = this.#connections.get(key);
      const connection = pending
        ? await pending.catch(() => undefined)
        : undefined;
      if (connection) {
        const info = connection.client.serverInfo;
        const instructions = connection.client.instructions;
        summaries.push({
          ...base,
          state: "connected",
          ...(info
            ? { server: { name: info.name, version: info.version } }
            : {}),
          ...(instructions ? { instructions } : {}),
        });
      } else if (failed)
        summaries.push({ ...base, state: "failed", error: failed });
      else summaries.push({ ...base, state: "idle" });
    }
    return summaries;
  }

  /** Closes every connection (daemon shutdown). */
  async close(): Promise<void> {
    this.#closed = true;
    const pending = [...this.#connections.values()];
    this.#connections.clear();
    await Promise.allSettled(
      pending.map(async (connection) => {
        const open = await connection;
        clearTimeout(open.idle);
        await open.client.close();
      }),
    );
  }

  #key(entry: McpServerEntry, projectDirectory: string): string {
    const resolved = resolveMcpServer(entry, projectDirectory);
    // A stdio server is shared within one project only: its roots are that project.
    return JSON.stringify([
      entry.name,
      resolved,
      resolved.kind === "stdio" ? projectDirectory : "",
    ]);
  }

  async #entry(name: string): Promise<McpServerEntry> {
    const file: McpConfigFile = await readMcpConfig(this.options.home);
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
      problem.includes(`"${name}"`),
    );
    if (invalid)
      throw failure("NOT_FOUND", `MCP server "${name}": ${invalid}.`);
    throw failure(
      "NOT_FOUND",
      file.servers.length > 0
        ? `No MCP server "${name}". Configured: ${file.servers.map((server) => server.name).join(", ")}.`
        : `No MCP servers are configured. Add them to ${file.path} (see the configure-nerve skill).`,
    );
  }

  async #use<T>(
    name: string,
    projectDirectory: string,
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
    const key = this.#key(entry, projectDirectory);
    const connection = await this.#connect(
      key,
      entry,
      resolved,
      projectDirectory,
    );
    connection.busy += 1;
    clearTimeout(connection.idle);
    try {
      return await run(connection);
    } catch (error) {
      throw this.#callFailure(name, error);
    } finally {
      connection.busy -= 1;
      this.#scheduleIdle(connection);
    }
  }

  #callFailure(name: string, error: unknown): Error {
    if (error instanceof ToolExecutionError) return error;
    if (error instanceof McpError)
      return failure(
        "SERVER_ERROR",
        `MCP server "${name}": ${error.message}${error.code === -32602 ? " (invalid arguments: check the tool's inputSchema with mcp.tools.get)" : ""}`,
      );
    return failure("SERVER_ERROR", `MCP server "${name}": ${messageOf(error)}`);
  }

  #connect(
    key: string,
    entry: McpServerEntry,
    resolved: ResolvedMcpServer,
    projectDirectory: string,
  ): Promise<Connection> {
    const existing = this.#connections.get(key);
    if (existing) return existing;
    const timeoutMs = entry.config.timeout
      ? entry.config.timeout * 1000
      : DEFAULT_TIMEOUT_MS;
    const pending = (async (): Promise<Connection> => {
      const connection: Connection = {
        key,
        name: entry.name,
        client: new McpClient({
          name: "nerve",
          version: this.options.version,
          requestTimeoutMs: timeoutMs,
          roots: [
            {
              uri: pathToFileURL(projectDirectory).href,
              name: "project",
            },
          ],
        }),
        stderr: "",
        timeoutMs,
        busy: 0,
      };
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
      connection.client.onClose(() => {
        if (this.#connections.get(key) === pending)
          this.#connections.delete(key);
        clearTimeout(connection.idle);
      });
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
          `did not finish starting within ${CONNECT_TIMEOUT_MS / 1000} s`,
        );
      } catch (error) {
        await connection.client.close().catch(() => undefined);
        const stderr = connection.stderr.trim();
        const reason = `${messageOf(error)}${stderr ? `\nstderr: ${stderr}` : ""}`;
        this.options.warn?.("MCP server failed to start", {
          server: entry.name,
          error: reason,
        });
        throw new Error(reason, { cause: error });
      }
      return connection;
    })();
    this.#connections.set(key, pending);
    pending.then(
      () => this.#failures.delete(key),
      (error: unknown) => {
        if (this.#connections.get(key) === pending)
          this.#connections.delete(key);
        this.#failures.set(key, messageOf(error));
      },
    );
    return pending.catch((error: unknown) => {
      throw failure(
        "SERVER_ERROR",
        `MCP server "${entry.name}" could not ${resolved.kind === "stdio" ? "start" : "connect"}: ${messageOf(error)}`,
      );
    });
  }

  async #tools(
    connection: Connection,
    signal: AbortSignal | undefined,
  ): Promise<McpTool[]> {
    if (connection.tools) return connection.tools;
    if (!connection.client.serverCapabilities?.tools) return [];
    const tools = await connection.client.listTools({
      signal,
      timeoutMs: connection.timeoutMs,
    });
    connection.tools = tools.map((tool) => toTool(connection.name, tool));
    return connection.tools;
  }

  #scheduleIdle(connection: Connection) {
    if (connection.busy > 0 || this.#closed) return;
    clearTimeout(connection.idle);
    connection.idle = setTimeout(() => {
      if (connection.busy > 0) return;
      this.#connections.delete(connection.key);
      void connection.client.close().catch(() => undefined);
    }, this.options.idleMs ?? DEFAULT_IDLE_MS);
    connection.idle.unref();
  }
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
