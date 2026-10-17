/**
 * Per-tool-view sample data (file, search, web and todo tools) for the ToolCards gallery section. Builders and
 * lifecycle fixtures live in `tool-card-fixtures.ts`.
 */
import { SAMPLE_CWD, sampleCall, sampleDraft } from "./tool-card-fixtures";

const DIFF = `--- a/src/lib/presentation/cards/MetaChip.svelte
+++ b/src/lib/presentation/cards/MetaChip.svelte
@@ -10,7 +10,7 @@
 const toneClass: Record<StatusTone, string> = {
   neutral: "text-muted-foreground",
-  accent: "text-primary",
+  accent: "text-muted-foreground",
   info: "border-info/35 text-info",
   success: "border-success/35 text-success",
   warning: "border-warning/35 text-warning",`;

const READ_CONTENT = `<script lang="ts">
import { Button } from "@nervekit/ui-kit/components/ui/button";

let { label }: { label: string } = $props();
</script>

<Button variant="outline">{label}</Button>
`;

const MARKDOWN_DOC = `# Fetched page

Svelte 5 introduces **runes** for explicit reactivity.

- \`$state\` declares reactive state
- \`$derived\` computes from state
- \`$effect\` runs side effects`;

export const readText = sampleCall({
  id: "tool_read_ok",
  toolName: "read",
  args: { path: "src/lib/presentation/cards/Example.svelte" },
  result: {
    content: READ_CONTENT,
    path: `${SAMPLE_CWD}/src/lib/presentation/cards/Example.svelte`,
  },
});

export const readRange = sampleCall({
  id: "tool_read_range",
  toolName: "read",
  args: {
    path: "src/lib/presentation/tools/ToolCallCard.svelte",
    offset: 120,
    limit: 8,
  },
  result: {
    content: READ_CONTENT,
    path: `${SAMPLE_CWD}/src/lib/presentation/tools/ToolCallCard.svelte`,
    details: {
      truncation: { truncated: true, omittedLines: 560 },
      outputLimits: { model: { truncated: true, omittedLines: 560 } },
    },
  },
});

export const readRunning = sampleCall({
  id: "tool_read_run",
  toolName: "read",
  status: "running",
  ageMs: 900,
  args: { path: "packages/protocol/src/session.ts" },
});

export const editCompleted = sampleCall({
  id: "tool_edit_ok",
  toolName: "edit",
  args: {
    path: "src/lib/presentation/cards/MetaChip.svelte",
    edits: [
      {
        oldText: '  accent: "text-primary",',
        newText: '  accent: "text-muted-foreground",',
      },
    ],
  },
  result: {
    content: "Applied 1 edit to src/lib/presentation/cards/MetaChip.svelte",
    path: `${SAMPLE_CWD}/src/lib/presentation/cards/MetaChip.svelte`,
    details: {
      diff: DIFF,
      lineEnding: "\n",
      bom: false,
      operationCount: 1,
      operations: [
        { index: 0, type: "replace_text", matchedBy: "unique", matchCount: 1 },
      ],
    },
  },
});

export const editDraft = sampleDraft({
  toolName: "edit",
  argsText:
    '{"path":"src/lib/presentation/cards/MetaChip.svelte","edits":[{"oldText":"accent: \\"text-primary\\"","newText":"accent: \\"text-muted-fore',
  args: {
    path: "src/lib/presentation/cards/MetaChip.svelte",
    edits: [
      {
        oldText: 'accent: "text-primary"',
        newText: 'accent: "text-muted-fore',
      },
    ],
  },
});

export const writeCompleted = sampleCall({
  id: "tool_write_ok",
  toolName: "write",
  args: {
    path: "docs/notes/gallery.md",
    content:
      "# UI gallery\n\nCatalog of shared components.\n\n- Buttons\n- Cards\n",
  },
  result: {
    content: "Wrote 62 bytes to docs/notes/gallery.md",
    path: `${SAMPLE_CWD}/docs/notes/gallery.md`,
  },
});

