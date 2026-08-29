import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allToolDescriptors } from "@nervekit/tools";
import { summarizeExploreToolCall } from "../../../src/domains/agents/execution/explore-tool-summary.js";

describe("Explore progress tool summaries", () => {
  it("summarizes representative tool families with bounded context", () => {
    assert.equal(
      summarizeExploreToolCall("read", { path: "src/server.ts", offset: 8 }),
      "Reading file (src/server.ts · line 8)",
    );
    assert.equal(
      summarizeExploreToolCall("grep", {
        pattern: "createServer",
        path: "packages/workbench-server",
      }),
      'Searching codebase ("createServer" in packages/workbench-server)',
    );
    assert.equal(
      summarizeExploreToolCall("find", {
        pattern: "**/*.test.ts",
        path: "packages",
      }),
      'Finding files ("**/*.test.ts" in packages)',
    );
    assert.equal(
      summarizeExploreToolCall("ls", { path: "packages/tools" }),
      "Listing directory (packages/tools)",
    );
    assert.equal(
      summarizeExploreToolCall("web_search", { query: "Svelte virtualizer" }),
      "Searching the web (Svelte virtualizer)",
    );
    assert.equal(
      summarizeExploreToolCall("task_logs", {
        taskId: "dev-server",
        mode: "errors",
      }),
      "Reading task logs (dev-server · errors)",
    );
    assert.equal(
      summarizeExploreToolCall("jira_get_issue", { issue_key: "NER-42" }),
      "Reading Jira issue (NER-42)",
    );
    assert.equal(
      summarizeExploreToolCall("confluence_get_page", { page_id: "123" }),
      "Reading Confluence page (123)",
    );
    assert.equal(
      summarizeExploreToolCall("plan_mode_enter", {}),
      "Entering plan mode",
    );
    assert.equal(
      summarizeExploreToolCall("future_tool", {}),
      "Running future tool",
    );
  });

  it("has specialized wording for every current built-in tool", () => {
    for (const descriptor of allToolDescriptors) {
      const fallback = `Running ${descriptor.name.replace(/[_-]+/g, " ")}`;
      assert.notEqual(
        summarizeExploreToolCall(descriptor.name, {}),
        fallback,
        `missing Explore activity summary for ${descriptor.name}`,
      );
    }
  });

  it("does not expose commands, scripts, environment values, or URL secrets", () => {
    const secret = "do-not-display-this-secret";
    const summaries = [
      summarizeExploreToolCall("bash", {
        command: `curl https://user:${secret}@example.test`,
      }),
      summarizeExploreToolCall("python_exec", {
        code: `print(${JSON.stringify(secret)})`,
        env: { TOKEN: secret },
      }),
      summarizeExploreToolCall("edit", {
        path: "src/config.ts",
        patch: secret,
      }),
      summarizeExploreToolCall("web_fetch", {
        url: `https://user:${secret}@example.test/docs?token=${secret}#private`,
      }),
    ];
    for (const summary of summaries) assert.ok(!summary.includes(secret));
    assert.equal(summaries[3], "Fetching web page (https://example.test/docs)");
  });

  it("truncates argument-derived detail", () => {
    const summary = summarizeExploreToolCall("web_search", {
      query: "x".repeat(1_000),
    });
    assert.ok(summary.length < 160);
    assert.match(summary, /…\)$/);
  });
});
