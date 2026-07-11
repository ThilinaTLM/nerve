import assert from "node:assert/strict";
import test from "node:test";
import { GitService } from "@nervekit/tools";
import { withGitMutationEvents } from "../src/index.js";

class FakeGitService extends GitService {
  fail = false;

  constructor() {
    super(() => ({ dir: "/workspace", name: "workspace" }));
  }

  override async stageFile(projectId: string, repo: string, path: string) {
    void path;
    if (this.fail) throw new Error("git failed");
    return {
      repo: {
        relativePath: repo,
        absDir: "/workspace",
        name: "workspace",
        isRepo: true as const,
        currentBranch: "feature/test",
        detached: false,
        ahead: 0,
        behind: 0,
        hasUpstream: true,
        hasRemote: true,
        hasGithubRemote: true,
        baseBranch: "main",
        onBaseBranch: false,
        mergedToBase: false,
        dirty: true,
        changeCount: 1,
      },
    };
  }
}

test("Git mutation decorator publishes safe events after success only", async () => {
  const service = new FakeGitService();
  const events: unknown[] = [];
  const decorated = withGitMutationEvents(service, {
    publish: (_type, data) => events.push(data),
  });

  await decorated.stageFile("proj_test", ".", "src/index.ts");
  assert.deepEqual(events, [
    {
      projectId: "proj_test",
      repo: ".",
      reason: "file.staged",
      head: { branch: "feature/test" },
    },
  ]);
  assert.equal(JSON.stringify(events).includes("https://"), false);

  service.fail = true;
  await assert.rejects(
    decorated.stageFile("proj_test", ".", "src/secret.ts"),
    /git failed/,
  );
  assert.equal(events.length, 1);
});
