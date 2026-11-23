// A small MCP server over stdio for tests and manual QA: newline-delimited JSON-RPC.
// Tools: echo (text), add (structured), pixel (image), fail (tool error), whereami (cwd and env).
import { createInterface } from "node:readline";

const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

const tools = [
  {
    name: "echo",
    description: "Echo the text back",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "add",
    description: "Add two numbers",
    inputSchema: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
  },
  {
    name: "pixel",
    description: "Return a 1x1 PNG image",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "fail",
    description: "Always reports an error",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "whereami",
    description: "The server's cwd and FAKE_MCP_TOKEN",
    inputSchema: { type: "object", properties: {} },
  },
];

function call(name, args) {
  switch (name) {
    case "echo":
      return { content: [{ type: "text", text: String(args.text) }] };
    case "add": {
      const sum = Number(args.a) + Number(args.b);
      return {
        content: [{ type: "text", text: JSON.stringify({ sum }) }],
        structuredContent: { sum },
      };
    }
    case "pixel":
      return {
        content: [
          { type: "text", text: "one pixel" },
          { type: "image", data: PIXEL, mimeType: "image/png" },
        ],
      };
    case "fail":
      return {
        content: [{ type: "text", text: "the fake tool failed" }],
        isError: true,
      };
    case "whereami":
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              cwd: process.cwd(),
              token: process.env.FAKE_MCP_TOKEN ?? null,
            }),
          },
        ],
      };
    default:
      return undefined;
  }
}

function respond(id, result, error) {
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: "2.0", id, ...(error ? { error } : { result }) })}\n`,
  );
}

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (message.id === undefined) return; // notifications
  const { id, method, params = {} } = message;
  switch (method) {
    case "initialize":
      return respond(id, {
        protocolVersion: params.protocolVersion,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "fake-mcp", version: "1.0.0" },
        instructions: "Use echo to test.",
      });
    case "ping":
      return respond(id, {});
    case "tools/list":
      return respond(id, { tools });
    case "tools/call": {
      const result = call(params.name, params.arguments ?? {});
      return result
        ? respond(id, result)
        : respond(id, undefined, {
            code: -32602,
            message: `Unknown tool: ${params.name}`,
          });
    }
    case "resources/list":
      return respond(id, {
        resources: [
          { uri: "fake://readme", name: "readme", mimeType: "text/plain" },
        ],
      });
    case "resources/read":
      return respond(id, {
        contents: [
          { uri: params.uri, mimeType: "text/plain", text: "Fake readme" },
        ],
      });
    default:
      return respond(id, undefined, {
        code: -32601,
        message: `Method not found: ${method}`,
      });
  }
});
