import { Type, type TObject } from "typebox";
import { isMethodTool, type DisplayKind } from "@nervekit/extension-api";
import type { ToolName } from "@nervekit/contracts/tools";
import type { ToolDefinition } from "../../catalog/contracts.js";
import { policy } from "../../result-projection/policies/define-policy.js";
import { textCandidate } from "../../result-projection/candidates/text.js";
import type {
  ToolExecutionContext,
  ToolExecutionResult,
} from "../../execution/execution-context.js";
import { ToolExecutionError } from "../../execution/index.js";
import type { QuickScriptRegistry } from "../registry.js";
import { reconcileReport, reportLines } from "../runtime/quick-script.js";
import { withImageSizes } from "../runtime/files/artifacts.js";
import {
  assertDeclaredRisk,
  quickScriptRiskOfMethod,
} from "../runtime/script-risk.js";
import { createSdkEnvironment, findSdkMethod } from "../runtime/sdk.js";
import {
  isOperationCheck,
  type QuickScriptContext,
  type SdkMethod,
} from "../runtime/sdk-types.js";
import { hostErrorCode } from "../runtime/errors.js";
import {
  assertNamespaceAvailable,
  sdkMethodForOwnTool,
} from "./from-definition.js";

/** Largest result value carried to the app as data (`details.display.value`). */
const MAX_DISPLAY_VALUE_CHARS = 64_000;

type RegisteredTool = QuickScriptRegistry["tools"][number];

const genericResultPolicy = policy("network_prose", "head", textCandidate);

function render(value: unknown): string {
  if (value === undefined || value === null) return "(no result)";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/** The method a tool runs: its bound namespace method, or its own implementation. */
function methodOf(
  registry: QuickScriptRegistry,
  { definition: tool, extension }: RegisteredTool,
): SdkMethod {
  if (isMethodTool(tool)) {
    const method = findSdkMethod(tool.method, registry);
    if (!method)
      throw new Error(
        `${extension.id}: tool ${tool.name} is bound to unknown method ${tool.method}.`,
      );
    return method;
  }
  return sdkMethodForOwnTool(extension.definition!, tool);
}

/**
 * Runs an extension's direct tool: the same `parse → authorize → run` as a
 * namespace method, with the tool's own admission already granted by the
 * caller. Operation checks still go through `authorizeNested` so rules naming
 * the operation apply; a check naming the tool itself is the admission and is skipped.
 */
async function executeExtensionTool(
  registry: QuickScriptRegistry,
  entry: RegisteredTool,
  args: Record<string, unknown>,
  context: QuickScriptContext,
): Promise<ToolExecutionResult> {
  const { definition: tool, extension } = entry;
  const env = createSdkEnvironment({ ...context, registry });
  const method = methodOf(registry, entry);
  const namespace = isMethodTool(tool) ? tool.method.split(".")[0] : undefined;
  if (namespace) assertNamespaceAvailable(namespace, env);
  const prepared = method.prepare([args], env);
  const checks = [
    ...(prepared.authorization ? [prepared.authorization] : []),
    ...(prepared.additionalAuthorizations ?? []),
  ];
  assertDeclaredRisk(tool.name, method.risk, checks);
  for (const check of checks) {
    if (!isOperationCheck(check)) {
      if (check.toolName === tool.name) continue;
      await context.authorizeNested?.({
        toolName: check.toolName,
        args: check.args,
      });
      continue;
    }
    await context.authorizeNested?.({
      operation: check.operation,
      targets: check.targets.map((target) => target.value),
      risk: check.risk,
    });
  }
  let value: unknown;
  try {
    value = await prepared.run(env);
  } catch (error) {
    if (
      error instanceof ToolExecutionError &&
      hostErrorCode(error) === "FORBIDDEN" &&
      prepared.resource
    )
      throw new ToolExecutionError(
        "FORBIDDEN",
        `${tool.name}: no access to ${prepared.resource}`,
      );
    throw error;
  }
  const changes = reconcileReport({
    created: env.report.created,
    updated: env.report.updated,
    deleted: env.report.deleted,
    raw: [],
  });
  const artifacts = await withImageSizes([...env.report.artifacts.values()]);
  const text = render(value);
  const carried =
    value !== undefined &&
    JSON.stringify(value)?.length <= MAX_DISPLAY_VALUE_CHARS
      ? value
      : undefined;
  return {
    content: [text, ...reportLines(artifacts, changes, env.report.notes)].join(
      "\n",
    ),
    details: {
      extension: extension.id,
      tool: tool.name,
      display: {
        kind: tool.display satisfies DisplayKind,
        ...(carried !== undefined ? { value: carried } : {}),
      },
      artifacts,
      created: changes.created,
      updated: changes.updated,
      deleted: changes.deleted,
    },
  };
}

/**
 * Catalog definitions of the direct tools the registry's extensions contribute.
 * The host registers them once (`registerToolDefinitions`) and decides per
 * conversation which are offered (extension on, `enabledBy`, `requires`).
 */
export function createExtensionToolDefinitions(
  registry: QuickScriptRegistry,
): ToolDefinition[] {
  return registry.tools.map((entry): ToolDefinition => {
    const { definition: tool, extension } = entry;
    const method = methodOf(registry, entry);
    const baseRisk = quickScriptRiskOfMethod(method.risk);
    const readOnly = baseRisk === "read" || baseRisk === "network";
    const staticRisk =
      baseRisk === "workspace_write" || baseRisk === "external_write"
        ? "write"
        : baseRisk;
    return {
      name: tool.name as ToolName,
      label: tool.label ?? tool.name,
      description: tool.description,
      // The model sees the extension's JSON Schema as is; arguments are validated against it.
      parameters: Type.Unsafe(tool.parameters) as unknown as TObject,
      group: "extension",
      extension: { id: extension.id, name: extension.name },
      baseRisk,
      traits: [
        "credentialed",
        ...(readOnly
          ? (["read_only_network"] as const)
          : (["write_capable"] as const)),
      ],
      permissionMetadata: {
        kind: "integration",
        groups: [extension.id],
        baseRisk: staticRisk,
        primaryArguments: Object.keys(tool.parameters.properties ?? {}).slice(
          0,
          1,
        ),
        targetKinds: ["whole_tool"],
        primaryTargetComplete: true,
      },
      agentResult: genericResultPolicy,
      executionKind: "local",
      executionMode: "parallel",
      executor: (args, context: ToolExecutionContext) =>
        executeExtensionTool(registry, entry, args, context),
    };
  });
}
