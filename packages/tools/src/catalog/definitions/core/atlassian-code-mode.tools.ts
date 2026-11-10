import { Type } from "typebox";
import { executeAtlassianCodeMode } from "../../../execution/atlassian-code-mode/atlassian-code-mode.js";
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
    description:
      "Run a sandboxed TypeScript script against Jira and Confluence with globals `jira`, `confluence`, `storage`. Read {{skill:atlassian-code-mode}} before first use; method references are linked from it.\nThe script is an ES module with top-level await: print results with console.log (no `return`); only printed output is returned. JQL must be bounded (e.g. `project = X`); a bare ORDER BY is rejected.",
    parameters: atlassianCodeModeParameters,
    executionMode: "parallel",
  },
] satisfies ToolDefinition[];
