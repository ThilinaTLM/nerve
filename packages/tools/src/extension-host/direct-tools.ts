import { Type, type TObject } from "typebox";
import { type ToolView } from "@nervekit/extension-api";
import { DEFAULT_TOOL_VIEW, isMethodTool } from "@nervekit/extension-api/host";
import type { ToolName } from "@nervekit/contracts/tools";
import type { ToolDefinition } from "../catalog/contracts.js";
import { policy } from "../result-projection/policies/define-policy.js";
import { searchResultPolicy } from "../result-projection/policies/search.js";
import { textCandidate } from "../result-projection/candidates/text.js";
import type {
  ToolExecutionContext,
  ToolExecutionResult,
} from "../execution/execution-context.js";
import { ToolExecutionError } from "../execution/index.js";
import type { QuickScriptRegistry } from "../quick-script/registry.js";
import {
  reconcileReport,
  reportLines,
} from "../quick-script/runtime/quick-script.js";
import { withImageSizes } from "../quick-script/runtime/files/artifacts.js";
import {
  assertDeclaredRisk,
  quickScriptRiskOfMethod,
} from "../quick-script/runtime/script-risk.js";
import {
  createSdkEnvironment,
  findSdkMethod,
} from "../quick-script/runtime/sdk.js";
import {
  isOperationCheck,
  type QuickScriptContext,
  type SdkEnvironment,
  type SdkMethod,
} from "../quick-script/runtime/sdk-types.js";
import { hostErrorCode } from "../quick-script/runtime/errors.js";
import type { CodePresentation } from "./code-adapter.js";
import {
  assertNamespaceAvailable,
  sdkMethodForOwnTool,
} from "./from-definition.js";

/** Largest result data carried to the app (`details.sections`, all sections together). */
const MAX_SECTIONS_CHARS = 64_000;

type RegisteredTool = QuickScriptRegistry["tools"][number];

const proseResultPolicy = policy("network_prose", "head", textCandidate);

const hasLinks = (view: ToolView) =>
  view.sections.some((section) => section.type === "links");

/** How the agent sees a tool's result follows its view: a list of links is summarised per item, everything else is prose. */
const resultPolicyFor = (view: ToolView) =>
  hasLinks(view) ? searchResultPolicy : proseResultPolicy;

/** The view a tool declares, or the default (output as text). */
export const toolViewOf = (tool: { view?: ToolView }): ToolView =>
  tool.view ?? DEFAULT_TOOL_VIEW;

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
  const { definition: tool } = entry;
  const view = toolViewOf(tool);
  const liveSections = new Set(
    view.sections
      .filter((section) => section.live)
      .map((section) => section.id),
  );
  const env = createSdkEnvironment({
    ...context,
    registry,
    toolProgress: (section, chunk) => {
      if (!liveSections.has(section) || !chunk) return false;
      void Promise.resolve(
        context.onUpdate?.({ kind: "output", stream: section, chunk }),
      ).catch(() => undefined);
      return true;
    },
  });
  try {
    return await runExtensionTool(registry, entry, args, context, env);
  } finally {
    // The run's extension code (sessions, sandbox runtimes) ends with the call.
    await env.extensions.dispose();
  }
}

async function runExtensionTool(
  registry: QuickScriptRegistry,
  entry: RegisteredTool,
  args: Record<string, unknown>,
  context: QuickScriptContext,
  env: SdkEnvironment,
): Promise<ToolExecutionResult> {
  const { definition: tool, extension } = entry;
  const view = toolViewOf(tool);
  const method = methodOf(registry, entry);
  const namespace = isMethodTool(tool) ? tool.method.split(".")[0] : undefined;
  if (namespace) assertNamespaceAvailable(namespace, env);
  const prepared = await method.prepare([args], env);
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
  const code =
    value !== undefined && !isMethodTool(tool)
      ? await env.extensions.code(extension.definition!)
      : undefined;
  const presented: CodePresentation = (await code?.present(
    tool.name,
    value,
  )) ?? { text: render(value) };
  const text = presented.text;
  const first = view.sections[0];
  // Without values per section, the first section shows the output (text sections its text).
  const shown: Record<string, unknown> = presented.sections ?? {
    [first.id]:
      first.type === "text" || first.type === "markdown" ? text : value,
  };
  const declared = view.sections.flatMap((section) =>
    shown[section.id] !== undefined
      ? [
          {
            id: section.id,
            type: section.type,
            ...(section.label ? { label: section.label } : {}),
            value: shown[section.id],
          },
        ]
      : [],
  );
  const carried =
    (JSON.stringify(declared)?.length ?? 0) <= MAX_SECTIONS_CHARS
      ? declared
      : [];
  const links = view.sections.find((section) => section.type === "links");
  const linkValue = links ? shown[links.id] : undefined;
  return {
    content: [text, ...reportLines(artifacts, changes, env.report.notes)].join(
      "\n",
    ),
    details: {
      extension: extension.id,
      tool: tool.name,
      sections: carried,
      // What the item-aware agent projection of a `links` tool reads.
      ...(Array.isArray(linkValue)
        ? { results: linkValue, ...presented.details }
        : {}),
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
    const readOnly = baseRisk === "read" || baseRisk === "external_read";
    const staticRisk = baseRisk === "workspace_write" ? "write" : baseRisk;
    return {
      name: tool.name as ToolName,
      label: tool.label ?? tool.name,
      description: tool.description,
      // The model sees the extension's JSON Schema as is; arguments are validated against it.
      parameters: Type.Unsafe(tool.parameters) as unknown as TObject,
      group: "extension",
      extension: {
        id: extension.id,
        name: extension.name,
        view: toolViewOf(tool),
      },
      baseRisk,
      traits: [
        "credentialed",
        ...(readOnly
          ? (["read_only_network"] as const)
          : (["write_capable"] as const)),
      ],
      permissionMetadata: {
        kind: "integration",
        // The extension, and the namespace of the method a bound tool runs (`search.web`: `search`).
        groups: [
          ...new Set([
            extension.id,
            ...(isMethodTool(tool) ? [tool.method.split(".")[0]] : []),
          ]),
        ],
        baseRisk: staticRisk,
        primaryArguments: Object.keys(tool.parameters.properties ?? {}).slice(
          0,
          1,
        ),
        targetKinds: ["whole_tool"],
        primaryTargetComplete: true,
      },
      agentResult: resultPolicyFor(toolViewOf(tool)),
      executionKind: "local",
      executionMode: "parallel",
      executor: async (args, context: ToolExecutionContext) => {
        // The run's own registry decides (a project's extensions, reloaded code); this one is the fallback.
        const live = (context as Partial<QuickScriptContext>).registry;
        const liveEntry = live?.tools.find(
          (candidate) => candidate.definition.name === tool.name,
        );
        if (live && !liveEntry)
          throw new ToolExecutionError(
            "TOOL_NOT_ENABLED",
            `${tool.name}: not available in this project`,
          );
        return executeExtensionTool(
          live ?? registry,
          liveEntry ?? entry,
          args,
          context,
        );
      },
    };
  });
}