export const writeRunning = sampleCall({
  id: "tool_write_run",
  toolName: "write",
  status: "running",
  ageMs: 1_000,
  args: {
    path: "src/lib/app/gallery/sections/New.svelte",
    content: '<script lang="ts">\nlet count = $state(0);\n</script>\n',
  },
});

const grepMatches = [
  {
    path: "src/lib/presentation/cards/CardShell.svelte",
    line: 24,
    text: "  dotTone: StatusTone;",
  },
  {
    path: "src/lib/presentation/cards/CardShell.svelte",
    line: 71,
    text: "  dotTone,",
  },
  {
    path: "src/lib/presentation/cards/CardHeader.svelte",
    line: 6,
    text: "  dotTone: StatusTone;",
  },
  {
    path: "src/lib/presentation/tools/ToolCallCard.svelte",
    line: 481,
    text: 'const dotTone = $derived(\n  stageIndicator?.tone ?? presentation?.dotTone ?? "info",\n);',
  },
];

export const grepCompleted = sampleCall({
  id: "tool_grep_ok",
  toolName: "grep",
  args: { pattern: "dotTone", path: "src/lib/presentation" },
  result: {
    content: "4 matches",
    path: `${SAMPLE_CWD}/src/lib/presentation`,
    matches: grepMatches,
  },
});

export const findCompleted = sampleCall({
  id: "tool_find_ok",
  toolName: "find",
  args: { pattern: "**/*Section.svelte", path: "src/lib/app/gallery" },
  result: {
    content: "3 files",
    path: `${SAMPLE_CWD}/src/lib/app/gallery`,
    entries: [
      { path: "sections/ButtonsSection.svelte", kind: "file" },
      { path: "sections/ToolCardsSection.svelte", kind: "file" },
      { path: "sections/TypographySection.svelte", kind: "file" },
    ],
  },
});

export const lsCompleted = sampleCall({
  id: "tool_ls_ok",
  toolName: "ls",
  args: { path: "src/lib/presentation/cards" },
  result: {
    content: "4 entries",
    path: `${SAMPLE_CWD}/src/lib/presentation/cards`,
    entries: [
      { path: "lifecycle", kind: "directory" },
      { path: "CardFooter.svelte", kind: "file" },
      { path: "CardShell.svelte", kind: "file" },
      { path: "MetaChip.svelte", kind: "file" },
    ],
  },
});

const PYTHON_SCRIPT = `import json, pathlib

root = pathlib.Path("src/lib/presentation/tools")
views = sorted(p.name for p in root.glob("tool-call/*ToolView.svelte"))
print(json.dumps({"views": len(views)}))
for name in views[:4]:
    print(" ", name)`;

export const pythonCompleted = sampleCall({
  id: "tool_py_ok",
  toolName: "python_exec",
  args: { code: PYTHON_SCRIPT, timeout: 60 },
  result: {
    content:
      '{"views": 31}\n  AskUserToolView.svelte\n  BashToolView.svelte\n  EditToolView.svelte\n  FindToolView.svelte',
    exitCode: 0,
  },
  durationMs: 1_100,
});

export const pythonRunning = sampleCall({
  id: "tool_py_run",
  toolName: "python_exec",
  status: "running",
  ageMs: 2_000,
  args: { code: PYTHON_SCRIPT, timeout: 60 },
});

export const bashMultiline = sampleCall({
  id: "tool_bash_multi",
  toolName: "bash",
  args: {
    command:
      "set -e\ncd packages/workbench-app\npnpm exec tsx --test src/lib/presentation/tools/views/tool-activity-state.test.ts",
    timeout: 300,
  },
  result: { content: "ℹ tests 4\nℹ pass 4\nℹ fail 0", exitCode: 0 },
  durationMs: 3_900,
});

