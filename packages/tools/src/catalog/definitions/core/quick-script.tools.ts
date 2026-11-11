import { Type } from "typebox";
import { quickScriptDescription } from "../../../execution/quick-script/description.js";
import { executeQuickScript } from "../../../execution/quick-script/quick-script.js";
import { classifyQuickScriptArguments } from "../../../execution/quick-script/script-risk.js";
import type { ToolDefinition } from "../../contracts.js";

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
    classifyRisk: (args) => classifyQuickScriptArguments(args).risk,
    label: "Quick script",
    // Baseline without integrations; scoped-turn-resources rebuilds it per conversation.
    description: quickScriptDescription(),
    parameters: quickScriptParameters,
    executionMode: "parallel",
  },
] satisfies ToolDefinition[];
