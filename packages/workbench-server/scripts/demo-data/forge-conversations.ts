/**
 * Retained Forge and integration conversations of the Aurora demo project. The Forge transcript
 * shows the configure-nerve loop building the `env-status` extension (see
 * `env-status-extension.ts` for the sources the seed really builds); the integration transcript
 * is a `quick_script` that combines Jira, GitHub through MCP, and Confluence.
 */

import type { DemoConversation } from "./conversation-types.js";
import {
  ENV_STATUS_DATA,
  ENV_STATUS_EXTENSION,
  ENV_STATUS_PANEL,
  ENV_STATUS_TEST,
} from "./env-status-extension.js";

const FOLDER = ".nerve/extensions/env-status";

const RELOAD_SCRIPT = `await extensions.reload("env-status");
return await extensions.status("env-status");`;

const STATUS_SCRIPT = `return await extensions.status("env-status");`;

function written(path: string, content: string) {
  const bytes = Buffer.byteLength(content, "utf8");
  return `Created ${path} (${bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`}).`;
}

function writeStep(path: string, content: string) {
  return {
    type: "tool" as const,
    toolName: "write",
    risk: "workspace_write" as const,
    args: { path, content },
    result: {
      path,
      content: written(path, content),
      details: { outcome: "created" },
    },
  };
}

function statusResult(consent: "needs_review" | "granted") {
  const granted = consent === "granted";
  return {
    id: "env-status",
    state: granted ? "enabled" : "pending_consent",
    source: "project",
    folder: FOLDER,
    version: "0.1.0",
    sdkVersion: "0.41.1",
    consent,
    ...(granted ? { switch: "on" } : {}),
    diagnostics: [],
    recentErrors: [],
  };
}

export const envStatusForge: DemoConversation = {
  title: "Add an Environments panel for QA and production",
  agentProfile: "forge",
  permissionRuleSetId: "supervised",
  ageHours: 0.6,
  pinned: true,
  steps: [
    {
      type: "user",
      text: "Add a side panel to Aurora that shows whether our QA and production environments are up. I want each one's status, the deployed version and when it was last deployed.",
    },
    {
      type: "assistant",
      text: "That fits a project extension with a dock panel. I will read the extension guide first, then scaffold it in this project so the team can share the sources.",
      thinking:
        "A panel is a UI contribution, so an extension with kind panel. Project scope keeps it in the repository as sources. The user did not name a status endpoint, so the first version can use fixed sample data and declare no network access at all.",
    },
    {
      type: "tool",
      toolName: "read",
      risk: "read",
      args: { path: "configure-nerve/guide/extensions.md" },
      result: {
        path: "configure-nerve/guide/extensions.md",
        content:
          "# Build or change an extension\n\nAn extension is a folder with a built `dist/`. Nerve loads it only after the user allows it in Settings → Extensions. You can never grant that consent…\n\n## 2. Decide scope and kind\n\n- **Scope.** `project`: `<project>/.nerve/extensions/<id>/`, shared through the repository as sources.\n- **Kind.** `panel` (a dock panel) …",
        lines: 94,
      },
    },
    {
      type: "tool",
      toolName: "bash",
      risk: "command",
      args: {
        command:
          "node scripts/create-extension.mjs env-status --kind panel --scope project",
      },
      result: {
        content: `Created ${FOLDER}\nInstalled dependencies (--ignore-scripts)\n[1/3] Type check (svelte-check)\nsvelte-check found 0 errors and 0 warnings\n[2/3] Build and validate\nBuilt env-status 0.1.0 (SDK 0.41.1)\n[3/3] Tests (vitest run)\n 1 file, 2 tests passed\ncheck passed`,
        details: { exitCode: 0, signal: null },
      },
    },
    {
      type: "assistant",
      text: "The scaffold builds. I will replace the sample checklist with an Environments panel: the definition first, then the data, then the panel itself.",
    },
    writeStep(`${FOLDER}/src/extension.ts`, ENV_STATUS_EXTENSION),
    writeStep(
      `${FOLDER}/src/panels/environments/environments.ts`,
      ENV_STATUS_DATA,
    ),
    writeStep(
      `${FOLDER}/src/panels/environments/Environments.svelte`,
      ENV_STATUS_PANEL,
    ),
    writeStep(
      `${FOLDER}/src/panels/environments/environments.test.ts`,
      ENV_STATUS_TEST,
    ),
    {
      type: "tool",
      toolName: "bash",
      risk: "command",
      args: {
        command: `cd ${FOLDER} && rm -r src/panels/checklist && npx nerve-ext check`,
      },
      result: {
        content:
          "[1/3] Type check (svelte-check)\nsvelte-check found 0 errors and 0 warnings\n[2/3] Build and validate\nBuilt env-status 0.1.0 (SDK 0.41.1) into dist\n[3/3] Tests (vitest run)\n ✓ src/panels/environments/environments.test.ts (1 test)\ncheck passed",
        details: { exitCode: 0, signal: null },
      },
    },
    {
      type: "tool",
      toolName: "quick_script",
      risk: "command",
      args: { code: RELOAD_SCRIPT, timeout: 60 },
      result: {
        content: JSON.stringify(statusResult("needs_review"), null, 2),
        details: {
          status: "completed",
          durationMs: 612,
          memoryUsedBytes: 1_400_000,
          hostCalls: [
            {
              method: "extensions.reload",
              targets: ["extension:env-status"],
              summary: "env-status",
              outcome: "completed",
              durationMs: 402,
            },
            {
              method: "extensions.status",
              targets: ["extension:env-status"],
              summary: "env-status",
              outcome: "completed",
              durationMs: 9,
            },
          ],
        },
      },
    },
    {
      type: "assistant",
      text: "The extension is built and loaded, and it is waiting for your review. Open **Settings → Extensions → Environment status**, check what it asks for, and choose Allow.\n\nIt asks for one thing: a dock panel called Environments. It declares no network origins, accounts or tools, so it cannot reach anything. The first version shows fixed sample data for QA and Production (status, version, last deploy); when you have a status endpoint, I can swap the data for a real call.",
    },
    {
      type: "user",
      text: "Allowed it. Is it running?",
    },
    {
      type: "tool",
      toolName: "quick_script",
      risk: "read",
      args: { code: STATUS_SCRIPT, timeout: 30 },
      result: {
        content: JSON.stringify(statusResult("granted"), null, 2),
        details: {
          status: "completed",
          durationMs: 41,
          memoryUsedBytes: 900_000,
          hostCalls: [
            {
              method: "extensions.status",
              targets: ["extension:env-status"],
              summary: "env-status",
              outcome: "completed",
              durationMs: 9,
            },
          ],
        },
      },
    },
    {
      type: "assistant",
      text: "Yes. The extension is enabled and has no errors. The **Environments** panel is docked on the right:\n\n- **QA** is degraded: v2.4.0-rc.3, deployed 25 minutes ago, 1 of 6 smoke checks slow.\n- **Production** is healthy: v2.3.4, deployed 3 days ago.\n\nThe sources are in `.nerve/extensions/env-status/`; `dist/` stays out of git, so teammates build it with `npx nerve-ext check`.",
    },
  ],
};

const RELEASE_AUDIT_SCRIPT = `await atlassian.defaults();
const done = await jira.issues.search({
  jql: 'project = AUR AND fixVersion = "2.4" AND statusCategory = Done',
  fields: ["summary", "issuetype"],
  limit: 50,
});
const found = await mcp.tools.search({ query: "pull request", server: "github" });
const merged = await mcp.tools.call({
  server: "github",
  tool: found[0].name,
  arguments: { repo: "aurora-demo/aurora-api", state: "merged", base: "release/2.4" },
});
const prs = JSON.parse(merged.text);
const linked = done.filter((issue) => prs.some((pr) => pr.title.includes(issue.key)));
const orphans = done.filter((issue) => !linked.includes(issue));
const pages = await confluence.pages.search({ space: "REL", title: "Aurora 2.4 release notes" });
await confluence.pages.update(pages[0].id, {
  body: [
    storage.panel("info", \`\${linked.length} of \${done.length} issues have a merged pull request.\`),
    "## Without a merged pull request",
    orphans.map((issue) => \`- \${issue.key} \${issue.summary}\`).join("\\n"),
  ],
});
console.log(\`\${linked.length} linked, \${orphans.length} without a merged PR\`);`;

export const releaseAudit: DemoConversation = {
  title: "Check that every 2.4 issue has a merged PR",
  agentProfile: "coding",
  permissionRuleSetId: "supervised",
  ageHours: 1.4,
  steps: [
    {
      type: "user",
      text: "For every AUR issue in fix version 2.4, check that a pull request merged into release/2.4 mentions its key, and list the ones without on the release notes page.",
    },
    {
      type: "assistant",
      text: "I will search the GitHub MCP server for its pull request tool, call it once for the release branch, match the issue keys from Jira, and update the REL page in one script.",
    },
    {
      type: "tool",
      toolName: "quick_script",
      risk: "external_write",
      args: { code: RELEASE_AUDIT_SCRIPT, timeout: 120 },
      result: {
        content: "12 linked, 2 without a merged PR",
        details: {
          status: "completed",
          durationMs: 5_240,
          memoryUsedBytes: 3_600_000,
          hostCalls: [
            {
              method: "atlassian.defaults",
              targets: [],
              summary: "defaults",
              outcome: "completed",
              durationMs: 211,
            },
            {
              method: "jira.issues.search",
              targets: [],
              summary:
                'project = AUR AND fixVersion = "2.4" AND statusCategory = Done',
              outcome: "completed",
              durationMs: 688,
            },
            {
              method: "mcp.tools.search",
              targets: ["mcp:server/github"],
              summary: "Search MCP tools: pull request",
              outcome: "completed",
              durationMs: 24,
            },
            {
              method: "mcp.tools.call",
              targets: ["mcp:tool/github/list_pull_requests"],
              summary: "Call MCP tool github/list_pull_requests",
              outcome: "completed",
              durationMs: 1_634,
            },
            {
              method: "confluence.pages.search",
              targets: ["confluence:space/REL"],
              summary: 'space = "REL" AND title ~ "Aurora 2.4 release notes"',
              outcome: "completed",
              durationMs: 497,
            },
            {
              method: "confluence.pages.update",
              targets: ["confluence:space/REL"],
              summary: "REL/Aurora 2.4 release notes",
              outcome: "completed",
              durationMs: 1_102,
            },
          ],
          created: [],
        },
      },
    },
    {
      type: "assistant",
      text: '12 of the 14 issues have a merged pull request on release/2.4. The two without one, **AUR-318** and **AUR-327**, are now listed under "Without a merged pull request" on the Aurora 2.4 release notes page in REL.',
    },
  ],
};