export const launchCompleted = sampleCall({
  id: "tool_launch_ok",
  toolName: "launch",
  args: { action: "restart", name: "workbench-ui" },
  result: {
    content:
      "VITE v7.1.4  ready in 612 ms\n\n  Local:   http://localhost:5173/\n  Network: use --host to expose",
  },
});

const EDIT_OPS = [
  {
    oldText: '  accent: "text-primary",',
    newText: '  accent: "text-muted-foreground",',
  },
  {
    oldText: '    "inline-flex min-h-5 items-center rounded-sm",',
    newText:
      '    "inline-flex min-h-5 items-center rounded-sm",\n    "transition-colors duration-200",',
  },
];

export const editMultiOp = sampleCall({
  id: "tool_edit_multi",
  toolName: "edit",
  args: { path: "src/lib/presentation/cards/MetaChip.svelte", edits: EDIT_OPS },
  result: {
    content: "Applied 2 edits to src/lib/presentation/cards/MetaChip.svelte",
    path: `${SAMPLE_CWD}/src/lib/presentation/cards/MetaChip.svelte`,
    details: {
      diff: DIFF,
      lineEnding: "\n",
      bom: false,
      operationCount: 2,
      appliedCount: 2,
      operations: [
        {
          index: 0,
          type: "replace_text",
          matchedBy: "unique",
          matchCount: 1,
          status: "applied",
        },
        {
          index: 1,
          type: "replace_text",
          matchedBy: "unique",
          matchCount: 1,
          status: "applied",
        },
      ],
    },
  },
});

export const editFailed = sampleCall({
  id: "tool_edit_failed",
  toolName: "edit",
  status: "failed",
  args: { path: "src/lib/presentation/cards/MetaChip.svelte", edits: EDIT_OPS },
  error: "Edit 2: oldText was not found in the file. No edits were applied.",
  result: {
    content: "Edit 2: oldText was not found in the file.",
    details: {
      operationCount: 2,
      appliedCount: 0,
      operations: [
        { index: 0, status: "not_applied" },
        {
          index: 1,
          status: "failed",
          error: "oldText was not found in the file.",
        },
      ],
    },
  },
});

export const webSearchCompleted = sampleCall({
  id: "tool_ws_ok",
  toolName: "web_search",
  args: { query: "svelte 5 runes $state deep reactivity" },
  result: {
    content: "2 results",
    details: {
      query: "svelte 5 runes $state deep reactivity",
      answer:
        "In Svelte 5, $state makes objects and arrays deeply reactive via proxies; reassigning is not required for mutation to be tracked.",
      results: [
        {
          title: "$state • Svelte Docs",
          url: "https://svelte.dev/docs/svelte/$state",
          content:
            "$state creates reactive state. Arrays and plain objects are turned into deeply reactive proxies.",
          score: 0.92,
        },
        {
          title:
            "Understanding Svelte 5 reactivity: a long-form walkthrough of runes, signals, and fine-grained updates",
          url: "https://example.com/blog/svelte-5-reactivity-walkthrough-with-a-very-long-path/that/keeps/going",
          content: "A deep dive into how signals replaced stores.",
          score: 0.71,
        },
      ],
    },
  },
});

export const webSearchRunning = sampleCall({
  id: "tool_ws_run",
  toolName: "web_search",
  status: "running",
  ageMs: 2_500,
  args: { query: "tailwind v4 theme tokens" },
});

export const webFetchCompleted = sampleCall({
  id: "tool_wf_ok",
  toolName: "web_fetch",
  args: { url: "https://svelte.dev/docs/svelte/$state" },
  result: {
    content: MARKDOWN_DOC,
    details: {
      url: "https://svelte.dev/docs/svelte/$state",
      status: 200,
      contentType: "text/html",
      size: 48_213,
      converted: true,
      savedTo: `${SAMPLE_CWD}/.nerve/fetched/state.md`,
    },
  },
});

export const webFetchFailed = sampleCall({
  id: "tool_wf_fail",
  toolName: "web_fetch",
  status: "failed",
  args: { url: "https://internal.example.com/unreachable" },
  error: "fetch failed: getaddrinfo ENOTFOUND internal.example.com",
});

