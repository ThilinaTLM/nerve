import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import type { ToolName } from "@nervekit/contracts";
import { executeTool, resolvePythonRuntime } from "../src/execution/index.js";
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
          replacements: [{ oldText: "beta", newText: "delta" }],
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

  it("dispatches python when a runtime is provided", async (t) => {
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
      "python",
      { code: "print('ok', end='')" },
      {
        cwd: project.root,
        pythonRuntime,
      },
    );
    assert.equal(result.stdout, "ok");

    await project.write("script.py", "print('file', end='')");
    const fileResult = await executeTool(
      "python",
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

  it("dispatches Jira tools with configured auth and writes search artifacts", async () => {
    const project = await createTempProject();
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: URL; init?: RequestInit }> = [];
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      const auth =
        init?.headers && (init.headers as Record<string, string>).Authorization;
      assert.match(String(auth), /^Basic /);
      assert.equal(
        Buffer.from(String(auth).replace(/^Basic\s+/, ""), "base64").toString(
          "utf8",
        ),
        "user@example.com:test-token",
      );
      assert.doesNotMatch(JSON.stringify(init), /test-token/);

      if (url.pathname.endsWith("/search/jql")) {
        assert.equal(init?.method, "POST");
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        assert.equal(body.jql, "project = PROJ ORDER BY updated DESC");
        return new Response(
          JSON.stringify({
            issues: [
              {
                key: "PROJ-1",
                fields: {
                  summary: "One",
                  status: { name: "To Do" },
                  issuetype: { name: "Task" },
                },
              },
            ],
            nextPageToken: "next-token",
          }),
          { status: 200, statusText: "OK" },
        );
      }
      if (
        url.pathname.endsWith("/issue/PROJ-1/comment") &&
        init?.method === "POST"
      ) {
        return new Response(JSON.stringify({ id: "10001" }), {
          status: 201,
          statusText: "Created",
        });
      }
      if (url.pathname.endsWith("/user/assignable/search")) {
        return new Response(
          JSON.stringify([
            {
              accountId: "abc-123",
              displayName: "Jane Doe",
              emailAddress: "jane@example.com",
              active: true,
            },
          ]),
          { status: 200, statusText: "OK" },
        );
      }
      if (
        url.pathname.endsWith("/issue/PROJ-1/transitions") &&
        init?.method === "GET"
      ) {
        return new Response(
          JSON.stringify({
            transitions: [
              {
                id: "31",
                name: "Done",
                to: { name: "Done" },
                fields: {
                  resolution: {
                    id: "resolution",
                    name: "Resolution",
                    required: true,
                    schema: { type: "resolution" },
                    allowedValues: [{ name: "Fixed" }],
                  },
                },
              },
            ],
          }),
          { status: 200, statusText: "OK" },
        );
      }
      if (
        url.pathname.endsWith("/issue/PROJ-1/transitions") &&
        init?.method === "POST"
      ) {
        const body = JSON.parse(String(init?.body)) as {
          transition?: { id?: string };
        };
        assert.equal(body.transition?.id, "31");
        return new Response(null, { status: 204, statusText: "No Content" });
      }
      if (url.pathname.endsWith("/issue/PROJ-1")) {
        return new Response(
          JSON.stringify({
            key: "PROJ-1",
            fields: {
              summary: "One",
              status: { name: "To Do" },
              issuetype: { name: "Task" },
            },
          }),
          { status: 200, statusText: "OK" },
        );
      }
      if (url.pathname.endsWith("/issue") && init?.method === "POST") {
        const body = JSON.parse(String(init?.body)) as {
          fields?: Record<string, unknown>;
        };
        assert.equal(
          (body.fields?.project as { key?: string } | undefined)?.key,
          "PROJ",
        );
        return new Response(JSON.stringify({ id: "10000", key: "PROJ-2" }), {
          status: 201,
          statusText: "Created",
        });
      }
      throw new Error(
        `Unexpected Jira fetch: ${init?.method ?? "GET"} ${url.pathname}`,
      );
    }) as typeof fetch;

    const context = {
      cwd: project.root,
      dataDir: project.root,
      getApiKey: async (provider: string) =>
        provider === "jira" ? "test-token" : undefined,
      getProviderConfig: async (provider: string) =>
        provider === "jira"
          ? {
              enabled: true,
              siteUrl: "https://example.atlassian.net/",
              email: "user@example.com",
              defaultProjectKey: "PROJ",
            }
          : undefined,
    };

    try {
      const search = await executeTool(
        "jira_search_issues",
        { jql: "project = PROJ ORDER BY updated DESC", max_results: 1 },
        context,
      );
      assert.match(search.content ?? "", /PROJ-1/);
      const artifact = (
        search.details as {
          outputLimits?: { artifacts?: Array<{ path: string }> };
        }
      ).outputLimits?.artifacts?.[0];
      assert.ok(artifact?.path);
      assert.match(await readFile(artifact.path, "utf8"), /PROJ-1/);

      const users = await executeTool(
        "jira_search_users",
        { query: "Jane", project_key: "PROJ", max_results: 5 },
        context,
      );
      assert.match(users.content ?? "", /abc-123/);

      const issue = await executeTool(
        "jira_get_issue",
        { issue_key: "PROJ-1" },
        context,
      );
      assert.match(issue.content ?? "", /PROJ-1/);

      const dryRunCreate = await executeTool(
        "jira_create_issue",
        {
          issue_type: "Task",
          summary: "Preview only",
          assignee_query: "Jane Doe",
          dry_run: true,
        },
        context,
      );
      assert.match(dryRunCreate.content ?? "", /Dry run/);
      assert.equal(
        (dryRunCreate.details as { resolvedAssignee?: { accountId?: string } })
          .resolvedAssignee?.accountId,
        "abc-123",
      );

      const created = await executeTool(
        "jira_create_issue",
        {
          issue_type: "Task",
          summary: "Created by test",
          description: "Hello",
        },
        context,
      );
      assert.match(created.content ?? "", /PROJ-2/);

      const comment = await executeTool(
        "jira_add_comment",
        { issue_key: "PROJ-1", body: "Looks good" },
        context,
      );
      assert.match(comment.content ?? "", /Added comment/);

      const transitionPreview = await executeTool(
        "jira_transition_issue",
        {
          issue_key: "PROJ-1",
          transition: "Done",
          resolution: "Fixed",
          dry_run: true,
        },
        context,
      );
      assert.match(transitionPreview.content ?? "", /Dry run/);
      assert.equal(
        (transitionPreview.details as { fieldCount?: number }).fieldCount,
        1,
      );

      const transitioned = await executeTool(
        "jira_transition_issue",
        { issue_key: "PROJ-1", transition: "Done" },
        context,
      );
      assert.match(transitioned.content ?? "", /Transitioned/);
      assert.ok(calls.length >= 6);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("dispatches Confluence tools with configured auth and artifacts", async () => {
    const project = await createTempProject();
    const bodyFile = await project.write("body.storage.xml", "<p>Updated</p>");
    const uploadFile = await project.write("image.png", "fake image");
    const pageRowPath = await project.write(
      "pages.jsonl",
      `${JSON.stringify({
        schemaVersion: "nerve.confluence.page.v1",
        id: "123",
        title: "Home",
        spaceId: "space-1",
        version: { number: 7 },
        body: { representation: "storage", value: "<p>Published</p>" },
      })}\n`,
    );
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: URL; init?: RequestInit }> = [];
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      const auth =
        init?.headers && (init.headers as Record<string, string>).Authorization;
      assert.match(String(auth), /^Basic /);
      assert.equal(
        Buffer.from(String(auth).replace(/^Basic\s+/, ""), "base64").toString(
          "utf8",
        ),
        "user@example.com:confluence-token",
      );

      if (url.pathname === "/wiki/api/v2/spaces") {
        return new Response(
          JSON.stringify({
            results: [{ id: "space-1", key: "DEV", name: "Developers" }],
          }),
          { status: 200, statusText: "OK" },
        );
      }
      if (url.pathname === "/wiki/api/v2/pages" && init?.method !== "POST") {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: "123",
                title: "Home",
                spaceId: "space-1",
                space: { key: "DEV" },
                status: "current",
                version: { number: 7 },
              },
            ],
          }),
          { status: 200, statusText: "OK" },
        );
      }
      if (url.pathname === "/wiki/rest/api/search") {
        return new Response(
          JSON.stringify({
            results: [{ content: { id: "123", title: "Home" } }],
          }),
          { status: 200, statusText: "OK" },
        );
      }
      if (url.pathname === "/wiki/api/v2/pages" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { title?: string };
        assert.equal(body.title, "Created");
        return new Response(JSON.stringify({ id: "124", title: "Created" }), {
          status: 201,
          statusText: "Created",
        });
      }
      if (url.pathname === "/wiki/api/v2/pages/123/attachments") {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: "att-1",
                title: "image.png",
                mediaType: "image/png",
                fileSize: 9,
                downloadLink: "/download/image.png",
              },
            ],
          }),
          { status: 200, statusText: "OK" },
        );
      }
      if (url.pathname === "/download/image.png") {
        return new Response("fake image", { status: 200, statusText: "OK" });
      }
      if (url.pathname === "/wiki/api/v2/pages/123") {
        if (init?.method === "PUT") {
          const body = JSON.parse(String(init.body)) as {
            version?: { number?: number };
          };
          assert.equal(body.version?.number, 8);
          return new Response(
            JSON.stringify({
              id: "123",
              title: "Home",
              version: { number: 8 },
            }),
            { status: 200, statusText: "OK" },
          );
        }
        return new Response(
          JSON.stringify({
            id: "123",
            title: "Home",
            spaceId: "space-1",
            space: { key: "DEV" },
            status: "current",
            version: { number: 7 },
            body: {
              storage: { representation: "storage", value: "<p>Home</p>" },
            },
            _links: { webui: "/spaces/DEV/pages/123/Home" },
          }),
          { status: 200, statusText: "OK" },
        );
      }
      if (
        url.pathname === "/wiki/rest/api/content/123/child/attachment" &&
        init?.method === "PUT"
      ) {
        assert.equal(
          (init.headers as Record<string, string>)["X-Atlassian-Token"],
          "nocheck",
        );
        assert.equal(
          (init.headers as Record<string, string>)["Content-Type"],
          undefined,
        );
        assert.ok(init.body instanceof FormData);
        return new Response(
          JSON.stringify({
            results: [{ id: "att-1", title: "image.png", metadata: {} }],
          }),
          { status: 200, statusText: "OK" },
        );
      }
      throw new Error(
        `Unexpected Confluence fetch: ${init?.method ?? "GET"} ${url.pathname}`,
      );
    }) as typeof fetch;

    const context = {
      cwd: project.root,
      dataDir: project.root,
      getApiKey: async (provider: string) =>
        provider === "confluence" ? "confluence-token" : undefined,
      getProviderConfig: async (provider: string) =>
        provider === "confluence"
          ? {
              enabled: true,
              siteUrl: "https://example.atlassian.net/wiki/",
              email: "user@example.com",
              defaultSpaceKey: "DEV",
            }
          : undefined,
    };

    try {
      const spaces = await executeTool(
        "confluence_search_spaces",
        { query: "dev", limit: 1 },
        context,
      );
      assert.match(spaces.content ?? "", /Developers/);

      const pages = await executeTool(
        "confluence_search_pages",
        { space_key: "DEV", limit: 1 },
        context,
      );
      assert.match(pages.content ?? "", /Home/);

      const page = await executeTool(
        "confluence_get_page",
        { page_id: "123", include_attachments: true, markdown: true },
        context,
      );
      assert.match(page.content ?? "", /Home/);
      const pageArtifact = (
        page.details as {
          outputLimits?: { artifacts?: Array<{ path: string }> };
        }
      ).outputLimits?.artifacts?.[0];
      assert.ok(pageArtifact?.path);
      assert.match(await readFile(pageArtifact.path, "utf8"), /Home/);

      const download = await executeTool(
        "confluence_download_pages",
        { page_id: "123", markdown: true, include_attachments: true },
        context,
      );
      assert.match(download.content ?? "", /Pages JSONL/);
      const pagesJsonlPath = (download.details as { pagesJsonlPath?: string })
        .pagesJsonlPath;
      assert.ok(pagesJsonlPath);
      assert.match(await readFile(pagesJsonlPath, "utf8"), /<p>Home<\/p>/);

      const createPreview = await executeTool(
        "confluence_create_page",
        { title: "Created", body: "<p>Created</p>", dry_run: true },
        context,
      );
      assert.match(createPreview.content ?? "", /Dry run/);

      const created = await executeTool(
        "confluence_create_page",
        { title: "Created", body: "<p>Created</p>" },
        context,
      );
      assert.match(created.content ?? "", /124/);

      const updatePreview = await executeTool(
        "confluence_update_page",
        { page_id: "123", body_file: bodyFile, dry_run: true },
        context,
      );
      assert.match(updatePreview.content ?? "", /version 8/);

      const publishPreview = await executeTool(
        "confluence_publish_pages",
        { input_path: pageRowPath, dry_run: true },
        context,
      );
      assert.match(publishPreview.content ?? "", /Would update/);

      const upload = await executeTool(
        "confluence_upload_attachment",
        { page_id: "123", file_path: uploadFile },
        context,
      );
      assert.match(upload.content ?? "", /Storage XML image snippet/);
      assert.ok(calls.length >= 8);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects Jira tools when Jira is not configured", async () => {
    await assert.rejects(
      executeTool(
        "jira_search_issues",
        { jql: "project = PROJ" },
        {
          cwd: process.cwd(),
          getApiKey: async () => undefined,
          getProviderConfig: async () => ({ enabled: false }),
        },
      ),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        (error as { code?: string }).code === "JIRA_NOT_CONFIGURED",
    );
  });

  it("rejects Confluence tools when Confluence is not configured", async () => {
    await assert.rejects(
      executeTool(
        "confluence_search_pages",
        { cql: "type = page" },
        {
          cwd: process.cwd(),
          getApiKey: async () => undefined,
          getProviderConfig: async () => ({ enabled: false }),
        },
      ),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        (error as { code?: string }).code === "CONFLUENCE_NOT_CONFIGURED",
    );
  });

  it("rejects web_search when the stored Tavily key is missing", async () => {
    const previous = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = "env-key";
    try {
      await assert.rejects(
        executeTool(
          "web_search",
          { query: "missing key" },
          { cwd: process.cwd(), getApiKey: async () => undefined },
        ),
        /Configure Web Search in Nerve Settings/,
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
      /requires a host handler/,
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
      "task_cancel",
      "task_restart",
      "task_list",
    ] as ToolName[];

    for (const name of taskTools) {
      await assert.rejects(
        executeTool(name, {}, { cwd: process.cwd() }),
        /requires a host handler/,
        name,
      );
    }
  });

  it("rejects explore execution because it is orchestrator-owned", async () => {
    await assert.rejects(
      executeTool("explore", {}, { cwd: process.cwd() }),
      /requires a host handler/,
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
        /requires a host handler/,
        name,
      );
    }
  });
});
