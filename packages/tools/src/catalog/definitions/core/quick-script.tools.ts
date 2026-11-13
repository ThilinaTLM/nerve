import { Type } from "typebox";
import type { ToolDefinition } from "../../contracts.js";
import {
  classifyQuickScriptRisk,
  executeQuickScript,
} from "../../quick-script-runtime.js";

const quickScriptParameters = Type.Object(
  {
    code: Type.String({
      description:
        "TypeScript ES module with top-level await, up to 100 KB. Output is what you console.log plus a top-level `return`.",
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

export const quickScriptToolDefinitions = [
  {
    name: "quick_script",
    group: "quickScript",
    baseRisk: "network",
    traits: ["write_capable", "credentialed", "long_running"],
    executionKind: "local",
    executor: executeQuickScript,
    classifyRisk: classifyQuickScriptRisk,
    label: "Quick script",
    // Placeholder: the host builds the real description per conversation from the extension registry (`quickScriptDescription` in @nervekit/quick-script).
    description:
      "Run a sandboxed TypeScript script (ES module, top-level await) that calls the SDK namespaces of the configured extensions; only its output returns.",
    parameters: quickScriptParameters,
    executionMode: "parallel",
  },
] satisfies ToolDefinition[];
