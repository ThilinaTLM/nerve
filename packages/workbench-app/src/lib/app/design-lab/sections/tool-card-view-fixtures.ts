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
