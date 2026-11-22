import type { ExtensionResolution } from "@nervekit/contracts/extensions";
import type { ExtensionHostPorts } from "@nervekit/tools/extension-host";
import type { QuickScriptRegistry } from "@nervekit/tools/quick-script";
import { accountPorts } from "../../domains/accounts/account-ports.js";
import type { AccountsReader } from "../../domains/accounts/accounts.service.js";
import {
  accountFieldKinds,
  fieldValue,
  kindsForUse,
} from "@nervekit/contracts/extensions";
import type { ExtensionState } from "@nervekit/tools/extension-host";
import type { ModelHosts } from "../model-hosts.js";
import type { ExtensionStore } from "./extension-store/extension-store.js";

/** What the resolved settings say about each extension: its switch and field values. */
export function extensionStates(
  resolution: ExtensionResolution,
): (id: string) => ExtensionState | undefined {
  return (id) => {
    const resolved = resolution.extensions[id];
    if (!resolved) return undefined;
    return {
      enabled: resolved.enabled.value === true,
      settings: Object.fromEntries(
        Object.keys(resolved.fields).map((key) => [
          key,
          fieldValue(resolved, key),
        ]),
      ),
    };
  };
}

/**
 * Whether an `account` setting's value was saved at user scope, which can select user-level
 * accounts only. Project and conversation scope also see their project's accounts.
 */
function selectedAtUserScope(
  resolution: ExtensionResolution,
  selection: { extensionId: string; field: string } | undefined,
): boolean {
  if (!selection) return false;
  return (
    resolution.extensions[selection.extensionId]?.fields[selection.field]
      ?.source.layer === "user"
  );
}

/** The accounts an extension host reads for one resolution: the level rule of each selection applied, no credential. */
export function resolvedAccounts(
  resolution: ExtensionResolution,
  accounts: AccountsReader,
): ExtensionHostPorts["accounts"] {
  return accountPorts(accounts, (selection) =>
    selectedAtUserScope(resolution, selection),
  );
}

/**
 * How the extension runtime reaches this host: the resolved settings of the
 * conversation, the accounts store (the credential is only handed to the
 * runtime's `ctx.http`), the image generation backend and the vision model
 * an extension's settings select. `store` with a `projectId` gives `ctx.extensionStore` of that
 * project; without a project the extension's store calls reject.
 */
export function createExtensionPorts(input: {
  resolution: ExtensionResolution;
  accounts: AccountsReader;
  models?: ModelHosts | undefined;
  store?: ExtensionStore | undefined;
  projectId?: string | undefined;
  warn?: (extensionId: string, message: string, data?: unknown) => void;
}): ExtensionHostPorts {
  const states = extensionStates(input.resolution);
  const { vision, text, images } = input.models ?? {};
  return {
    settings: (id) => states(id)?.settings ?? {},
    accounts: resolvedAccounts(input.resolution, input.accounts),
    ...(input.accounts.platformKinds
      ? {
          platformKinds: (platform: string) =>
            input.accounts.platformKinds!(platform),
        }
      : {}),
    ...(images
      ? {
          generateImage: (request) => images.generate(request),
          imageReady: (model) => images.ready(model),
        }
      : {}),
    ...(vision
      ? {
          explainImage: (request) => vision.explain(request),
          visionReady: (model) => vision.ready(model),
        }
      : {}),
    ...(text
      ? {
          completeText: (request) => text.complete(request),
          textReady: (model) => text.ready(model),
          defaultModel: async () =>
            input.projectId
              ? await text.defaultModel(input.projectId)
              : undefined,
        }
      : {}),
    ...(input.store && input.projectId
      ? { extensionStore: input.store.forProject(input.projectId) }
      : {}),
    log: (level, extensionId, message, data) => {
      if (level === "warn") input.warn?.(extensionId, message, data);
    },
  };
}

/**
 * What an approval of an extension call is bound to besides the settings: for
 * every enabled extension, the account each `account` setting selects, with its
 * non-secret fields. Switching the account, or its site, ends the approval; the
 * credential never enters it.
 */
export async function selectedAccountsTarget(
  registry: QuickScriptRegistry,
  resolution: ExtensionResolution,
  accounts: AccountsReader,
): Promise<Record<string, Record<string, unknown>>> {
  const states = extensionStates(resolution);
  const target: Record<string, Record<string, unknown>> = {};
  for (const extension of registry.extensions) {
    const state = states(extension.id);
    if (!state?.enabled) continue;
    const selected: Record<string, unknown> = {};
    for (const [field, declared] of Object.entries(extension.settings.fields)) {
      if (declared.type !== "account") continue;
      const id = state.settings[field];
      if (typeof id !== "string" || !id) continue;
      let account: Awaited<ReturnType<AccountsReader["get"]>>;
      const use =
        declared.platform === undefined
          ? undefined
          : extension.uses?.find((u) => u.platform === declared.platform);
      const kinds = use
        ? kindsForUse(
            [
              ...(accounts.platformKinds?.(use.platform) ?? []),
              ...(extension.accounts ?? []),
            ],
            use,
          ).map((kind) => kind.kind)
        : accountFieldKinds(declared);
      for (const kind of kinds) {
        account = await accounts.get(kind, id, {
          userLevelOnly: selectedAtUserScope(resolution, {
            extensionId: extension.id,
            field,
          }),
        });
        if (account) break;
      }
      selected[field] = account
        ? {
            id: account.id,
            kind: account.kind,
            name: account.name,
            fields: account.fields,
            level: account.level,
          }
        : { id, missing: true };
    }
    if (Object.keys(selected).length > 0) target[extension.id] = selected;
  }
  return target;
}
