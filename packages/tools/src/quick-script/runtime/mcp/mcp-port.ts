/**
 * What a script may do with the user's MCP (Model Context Protocol) servers, configured in
 * `mcp.json`: list them, list and call their tools, and list and read their resources. The host
 * starts or connects to a server on first use and keeps the connection for later runs.
 *
 * Shapes are the MCP protocol's own (`tools/list`, `tools/call`, `resources/read`), reduced to
 * what a script needs; the host owns transports, sessions and timeouts.
 */

export type McpServerState =
  /** Connected now. */
  | "connected"
  /** Configured and enabled; connects on first use. */
  | "idle"
  /** Turned off by the user's settings or by `enabled: false` in mcp.json. Never started; calls fail with FORBIDDEN. */
  | "disabled"
  /** Not reviewed yet: the user must approve the entry before it starts. Never started; calls fail with FORBIDDEN. */
  | "needs_approval"
  /** The user reviewed the entry and rejected it. Never started; calls fail with FORBIDDEN. */
  | "rejected"
  /** The last connection attempt failed; `error` says why. The next call tries again. */
  | "failed";

export type McpServerSummary = {
  name: string;
  description?: string;
  transport: "stdio" | "http";
  /** Where the entry is defined: the user's mcp.json or the project's. */
  scope: "user" | "project";
  state: McpServerState;
  error?: string;
  /** The server's own name and version, once connected. */
  server?: { name: string; version: string };
  /** The server's usage instructions, once connected. */
  instructions?: string;
};

/** MCP tool annotations; hints from the server, not guarantees. */
export type McpToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type McpTool = {
  server: string;
  name: string;
  title?: string;
  description?: string;
  /** JSON Schema of the tool's arguments (an object schema). */
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: McpToolAnnotations;
};

/** One content block of an MCP result (`tools/call`), as the server sent it. */
export type McpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "audio"; data: string; mimeType: string }
  | {
      type: "resource_link";
      uri: string;
      name?: string;
      description?: string;
      mimeType?: string;
    }
  | { type: "resource"; resource: McpResourceContents }
  | { type: string; [key: string]: unknown };

export type McpResourceContents = {
  uri: string;
  mimeType?: string;
  /** Text resources. */
  text?: string;
  /** Binary resources, base64. */
  blob?: string;
};

export type McpCallResult = {
  content: McpContentBlock[];
  structuredContent?: unknown;
  isError?: boolean;
};

export type McpResource = {
  server: string;
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
};

export type McpRequestOptions = { signal?: AbortSignal };

export interface McpAgentPort {
  /** Every configured server, connected or not; connects to none. */
  listServers(): Promise<McpServerSummary[]>;
  /**
   * Connects when needed (a server with an index may answer without connecting). Fails with
   * NOT_FOUND naming the configured servers for an unknown name, and with FORBIDDEN for a server
   * that is disabled, needs approval or is rejected; the message names the state and where the
   * user acts (User settings → Connections → MCP servers, or Project settings → Agent → MCP
   * servers). The other methods fail the same way.
   */
  listTools(server: string, options?: McpRequestOptions): Promise<McpTool[]>;
  callTool(
    server: string,
    tool: string,
    args: Record<string, unknown>,
    options?: McpRequestOptions,
  ): Promise<McpCallResult>;
  listResources(
    server: string,
    options?: McpRequestOptions,
  ): Promise<McpResource[]>;
  readResource(
    server: string,
    uri: string,
    options?: McpRequestOptions,
  ): Promise<McpResourceContents[]>;
}
