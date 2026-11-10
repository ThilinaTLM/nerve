import { Type } from "typebox";
import { executeAtlassianCodeMode } from "../../../execution/atlassian-code-mode/atlassian-code-mode.js";
import { SDK_INDEX } from "../../../execution/atlassian-code-mode/sdk.js";
import type { ToolDefinition } from "../../contracts.js";

const atlassianCodeModeParameters = Type.Object(
  {
    code: Type.String({
      description:
        "TypeScript ES module with top-level await, up to 100 KB. Only console output is returned.",
    }),
    timeout: Type.Optional(
      Type.Integer({
        default: 120,
        description: "Seconds; values above 600 are clamped to 600.",
      }),
    ),
  },
  { additionalProperties: false },
);

export const atlassianCodeModeToolDefinitions = [
  {
    name: "atlassian_code_mode",
    // No combined Atlassian group exists; the tool stays in `jira`.
    group: "jira",
    baseRisk: "network",
    traits: ["write_capable", "credentialed", "long_running"],
    executionKind: "local",
    executor: executeAtlassianCodeMode,
    label: "Atlassian code mode",
    description: `Run a TypeScript script against Jira and Confluence in a sandbox with globals \`jira\`, \`confluence\`, \`storage\`. Batch calls and filter in code. The top level is an ES module with top-level await: print results with console.log (no \`return\`); only printed output is returned. Results are plain objects, text fields are Markdown, \`fields\` take names ("Story Points") or ids. Errors throw HostError.
JQL must be bounded (e.g. \`project = X\`); a bare ORDER BY is rejected. Issue = { key, id, url, summary, status, statusCategory, type, priority, assignee/reporter: {name,email,accountId}|null, created, updated, resolution, labels, components, fixVersions, parent, description (get only), ...requested fields }; comment, attachment, issuelinks, subtasks, worklog come simplified.
${SDK_INDEX.jira}
${SDK_INDEX.confluence}
Storage helpers (build rich pages; pure strings):
${SDK_INDEX.storage}`,
    parameters: atlassianCodeModeParameters,
    executionMode: "parallel",
  },
] satisfies ToolDefinition[];