export const todosCompleted = sampleCall({
  id: "tool_todos_ok",
  toolName: "todos_set",
  args: {
    todos: [
      { todo: "Read the existing card components", done: true },
      { todo: "Build typed fixtures for every tool view", done: true },
      { todo: "Render lifecycle states in the gallery", done: false },
      { todo: "Validate with svelte-check", done: false },
    ],
  },
  result: {
    details: {
      todos: [
        { todo: "Read the existing card components", done: true },
        { todo: "Build typed fixtures for every tool view", done: true },
        { todo: "Render lifecycle states in the gallery", done: false },
        { todo: "Validate with svelte-check", done: false },
      ],
    },
  },
});

export const jiraSearchCompleted = sampleCall({
  id: "tool_jira_search",
  toolName: "jira_search_issues",
  args: { jql: "project = NRV AND status != Done ORDER BY updated DESC" },
  result: {
    details: {
      issues: [
        {
          key: "NRV-142",
          summary: "Unify tool card lifecycle rendering",
          issueType: "Task",
          status: "In Progress",
          statusCategory: "indeterminate",
          assignee: "Ada Lovelace",
          priority: "High",
        },
        {
          key: "NRV-138",
          summary: "Sub-agent rows use static status dots",
          issueType: "Bug",
          status: "To Do",
          statusCategory: "new",
          priority: "Medium",
        },
      ],
    },
  },
});

export const jiraCreateDraft = sampleDraft({
  toolName: "jira_create_issue",
  argsText:
    '{"project_key":"NRV","issue_type":"Task","summary":"Unify tool card lifecycle rendering","priority":"High","description":"Tool cards should keep the same keyed elements from drafting',
});

export const jiraCreateCompleted = sampleCall({
  id: "tool_jira_create",
  toolName: "jira_create_issue",
  args: {
    project_key: "NRV",
    issue_type: "Task",
    summary: "Unify tool card lifecycle rendering",
    priority: "High",
    description:
      "Tool cards should keep the same keyed elements from drafting to completion. Multi-item tools render one sheet section per item; chips are monotonic.",
  },
  result: {
    details: {
      issueKey: "NRV-142",
      summary: "Unify tool card lifecycle rendering",
    },
  },
});

export const confluenceSearchCompleted = sampleCall({
  id: "tool_conf_search",
  toolName: "confluence_search_pages",
  args: { query: "tool card lifecycle" },
  result: {
    details: {
      pages: [
        {
          id: "10231",
          title: "Tool card lifecycle design",
          spaceKey: "ENG",
          status: "current",
          versionNumber: 4,
          bodyPreview: "Cards keep one sheet from drafting to completion.",
        },
        {
          id: "10377",
          title: "Transcript motion budget",
          spaceKey: "ENG",
          status: "current",
          versionNumber: 2,
        },
      ],
    },
  },
});

export const generateImageRunning = sampleCall({
  id: "tool_img_run",
  toolName: "generate_image",
  status: "running",
  ageMs: 3_000,
  args: {
    prompt: "isometric illustration of stacked translucent cards",
    size: "1024x576",
  },
});

export const generateImageCompleted = sampleCall({
  id: "tool_img_ok",
  toolName: "generate_image",
  args: {
    prompt: "isometric illustration of stacked translucent cards",
    size: "1024x576",
  },
  result: {
    details: {
      images: [
        {
          path: `${SAMPLE_CWD}/generated/cards-morph.png`,
          bytes: 412_000,
          width: 1024,
          height: 576,
        },
      ],
    },
  },
});

export const explainImageCompleted = sampleCall({
  id: "tool_explain_ok",
  toolName: "explain_image",
  args: { path: "docs/screenshots/transcript.png" },
  result: {
    content:
      "The screenshot shows a transcript column with three tool cards. Each card has a header row, a recessed sheet and a footer of metadata chips.",
  },
});
