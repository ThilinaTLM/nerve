import type { ToolName } from "@nervekit/contracts";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import { HTML_CONVERSION_MAX_INPUT_BYTES } from "../src/execution/common/isolated-html-to-markdown.js";
import { executeTool } from "../src/execution/dispatch.js";
import { resolvePythonRuntime } from "../src/execution/python/runtime.js";
import { createTempProject } from "./helpers.js";

describe("executeTool dispatch", () => {
  it("dispatches core local tool names", async () => {
    const project = await createTempProject();
    await project.write("input.txt", "alpha\nbeta\n");

    const context = { cwd: project.root };
    const cases: Array<[ToolName, Record<string, unknown>]> = [
      ["read", { path: "input.txt" }],
      ["write", { path: "out.txt", content: "ok" }],
      [
        "edit",
        {
          path: "input.txt",
          edits: [{ oldText: "beta", newText: "delta" }],
        },
      ],
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

  it("dispatches python_exec when a runtime is provided", async (t) => {
    const project = await createTempProject();
    const status = await resolvePythonRuntime({ cwd: project.root });
    if (!status.available) {
      t.skip(`Python runtime unavailable: ${status.error}`);
      return;
    }
    const pythonRuntime = {
      command: status.command,
      args: status.args,
      displayPath: status.displayPath,
      version: status.version,
      source: status.source,
    };
    const result = await executeTool(
      "python_exec",
      { code: "print('ok', end='')" },
      {
        cwd: project.root,
        pythonRuntime,
      },
    );
    assert.equal(result.stdout, "ok");

    await project.write("script.py", "print('file', end='')");
    const fileResult = await executeTool(
      "python_exec",
      { path: "script.py" },
      { cwd: project.root, pythonRuntime },
    );
    assert.equal(fileResult.stdout, "file");
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
        {
          cwd: process.cwd(),
          webFetchPolicy: { allowPrivateNetwork: true },
        },
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

  it("rejects oversized web_fetch responses before parsing", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/declared") {
        response.writeHead(200, {
          "content-type": "text/html",
          "content-length": String(HTML_CONVERSION_MAX_INPUT_BYTES + 1),
        });
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "text/html" });
      const chunk = Buffer.alloc(1024 * 1024, 120);
      for (let index = 0; index < 9; index += 1) response.write(chunk);
      response.end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      for (const path of ["declared", "chunked"]) {
        await assert.rejects(
          executeTool(
            "web_fetch",
            { url: `http://127.0.0.1:${address.port}/${path}` },
            {
              cwd: process.cwd(),
              webFetchPolicy: { allowPrivateNetwork: true },
            },
          ),
          (error) =>
            error instanceof Error &&
            "code" in error &&
            error.code === "WEB_FETCH_RESPONSE_TOO_LARGE",
        );
      }
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
        {
          title: "Nerve",
          url: "https://example.test/nerve",
          content: "A result snippet.",
          score: 0.9,
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("dispatches explain_image through the host vision callback", async () => {
    const project = await createTempProject();
    const image = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);
    await writeFile(`${project.root}/screen.png`, image);
    const updates: Array<{ stream: string; chunk: string }> = [];
    const result = await executeTool(
      "explain_image",
      { path: "screen.png", prompt: "Read the error" },
      {
        cwd: project.root,
        explainImage: async (request) => {
          assert.equal(request.mimeType, "image/png");
          assert.equal(request.prompt, "Read the error");
          assert.deepEqual(Buffer.from(request.data), image);
          await request.onUpdate?.({
            kind: "output",
            stream: "thinking",
            chunk: "Inspecting pixels",
          });
          await request.onUpdate?.({
            kind: "output",
            stream: "text",
            chunk: "The screenshot shows a build error.",
          });
          return {
            explanation: "The screenshot shows a build error.",
            model: { provider: "google", modelId: "gemini" },
          };
        },
        onUpdate: (update) => updates.push(update),
      },
    );
    assert.deepEqual(updates, [
      { kind: "output", stream: "thinking", chunk: "Inspecting pixels" },
      {
        kind: "output",
        stream: "text",
        chunk: "The screenshot shows a build error.",
      },
    ]);
    assert.equal(result.content, "The screenshot shows a build error.");
    const details = result.details as Record<string, unknown>;
    assert.equal(details.mimeType, "image/png");
    assert.equal(details.byteSize, image.byteLength);
    assert.equal(
      JSON.stringify(result).includes(image.toString("base64")),
      false,
    );
  });

  it("rejects explain_image without a configured host callback", async () => {
    const project = await createTempProject();
    await assert.rejects(
      executeTool(
        "explain_image",
        { path: "screen.png" },
        { cwd: project.root },
      ),
      /not configured/,
    );
  });

  it("rejects todo tools because they are orchestrator-owned", async () => {
    for (const name of ["todos_set", "todos_get"] as ToolName[]) {
      await assert.rejects(
        executeTool(name, { todos: [] }, { cwd: process.cwd() }),
        /requires a host handler/,
        name,
      );
    }
  });

  it("rejects task tools because they are orchestrator-owned", async () => {
    const taskTools = [
      "task_start",
      "task_status",
      "task_logs",
      "task_control",
    ] as ToolName[];

    for (const name of taskTools) {
      await assert.rejects(
        executeTool(name, {}, { cwd: process.cwd() }),
        /requires a host handler/,
        name,
      );
    }
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
        /requires a host handler/,
        name,
      );
    }
  });
});
