import type { DemoConversation } from "./conversation-types.js";

export const relayboardConversations: readonly DemoConversation[] = [
  {
    title: "Sort handoff items by priority",
    agentProfile: "coding",
    permissionRuleSetId: "supervised",
    ageHours: 4,
    completed: true,
    steps: [
      { type: "user", text: "Sort handoff items so urgent ones come first." },
      {
        type: "assistant",
        text: "Items now sort by priority, then by the order they were written.",
      },
    ],
  },
  {
    title: "Add machine-readable handoff export",
    agentProfile: "coding",
    permissionRuleSetId: "supervised",
    ageHours: 9,
    pinned: true,
    steps: [
      {
        type: "user",
        text: "Add a --json option for automation, but keep the Markdown handoff as the default output.",
      },
      {
        type: "assistant",
        text: "I will separate serialization from argument handling, then cover both output modes at the CLI boundary.",
      },
      {
        type: "tool",
        toolName: "grep",
        risk: "read",
        repo: "relayboard-cli",
        args: { pattern: "formatHandoff", glob: "{src,test}/**/*.js" },
        result: {
          matches: [
            {
              path: "src/cli.js",
              line: 2,
              text: 'import { formatHandoff } from "./format.js";',
            },
            {
              path: "src/format.js",
              line: 1,
              text: "export function formatHandoff({ shift, owner, items }) {",
            },
          ],
        },
      },
      {
        type: "tool",
        toolName: "edit",
        risk: "workspace_write",
        repo: "relayboard-cli",
        args: {
          path: "src/cli.js",
          edits: [
            {
              oldText: "console.log(formatHandoff(handoff));",
              newText:
                'const output = process.argv.includes("--json")\n  ? JSON.stringify(handoff, null, 2)\n  : formatHandoff(handoff);\nconsole.log(output);',
            },
          ],
        },
        result: {
          path: "src/cli.js",
          details: {
            diff: '@@ -4,4 +4,7 @@\n const file = process.argv[2] ?? "handoff.json";\n const handoff = JSON.parse(await readFile(file, "utf8"));\n-console.log(formatHandoff(handoff));\n+const output = process.argv.includes("--json")\n+  ? JSON.stringify(handoff, null, 2)\n+  : formatHandoff(handoff);\n+console.log(output);',
            operationCount: 1,
            dryRun: false,
          },
        },
      },
      {
        type: "assistant",
        text: "Relayboard now emits formatted JSON when --json is present and keeps the existing Markdown checklist as its default.",
      },
    ],
  },
  {
    title: "Make empty handoffs explicit",
    agentProfile: "coding",
    permissionRuleSetId: "read_only",
    ageHours: 81,
    completed: true,
    steps: [
      {
        type: "user",
        text: "What does the CLI print when there are no handoff items?",
      },
      {
        type: "assistant",
        text: "It prints the heading followed by a blank checklist. An explicit “No open handoff items” line would distinguish a clear shift from malformed input.",
      },
    ],
  },
];
