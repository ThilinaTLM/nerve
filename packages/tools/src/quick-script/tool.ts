import { Type } from "typebox";
import type { ToolDefinition } from "../catalog/index.js";
import { createExtensionToolDefinitions } from "./extension-host/direct-tools.js";
import type { QuickScriptRegistry } from "./registry.js";
import { executeQuickScript } from "./runtime/quick-script.js";
import { classifyQuickScriptArguments } from "./runtime/script-risk.js";

const parameters = Type.Object(
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

/**
 * The `quick_script` tool for `registry`. The host registers it with
 * `registerToolDefinitions` (`@nervekit/tools/catalog`) at startup and
 * replaces the description per conversation with `quickScriptDescription`.
 */
export function createQuickScriptToolDefinition(
  registry: QuickScriptRegistry,
): ToolDefinition {
  return {
    name: "quick_script",
    group: "quickScript",
    baseRisk: "network",
    traits: ["write_capable", "credentialed", "long_running"],
    executionKind: "local",
    executor: (args, context) =>
      executeQuickScript(args, { ...context, registry }),
    classifyRisk: (args) => classifyQuickScriptArguments(args, registry).risk,
    label: "Quick script",
    description:
      "Run a sandboxed TypeScript script (ES module, top-level await) that calls the SDK namespaces of the configured extensions; only its output returns.",
    parameters,
    executionMode: "parallel",
  };
}

/** Every tool the extensions' registry contributes: `quick_script` and the extensions' direct tools. */
export function quickScriptHostTools(
  registry: QuickScriptRegistry,
): ToolDefinition[] {
  return [
    createQuickScriptToolDefinition(registry),
    ...createExtensionToolDefinitions(registry),
  ];
}
