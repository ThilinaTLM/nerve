/** Declarations of the `mcp` runtime namespace. */
export const MCP_DTS_TYPES = `interface McpServer {
  /** The key in mcp.json; what \`server\` arguments name. */
  name: string;
  description?: string;
  transport: "stdio" | "http";
  /** idle: connects on first use; failed: the last attempt failed (see error), the next call retries. */
  state: "connected" | "idle" | "disabled" | "failed";
  error?: string;
  /** The server's own name and version, once connected. */
  server?: { name: string; version: string };
  /** The server's usage instructions, once connected: read them before using its tools. */
  instructions?: string;
}
interface McpTool {
  server: string;
  name: string;
  title?: string;
  description?: string;
  /** JSON Schema of \`arguments\`. */
  inputSchema: Record<string, unknown>;
  /** JSON Schema of \`structured\`, when the tool declares one. */
  outputSchema?: Record<string, unknown>;
  /** Hints from the server, not guarantees. */
  annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
}
interface McpToolResult {
  /** The text blocks of the result, joined by newlines (often JSON: parse it). */
  text: string;
  /** The tool's structured result, when it returns one. */
  structured?: unknown;
  /** Images, audio and binary resources of the result, saved as artifacts. */
  files?: FileHandle[];
}
interface McpResource {
  server: string;
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
}
interface McpResourceContent {
  uri: string;
  mimeType?: string;
  /** Text resources. */
  text?: string;
  /** Binary resources, saved as an artifact. */
  file?: FileHandle;
}`;
