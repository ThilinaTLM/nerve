import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { PromptSuggestionListResponse } from "@nervekit/shared";
import { createAuthenticatedApp, tempHome } from "./helpers/server-routes.js";

async function writeSuggestion(
  dir: string,
  name: string,
  content: string,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${name}.md`), content);
}

describe("orchestrator prompt suggestion routes", () => {
  it("loads project and user markdown suggestions with project precedence", async () => {
    const { app, state, headers } = await createAuthenticatedApp();
    try {
      const projectRoot = await tempHome("nerve-suggestions-project-");
      const project = await state.registry.createProject({ dir: projectRoot });
      await writeSuggestion(
        join(state.storage.paths.home, "suggestions"),
        "review-diff",
        "---\nlabel: User Review\n---\n\nUse the user prompt.\n",
      );
      await writeSuggestion(
        join(projectRoot, ".nerve", "suggestions"),
        "review-diff",
        "---\nlabel: Project Review\n---\n\nUse the project prompt.\n",
      );

      const response = await app.request(
        `/api/projects/${project.id}/prompt-suggestions`,
        { headers },
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as PromptSuggestionListResponse;

      assert.equal(body.suggestions.length, 1);
      assert.equal(body.suggestions[0].label, "Project Review");
      assert.equal(body.suggestions[0].prompt, "Use the project prompt.");
      assert.equal(body.suggestions[0].source.kind, "project");
    } finally {
      state.index.close();
    }
  });

  it("requires trust before running JavaScript predicates", async () => {
    const { app, state, headers } = await createAuthenticatedApp();
    try {
      const projectRoot = await tempHome("nerve-suggestions-js-");
      const project = await state.registry.createProject({ dir: projectRoot });
      await writeSuggestion(
        join(projectRoot, ".nerve", "suggestions"),
        "js-enabled",
        [
          "---",
          "label: JS enabled",
          "enable-js: |",
          "  function enable(context) {",
          "    return context.project.name.length > 0;",
          "  }",
          "---",
          "",
          "Use the JavaScript-gated prompt.",
        ].join("\n"),
      );

      const pendingResponse = await app.request(
        `/api/projects/${project.id}/prompt-suggestions`,
        { headers },
      );
      assert.equal(pendingResponse.status, 200);
      const pending =
        (await pendingResponse.json()) as PromptSuggestionListResponse;
      assert.deepEqual(pending.suggestions, []);
      assert.equal(pending.trustRequests.length, 1);
      const trustId = pending.trustRequests[0].trustId;

      const allowResponse = await app.request("/api/prompt-suggestions/trust", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ trustId, status: "allowed" }),
      });
      assert.equal(allowResponse.status, 200);

      const allowedResponse = await app.request(
        `/api/projects/${project.id}/prompt-suggestions`,
        { headers },
      );
      assert.equal(allowedResponse.status, 200);
      const allowed =
        (await allowedResponse.json()) as PromptSuggestionListResponse;
      assert.equal(allowed.suggestions.length, 1);
      assert.equal(allowed.suggestions[0].label, "JS enabled");
      assert.equal(allowed.suggestions[0].trustStatus, "allowed");

      const statusesResponse = await app.request(
        `/api/prompt-suggestions/statuses?projectId=${project.id}`,
        { headers },
      );
      assert.equal(statusesResponse.status, 200);
      const statusesBody = (await statusesResponse.json()) as {
        statuses: Array<{ trustId?: string; status: string; path: string }>;
      };
      assert.ok(
        statusesBody.statuses.some(
          (status) => status.trustId === trustId && status.status === "allowed",
        ),
      );
    } finally {
      state.index.close();
    }
  });
});
