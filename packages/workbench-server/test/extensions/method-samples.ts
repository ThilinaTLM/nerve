import { ATLASSIAN_SAMPLES } from "./atlassian-samples.js";

/** Representative arguments for every SDK method; a new method must be added here. */
export const SAMPLES: Record<string, unknown[][]> = {
  ...ATLASSIAN_SAMPLES,
  "imagegen.generate": [[{ prompt: "a red square" }]],
  "diagram.render": [[{ type: "mermaid", source: "graph TD; A-->B" }]],
  "files.list": [["*.ts"], [{ glob: "src/**/*.ts", path: ".", limit: 10 }]],
  "files.search": [["TODO"], [{ pattern: "a", literal: true, glob: "*.md" }]],
  "files.read": [["notes.txt"], [{ path: "notes.txt", as: "bytes" }]],
  "files.write": [[{ path: "notes.txt", data: { text: "x" } }]],
  "files.edit": [
    [{ edits: [{ path: "notes.txt", oldText: "a", newText: "b" }] }],
    [
      {
        edits: [{ path: "notes.txt", insertAfter: "a", text: "b" }],
        dryRun: true,
      },
    ],
  ],
  "artifacts.list": [[]],
  "artifacts.read": [["a.txt"], [{ name: "artifact:a.txt", as: "bytes" }]],
  "artifacts.write": [[{ name: "a.txt", data: { text: "x" } }]],
  "artifacts.edit": [
    [{ name: "a.txt", edits: [{ oldText: "a", newText: "b" }] }],
  ],
  "image.info": [[{ file: "a.png", ops: {} }]],
  "image.save": [[{ file: "a.png", ops: {}, name: "b.png" }]],
  "web.fetch": [
    ["https://example.com/a"],
    [{ url: "https://example.com/a", as: "file", name: "a.bin" }],
  ],
  "search.web": [["nerve"], [{ query: "nerve", limit: 20 }]],
  "extensions.reload": [["csv-viewer"], [{ id: "csv-viewer" }]],
  "extensions.status": [["csv-viewer"]],
  "configuration.reload": [["project"], [{ scope: "user" }]],
  "configuration.check": [["user"]],
  "configuration.describe": [[]],
  "configuration.list": [[], [{ kind: "rule-set" }]],
  "configuration.tools.list": [[]],
  "configuration.explain": [[{ tool: "bash", args: { command: "ls" } }]],
  "launches.list": [[]],
  "launches.start": [["web"], [{ runId: "launch_a" }]],
  "launches.restart": [["web"], [{ name: "web", runId: "launch_a" }]],
  "launches.stop": [["web"], [{ runId: "launch_a" }]],
  "launches.logs": [["web"], [{ name: "web", offset: 0, lines: 50 }]],
  "launches.create": [
    [{ command: "pnpm dev" }],
    [
      {
        label: "web",
        command: "pnpm dev",
        port: 3000,
        folder: "apps",
        before: "api",
      },
    ],
  ],
  "launches.update": [[{ name: "web", command: "pnpm start", port: null }]],
  "launches.remove": [["web"], [{ name: "launchdef_a" }]],
  "launches.folders.create": [[{ label: "apps" }]],
  "launches.move": [[{ name: "web", folder: null, before: "api" }]],
  "mcp.servers.list": [[]],
  "mcp.tools.list": [[], ["github"], [{ server: "github" }]],
  "mcp.tools.search": [["issue"], [{ query: "issue", server: "github" }]],
  "mcp.tools.get": [[{ server: "github", tool: "create_issue" }]],
  "mcp.tools.call": [
    [{ server: "github", tool: "create_issue", arguments: { title: "x" } }],
    [{ server: "github", tool: "list_issues" }],
  ],
  "mcp.resources.list": [[], ["docs"]],
  "mcp.resources.get": [[{ server: "docs", uri: "file:///readme.md" }]],
  "sdk.list": [[]],
  "sdk.describe": [["jira.issues"]],
  "sdk.search": [["sprint"], ["sprint", { in: "jira", offset: 0 }]],
  "sdk.docs": [[], ["jira"], ["jira/workflows"]],
};

/** A launches port for preparing `launches.start` / `restart` / `stop`: they resolve the launch before they are checked. */
export const launchesAgentSample = {
  prepareStart: async (selector: { name?: string; runId?: string }) => ({
    name: selector.name ?? "web",
    process: { command: "pnpm dev", cwd: "/project" },
    start: async () => {
      throw new Error("not started in samples");
    },
  }),
  prepareStop: async (selector: { name?: string; runId?: string }) => ({
    name: selector.name ?? "web",
    target: "launches:launch/launchdef_a",
    stop: async () => {
      throw new Error("not stopped in samples");
    },
  }),
} as unknown as import("@nervekit/tools/quick-script").LaunchesAgentPort;
