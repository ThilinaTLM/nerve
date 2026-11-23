import { codedError } from "../errors.js";
import { freshArtifactName, writeArtifact } from "../files/artifacts.js";
import { defineMethod } from "../sdk-args.js";
import type { SdkEnvironment, SdkMethod } from "../sdk-types.js";
import type {
  McpCallResult,
  McpResourceContents,
  McpTool,
} from "./mcp-port.js";

function port(env: SdkEnvironment) {
  const agent = env.context.mcpAgent;
  if (!agent)
    throw codedError(
      "FORBIDDEN",
      "This run cannot reach MCP servers (no MCP port).",
    );
  return agent;
}

function text(
  options: Record<string, unknown>,
  name: string,
  required: string,
): string;
function text(
  options: Record<string, unknown>,
  name: string,
): string | undefined;
function text(
  options: Record<string, unknown>,
  name: string,
  required?: string,
): string | undefined {
  const value = options[name];
  if (value === undefined && required === undefined) return undefined;
  if (typeof value !== "string" || !value.trim())
    throw new Error(
      required ?? `${name} must be a non-empty string when given.`,
    );
  return value;
}

const SERVER_REQUIRED =
  "server is required: a server name from mcp.servers.list().";
const serverTarget = (server: string) => `mcp:server/${server}`;
const signal = (env: SdkEnvironment) => ({ signal: env.context.signal });

/**
 * Servers a call without `server` covers: every enabled one, each checked as the call would be
 * with that server named, so a rule on `mcp:server/<name>` applies. A server that is refused or
 * fails becomes a note, not an error.
 */
async function eachServer<T>(
  env: SdkEnvironment,
  operation: string,
  server: string | undefined,
  read: (server: string) => Promise<T[]>,
): Promise<T[]> {
  if (server !== undefined) return await read(server);
  const servers = (await port(env).listServers()).filter(
    (entry) => entry.state !== "disabled",
  );
  const results = await Promise.allSettled(
    servers.map(async (entry) => {
      if (!env.context.authorizeNested)
        throw new Error("nested authorization is unavailable");
      await env.context.authorizeNested({
        operation,
        targets: [serverTarget(entry.name)],
        risk: "external_read",
      });
      return await read(entry.name);
    }),
  );
  return results.flatMap((result, index) => {
    if (result.status === "fulfilled") return result.value;
    const reason =
      result.reason instanceof Error
        ? result.reason.message
        : String(result.reason);
    env.report.notes.push(
      `MCP server ${JSON.stringify(servers[index].name)} skipped: ${reason}`,
    );
    return [];
  });
}

async function findTool(
  env: SdkEnvironment,
  server: string,
  tool: string,
): Promise<McpTool> {
  const tools = await port(env).listTools(server, signal(env));
  const found = tools.find((entry) => entry.name === tool);
  if (found) return found;
  throw codedError(
    "NOT_FOUND",
    `MCP server ${JSON.stringify(server)} has no tool ${JSON.stringify(tool)}. Its tools: ${tools.map((entry) => entry.name).join(", ") || "none"}.`,
  );
}

const EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
  "application/json": ".json",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "text/csv": ".csv",
  "audio/wav": ".wav",
  "audio/mpeg": ".mp3",
};

/** `github-create_issue` → a valid artifact base name. */
const artifactBase = (...parts: string[]) =>
  parts
    .join("-")
    .replace(/[^\p{L}\p{N}_.-]+/gu, "_")
    .replace(/^[._-]+/, "")
    .slice(0, 100) || "mcp";

async function saveBinary(
  env: SdkEnvironment,
  base: string,
  data: string,
  mimeType: string | undefined,
): Promise<string> {
  const name = await freshArtifactName(
    env,
    base,
    EXTENSIONS[mimeType ?? ""] ?? ".bin",
  );
  return await writeArtifact(env, name, Buffer.from(data, "base64"));
}

/** What `tools.call` returns: the text blocks joined, binary content saved as artifacts. */
export type McpToolResult = {
  text: string;
  structured?: unknown;
  files?: string[];
};

