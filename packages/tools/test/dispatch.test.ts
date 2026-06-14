import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import type { ToolName } from "@nerve/shared";
import { executeTool } from "../src/execution/index.js";
import { createTempProject } from "./helpers.js";

describe("executeTool dispatch", () => {
  it("dispatches core local tool names", async () => {
    const project = await createTempProject();
    await project.write("input.txt", "alpha\nbeta\n");

    const context = { cwd: project.root };
    const cases: Array<[ToolName, Record<string, unknown>]> = [
      ["read", { path: "input.txt" }],
      ["write", { path: "out.txt", content: "ok" }],
      ["edit", { path: "input.txt", oldText: "beta", newText: "gamma" }],
      ["ls", { path: "." }],
      ["find", { path: ".", pattern: "*.txt" }],
      ["grep", { path: ".", pattern: "alpha" }],
      [
        "bash",
        {
          command: `${JSON.stringify(process.execPath)} -e "process.stdout.write('ok')"`,
        },
      ],
    ];

    for (const [name, args] of cases) {
      const result = await executeTool(name, args, context);
      assert.equal(typeof result, "object", name);
    }
  });

  it("dispatches web_fetch and converts HTML to markdown", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<html><body><h1>Hello</h1><p>World</p></body></html>");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const result = await executeTool(
        "web_fetch",
        { url: `http://127.0.0.1:${address.port}/` },
        { cwd: process.cwd() },
      );
      assert.match(result.content ?? "", /Hello/);
      assert.match(result.content ?? "", /World/);
      assert.equal(
        (result.details as { converted?: boolean } | undefined)?.converted,
        true,
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("dispatches web_search using the context Tavily key", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input, init) => {
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.api_key, "test-key");
      assert.equal(body.query, "nerve agent");
      return new Response(
        JSON.stringify({
          answer: "A concise answer.",
          results: [
            {
              title: "Nerve",
              url: "https://example.test/nerve",
              content: "A result snippet.",
              score: 0.9,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    try {
      const result = await executeTool(
        "web_search",
        { query: "nerve agent", max_results: 1 },
        { cwd: process.cwd(), getApiKey: async () => "test-key" },
      );
      assert.match(result.content ?? "", /A concise answer/);
      assert.deepEqual(
        (result.details as { results?: Array<{ title: string }> } | undefined)
          ?.results?.[0],
        { title: "Nerve", url: "https://example.test/nerve" },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects web_search when the Tavily key is missing", async () => {
    const previous = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;
    try {
      await assert.rejects(
        executeTool(
          "web_search",
          { query: "missing key" },
          { cwd: process.cwd() },
        ),
        /Tavily API key is not configured/,
      );
    } finally {
      if (previous === undefined) delete process.env.TAVILY_API_KEY;
      else process.env.TAVILY_API_KEY = previous;
    }
  });

  it("rejects ask_user because it is orchestrator-owned", async () => {
    await assert.rejects(
      executeTool(
        "ask_user",
        { question: "What should I do next?" },
        { cwd: process.cwd() },
      ),
      /orchestrator user-interaction service/,
    );
  });

  it("rejects todo tools because they are orchestrator-owned", async () => {
    for (const name of ["todos_set", "todos_get"] as ToolName[]) {
      await assert.rejects(
        executeTool(name, { todos: [] }, { cwd: process.cwd() }),
        /orchestrator task-state service/,
        name,
      );
    }
  });

  it("rejects process tools because they are orchestrator-owned", async () => {
    const processTools = [
      "process_start",
      "process_stop",
      "process_restart",
      "process_list",
      "process_logs",
    ] as ToolName[];

    for (const name of processTools) {
      await assert.rejects(
        executeTool(name, {}, { cwd: process.cwd() }),
        /orchestrator process manager/,
        name,
      );
    }
  });

  it("rejects explore execution because it is orchestrator-owned", async () => {
    await assert.rejects(
      executeTool("explore", {}, { cwd: process.cwd() }),
      /orchestrator agent runtime/,
    );
  });

  it("rejects plan tools because they are orchestrator-owned", async () => {
    const planTools = [
      "plan_mode_enter",
      "plan_mode_present",
      "plan_mode_force_exit",
    ] as ToolName[];

    for (const name of planTools) {
      await assert.rejects(
        executeTool(name, {}, { cwd: process.cwd() }),
        /orchestrator plan service/,
        name,
      );
    }
  });
});
