import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { promptGuidelinesForTools } from "../../src/catalog/prompt-guidelines.js";

describe("tool prompt guidelines", () => {
  it("includes only exceptional guidance for active tools", () => {
    const guidelines = promptGuidelinesForTools([
      "read",
      "bash",
      "python_exec",
      "task_start",
    ]);

    assert.deepEqual(guidelines, [
      "Prefer dedicated file tools over bash for inspection and search.",
      "Long-running Bash calls may be promoted to background tasks. After launch or promotion, do not wait or poll task_status/task_logs; continue independent work or finish the turn. Updates arrive asynchronously, and terminal completion of agent-started tasks will restart you.",
      'Write large Python outputs under os.environ["NERVE_PYTHON_ARTIFACT_DIR"]; do not pass secrets through env or use Python for long-lived or interactive processes.',
      "Before starting a server or watcher, inspect active tasks with task_status unless current task state is already known.",
    ]);
  });

  it("keeps asynchronous task guidance when no dedicated file tool is active", () => {
    assert.deepEqual(promptGuidelinesForTools(["bash"]), [
      "Long-running Bash calls may be promoted to background tasks. After launch or promotion, do not wait or poll task_status/task_logs; continue independent work or finish the turn. Updates arrive asynchronously, and terminal completion of agent-started tasks will restart you.",
    ]);
  });

  it("does not promise Bash promotion to foreground-only teammates", () => {
    const guidelines = promptGuidelinesForTools(["bash", "read"], {
      foregroundOnlyBash: true,
    });
    assert.deepEqual(guidelines, [
      "Prefer dedicated file tools over bash for inspection and search.",
    ]);
  });

  it("emits shared group guidance once", () => {
    const guidelines = promptGuidelinesForTools([
      "jira_search_issues",
      "jira_get_issue",
      "confluence_search_pages",
      "confluence_get_page",
    ]);

    assert.deepEqual(guidelines, [
      "Keep Jira queries narrow and mutate Jira only when explicitly requested.",
      "Use storage XML or JSONL as the editable Confluence source of truth, treat markdown as read-only, and mutate Confluence only when explicitly requested.",
    ]);
  });

  it("ignores unknown and inactive tools", () => {
    assert.deepEqual(promptGuidelinesForTools(["unknown"]), []);
  });
});
