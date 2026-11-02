import type { DemoConversation } from "./conversation-types.js";

export const northstarConversations: readonly DemoConversation[] = [
  {
    title: "Show frost warnings on the planting calendar",
    agentProfile: "coding",
    permissionRuleSetId: "supervised",
    ageHours: 27,
    steps: [
      {
        type: "user",
        text: "Highlight days with a frost risk on the planting calendar.",
      },
      {
        type: "assistant",
        text: "Frost-risk days now carry a subtle blue marker, and the legend explains the threshold used.",
      },
    ],
  },
  {
    title: "Finish the seasonal crop summary",
    agentProfile: "coding",
    permissionRuleSetId: "supervised",
    ageHours: 14,
    pinned: true,
    steps: [
      {
        type: "user",
        text: "Finish the seasonal summary. I need stable alphabetical rows and a total for each crop, without changing how entries are stored.",
      },
      {
        type: "assistant",
        text: "I will inspect the draft summary and its entry model, then keep the change inside the projection function.",
        thinking:
          "The workspace already has a Map.groupBy draft. Returning a sorted array is friendlier to rendering and avoids coupling storage order to presentation order.",
      },
      {
        type: "tool",
        toolName: "read",
        risk: "read",
        repo: "northstar-journal",
        args: { path: "src/season-summary.ts" },
        result: {
          path: "src/season-summary.ts",
          content:
            'import type { GardenEntry } from "./entries.js";\n\nexport function cropTotals(entries: GardenEntry[]) {\n  return Map.groupBy(entries, (entry) => entry.crop);\n}\n',
          lines: 5,
        },
      },
      {
        type: "tool",
        toolName: "edit",
        risk: "workspace_write",
        repo: "northstar-journal",
        args: {
          path: "src/season-summary.ts",
          edits: [
            {
              oldText: "return Map.groupBy(entries, (entry) => entry.crop);",
              newText:
                "return Array.from(\n    Map.groupBy(entries, (entry) => entry.crop),\n    ([crop, cropEntries]) => ({ crop, count: cropEntries.length }),\n  ).sort((left, right) => left.crop.localeCompare(right.crop));",
            },
          ],
        },
        result: {
          path: "src/season-summary.ts",
          details: {
            diff: "@@ -1,5 +1,8 @@\n export function cropTotals(entries: GardenEntry[]) {\n-  return Map.groupBy(entries, (entry) => entry.crop);\n+  return Array.from(\n+    Map.groupBy(entries, (entry) => entry.crop),\n+    ([crop, cropEntries]) => ({ crop, count: cropEntries.length }),\n+  ).sort((left, right) => left.crop.localeCompare(right.crop));\n }",
            operationCount: 1,
            dryRun: false,
          },
        },
      },
      {
        type: "assistant",
        text: "The summary now returns render-ready rows sorted by crop name, with an explicit count for each crop. Entry persistence is unchanged.",
      },
    ],
  },
  {
    title: "Review offline journal recovery",
    agentProfile: "planning",
    permissionRuleSetId: "read_only",
    ageHours: 70,
    steps: [
      {
        type: "user",
        text: "Review the local storage path and propose how to recover from a malformed journal without silently losing entries.",
      },
      {
        type: "assistant",
        text: "The loader parses directly, so one malformed value prevents the journal from opening. I would preserve the raw value, surface a recovery prompt, validate entries individually, and only replace storage after the user exports or accepts the recovered set.",
      },
    ],
  },
];