export async function toToolResult(
  env: SdkEnvironment,
  base: string,
  result: McpCallResult,
): Promise<McpToolResult> {
  const texts: string[] = [];
  const files: string[] = [];
  for (const block of result.content) {
    const entry = block as Record<string, unknown>;
    if (block.type === "text" && typeof entry.text === "string")
      texts.push(entry.text);
    else if (
      (block.type === "image" || block.type === "audio") &&
      typeof entry.data === "string"
    )
      files.push(
        await saveBinary(env, base, entry.data, entry.mimeType as string),
      );
    else if (block.type === "resource" && entry.resource) {
      const resource = entry.resource as McpResourceContents;
      if (typeof resource.text === "string") texts.push(resource.text);
      else if (typeof resource.blob === "string")
        files.push(
          await saveBinary(env, base, resource.blob, resource.mimeType),
        );
    } else if (block.type === "resource_link" && typeof entry.uri === "string")
      texts.push(
        `[resource ${entry.uri}${typeof entry.name === "string" ? ` (${entry.name})` : ""}: read it with mcp.resources.get]`,
      );
    else texts.push(`[${block.type} content omitted]`);
  }
  return {
    text: texts.join("\n"),
    ...(result.structuredContent !== undefined
      ? { structured: result.structuredContent }
      : {}),
    ...(files.length > 0 ? { files } : {}),
  };
}

const matches = (tool: McpTool, words: string[]) => {
  const hay =
    `${tool.server} ${tool.name} ${tool.title ?? ""} ${tool.description ?? ""}`.toLowerCase();
  return words.every((word) => hay.includes(word));
};

/**
 * `mcp.*`: the tools and resources of the MCP servers in the user's `mcp.json`. A tool call is
 * one operation per server and tool (`mcp:tool/<server>/<tool>`), so operation rules can allow a
 * tool by name; its effect is unknown to Nerve, so it is declared destructive.
 */
