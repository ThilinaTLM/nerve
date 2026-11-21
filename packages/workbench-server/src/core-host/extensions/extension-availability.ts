import { type ExtensionResolution } from "@nervekit/contracts/extensions";
import {
  deriveAvailability,
  type DerivedAvailability,
  type ExtensionHostPorts,
} from "@nervekit/tools/extension-host";
import { type QuickScriptRegistry } from "@nervekit/tools/quick-script";
import { openAvailabilityCode } from "@nervekit/tools/extension-host";
import { ToolExecutionError } from "@nervekit/tools/execution";
import { toolDefinitionByName } from "@nervekit/tools/catalog";
import {
  createExtensionPorts,
  extensionStates,
  resolvedAccounts,
} from "./extension-ports.js";
import type { ExtensionStore } from "./extension-store/extension-store.js";
import type { AccountsReader } from "../../domains/accounts/accounts.service.js";
import type { VisionHost } from "../vision-models.js";

/**
 * Which extension namespaces and direct tools are configured and usable, from
 * the resolved extension settings and the user's accounts. `configured`
 * follows the switches (it decides what the tool description lists);
 * `available` also needs the declared account with a saved secret
 * (`checkSecrets`) and the extension's own `availability` hook.
 */
export async function extensionAvailability(
  registry: QuickScriptRegistry,
  resolution: ExtensionResolution,
  accounts: AccountsReader,
  options: { checkSecrets: boolean; ports?: ExtensionHostPorts },
): Promise<DerivedAvailability> {
  const { ports } = options;
  return await deriveAvailability(registry, {
    extension: extensionStates(resolution),
    accounts: resolvedAccounts(resolution, accounts),
    checkSecrets: options.checkSecrets,
    ...(ports
      ? {
          code: (extension) => openAvailabilityCode(registry, extension, ports),
        }
      : {}),
  });
}

/** Whether a direct tool of an extension is offered: configured and available. Tools the extensions do not contribute are not gated here. */
export function extensionToolOffered(
  availability: DerivedAvailability,
  toolName: string,
): boolean {
  const state = availability.tools[toolName];
  return state === undefined || (state.configured && state.available);
}

/** Refuses a model's call to a direct tool of an extension that is not set up; the error says why and what to fix. */
export async function assertExtensionToolOffered(
  registry: QuickScriptRegistry,
  toolName: string,
  resolution: ExtensionResolution,
  accounts: AccountsReader,
  vision?: VisionHost,
  store?: { store: ExtensionStore; projectId: string },
): Promise<void> {
  if (!registry.tools.some((tool) => tool.definition.name === toolName)) {
    // A tool another project's extension contributed is in the global catalog but not offered here.
    if (toolDefinitionByName(toolName)?.extension)
      throw new ToolExecutionError(
        "TOOL_NOT_ENABLED",
        `${toolName}: not available in this project`,
      );
    return;
  }
  const offered = await extensionAvailability(registry, resolution, accounts, {
    checkSecrets: true,
    ports: createExtensionPorts({
      resolution,
      accounts,
      ...(vision ? { vision } : {}),
      store: store?.store,
      projectId: store?.projectId,
    }),
  });
  if (extensionToolOffered(offered, toolName)) return;
  const state = offered.tools[toolName] as { reason?: string; fix?: string };
  throw new ToolExecutionError(
    "TOOL_NOT_ENABLED",
    `${toolName}: not available; ${state.reason ?? "its extension is not set up."} ${state.fix ?? ""}`.trim(),
  );
}
