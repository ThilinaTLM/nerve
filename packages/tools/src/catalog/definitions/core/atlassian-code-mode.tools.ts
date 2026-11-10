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
    group: "jira",
    baseRisk: "network",
    traits: ["credentialed", "long_running"],
    executionKind: "local",
    executor: executeAtlassianCodeMode,
    label: "Atlassian code mode",
    description: `Run a TypeScript script against Jira (read-only) in a sandbox with a global \`jira\` SDK. Batch many lookups in one script and filter in code. Results are plain objects; print what you need with console.log, only printed output is returned. Text fields are Markdown. \`fields\` take names ("Story Points") or ids. Errors throw HostError.
Issue = { key, id, url, summary, status, statusCategory, type, priority, assignee: {name,email,accountId}|null, reporter, created, updated, resolution, labels, components, fixVersions, parent, description (default on get only), ...requested fields }
${SDK_INDEX}`,
    parameters: atlassianCodeModeParameters,
    executionMode: "parallel",
  },
] satisfies ToolDefinition[];