export const mcpMethods: SdkMethod[] = [
  defineMethod({
    product: "mcp",
    path: "servers.list",
    risk: "read",
    options: [],
    signature:
      "/** The servers configured in mcp.json, connected or not; connects to none. A failed server says why in `error`. */ list(): Promise<McpServer[]>",
    parse: () => undefined,
    resource: () => "MCP servers",
    run: async (_, env) => await port(env).listServers(),
  }),
  defineMethod({
    product: "mcp",
    path: "tools.list",
    risk: "external_read",
    bare: "server",
    options: ["server"],
    signature:
      "/** Tools of one server, or of every enabled server (a server that fails is skipped with a note). Starts or connects to the servers it lists. */ list(server?: string | { server?: string }): Promise<McpTool[]>",
    parse: (options) => text(options, "server"),
    authorize: (server) => ({
      targets: server ? [serverTarget(server)] : [],
      summary: server ? `List tools of ${server}` : "List MCP tools",
    }),
    run: async (server, env) =>
      await eachServer(
        env,
        "mcp.tools.list",
        server,
        async (name) => await port(env).listTools(name, signal(env)),
      ),
  }),
  defineMethod({
    product: "mcp",
    path: "tools.search",
    risk: "external_read",
    bare: "query",
    options: ["query", "server"],
    signature:
      "/** Tools whose server, name, title or description contain every word of `query` (case-insensitive), of one server or every enabled one. */ search(query: string | { query: string; server?: string }): Promise<McpTool[]>",
    parse: (options) => ({
      query: text(options, "query", 'query is required, e.g. "issue".'),
      server: text(options, "server"),
    }),
    authorize: ({ query, server }) => ({
      targets: server ? [serverTarget(server)] : [],
      summary: `Search MCP tools: ${query}`,
    }),
    run: async ({ query, server }, env) => {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const tools = await eachServer(
        env,
        "mcp.tools.search",
        server,
        async (name) => await port(env).listTools(name, signal(env)),
      );
      return tools.filter((tool) => matches(tool, words));
    },
  }),
  defineMethod({
    product: "mcp",
    path: "tools.get",
    risk: "external_read",
    options: ["server", "tool"],
    signature:
      "/** One tool with its input schema (JSON Schema): read it before calling a tool you have not used. */ get(options: { server: string; tool: string }): Promise<McpTool>",
    parse: (options) => ({
      server: text(options, "server", SERVER_REQUIRED),
      tool: text(options, "tool", "tool is required: a tool name."),
    }),
    authorize: ({ server, tool }) => ({
      targets: [serverTarget(server)],
      summary: `Get tool ${server}/${tool}`,
    }),
    run: async ({ server, tool }, env) => await findTool(env, server, tool),
  }),
  {
    ...defineMethod({
      product: "mcp",
      path: "tools.call",
      risk: "destructive",
      options: ["server", "tool", "arguments"],
      signature:
        "/** Call a tool with `arguments` matching its input schema. Text blocks are joined into `text`; images, audio and binary resources are saved as artifacts in `files`. A tool that reports an error throws SERVER_ERROR with its message. Checked per tool (`mcp:tool/<server>/<tool>`); its effect is unknown, so approval treats it as destructive. */ call(options: { server: string; tool: string; arguments?: Record<string, unknown> }): Promise<McpToolResult>",
      parse: (options) => {
        const args = options.arguments ?? {};
        if (typeof args !== "object" || args === null || Array.isArray(args))
          throw new Error(
            "arguments must be an object matching the tool's input schema (see mcp.tools.get).",
          );
        return {
          server: text(options, "server", SERVER_REQUIRED),
          tool: text(
            options,
            "tool",
            "tool is required: a tool name from mcp.tools.list(server).",
          ),
          args: args as Record<string, unknown>,
        };
      },
      authorize: ({ server, tool }) => ({
        targets: [`mcp:tool/${server}/${tool}`],
        summary: `Call MCP tool ${server}/${tool}`,
      }),
      resource: ({ server, tool }) => `MCP tool ${server}/${tool}`,
      run: async ({ server, tool, args }, env) => {
        const result = await port(env).callTool(
          server,
          tool,
          args,
          signal(env),
        );
        if (result.isError) {
          const message = result.content
            .flatMap((block) =>
              block.type === "text" && typeof block.text === "string"
                ? [block.text]
                : [],
            )
            .join("\n");
          throw codedError(
            "SERVER_ERROR",
            `MCP tool ${server}/${tool} reported an error: ${message || "(no message)"}`,
          );
        }
        return await toToolResult(
          env,
          artifactBase("mcp", server, tool),
          result,
        );
      },
    }),
    // The arguments may be computed; the server and tool alone decide the check.
    scanOptions: ["server", "tool"],
  },
  defineMethod({
    product: "mcp",
    path: "resources.list",
    risk: "external_read",
    bare: "server",
    options: ["server"],
    signature:
      "/** Resources of one server, or of every enabled server (a server that fails or has none is skipped). */ list(server?: string | { server?: string }): Promise<McpResource[]>",
    parse: (options) => text(options, "server"),
    authorize: (server) => ({
      targets: server ? [serverTarget(server)] : [],
      summary: server ? `List resources of ${server}` : "List MCP resources",
    }),
    run: async (server, env) =>
      await eachServer(
        env,
        "mcp.resources.list",
        server,
        async (name) => await port(env).listResources(name, signal(env)),
      ),
  }),
  defineMethod({
    product: "mcp",
    path: "resources.get",
    risk: "external_read",
    options: ["server", "uri"],
    signature:
      "/** Read a resource (MCP resources/read). Text comes back as `text`; binary content is saved as an artifact in `file`. */ get(options: { server: string; uri: string }): Promise<McpResourceContent[]>",
    parse: (options) => ({
      server: text(options, "server", SERVER_REQUIRED),
      uri: text(
        options,
        "uri",
        "uri is required: a resource uri from mcp.resources.list(server).",
      ),
    }),
    authorize: ({ server, uri }) => ({
      targets: [serverTarget(server)],
      summary: `Read resource ${uri} of ${server}`,
    }),
    run: async ({ server, uri }, env) => {
      const contents = await port(env).readResource(server, uri, signal(env));
      const read = [];
      for (const entry of contents) {
        if (typeof entry.text === "string")
          read.push({
            uri: entry.uri,
            ...(entry.mimeType ? { mimeType: entry.mimeType } : {}),
            text: entry.text,
          });
        else if (typeof entry.blob === "string")
          read.push({
            uri: entry.uri,
            ...(entry.mimeType ? { mimeType: entry.mimeType } : {}),
            file: await saveBinary(
              env,
              artifactBase("mcp", server, "resource"),
              entry.blob,
              entry.mimeType,
            ),
          });
      }
      return read;
    },
  }),
];
