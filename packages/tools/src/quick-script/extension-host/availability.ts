import type {
  AccountInfo,
  Availability,
  ExtensionContext,
  Requires,
} from "@nervekit/extension-api";
import type {
  ExtensionManifest,
  NamespaceAvailability,
  QuickScriptAvailability,
} from "../manifest-types.js";
import type { QuickScriptRegistry } from "../registry.js";
import { settingsPage } from "./errors.js";

/**
 * Derived availability: whether each extension namespace and direct tool is
 * configured (extension and `enabledBy` switch on) and usable (also its
 * `requires` met and its `availability(ctx)` hook content). Reasons and fixes
 * are generated from the manifest, with the extension's name.
 */

/** The resolved state of one extension: its switch and the values of its settings. */
export type ExtensionState = {
  enabled: boolean;
  settings: Record<string, unknown>;
};

export type AvailabilityInput = {
  /** Resolved state per extension id; extensions without one are skipped. */
  extension(id: string): ExtensionState | undefined;
  accounts: {
    get(kind: string, id: string): Promise<AccountInfo | undefined>;
    hasSecret(kind: string, id: string): Promise<boolean>;
  };
  /** Check that a selected account has a saved secret. Off for the tool description, which only needs `configured`. */
  checkSecrets: boolean;
  /** Builds `ctx` for `availability(ctx)` hooks; without it hooks are skipped. */
  context?(extension: ExtensionManifest): ExtensionContext;
};

export type DerivedAvailability = {
  /** By namespace id. */
  namespaces: QuickScriptAvailability;
  /** By direct tool name. */
  tools: Readonly<Record<string, NamespaceAvailability>>;
};

type Gate = {
  enabledBy?: string | readonly string[];
  requires?: Requires;
  availability?: (
    ctx: ExtensionContext,
  ) => Availability | Promise<Availability>;
};

const labelOf = (extension: ExtensionManifest, key: string): string => {
  const field = extension.settings.fields[key];
  return field?.label ?? key;
};

async function stateOf(
  extension: ExtensionManifest,
  state: ExtensionState,
  gate: Gate,
  input: AvailabilityInput,
): Promise<NamespaceAvailability> {
  const where = settingsPage(extension.name);
  const switches =
    gate.enabledBy === undefined
      ? []
      : typeof gate.enabledBy === "string"
        ? [gate.enabledBy]
        : [...gate.enabledBy];
  if (!state.enabled)
    return {
      configured: false,
      available: false,
      reason: `the ${extension.name} extension is switched off.`,
      fix: `Ask the user to enable it in ${where}.`,
    };
  if (
    switches.length > 0 &&
    !switches.some((key) => state.settings[key] === true)
  ) {
    const labels = switches.map((key) => labelOf(extension, key)).join(" and ");
    return {
      configured: false,
      available: false,
      reason: `${labels} ${switches.length > 1 ? "are" : "is"} switched off in the ${extension.name} extension.`,
      fix: `Ask the user to enable ${switches.length > 1 ? "one" : labels} in ${where}.`,
    };
  }
  const field = gate.requires?.account;
  if (field) {
    const declared = extension.settings.fields[field];
    const kind =
      declared?.type === "account"
        ? extension.accounts?.find(
            (candidate) => candidate.kind === declared.kind,
          )
        : undefined;
    const label = kind?.label ?? "account";
    const id = state.settings[field];
    const account =
      kind && typeof id === "string" && id
        ? await input.accounts.get(kind.kind, id)
        : undefined;
    if (!kind || !account)
      return {
        configured: true,
        available: false,
        reason: `no ${label} is selected, or the selected one no longer exists.`,
        fix: `Ask the user to choose the ${label} with a saved ${kind?.secret.label ?? "credential"} in ${where}.`,
      };
    if (
      input.checkSecrets &&
      !(await input.accounts.hasSecret(kind.kind, account.id))
    )
      return {
        configured: true,
        available: false,
        reason: `the selected ${label} has no ${kind.secret.label} saved.`,
        fix: `Ask the user to check the account and its ${kind.secret.label} in ${where}.`,
      };
  }
  if (gate.availability && input.context) {
    const verdict = await gate.availability(input.context(extension));
    if (!verdict.available)
      return {
        configured: true,
        available: false,
        reason: verdict.reason,
        fix: verdict.fix,
      };
  }
  return { configured: true, available: true };
}

/** Availability of every extension namespace and direct tool in `registry`, from the resolved settings and accounts. */
export async function deriveAvailability(
  registry: QuickScriptRegistry,
  input: AvailabilityInput,
): Promise<DerivedAvailability> {
  const namespaces: Record<string, NamespaceAvailability> = {};
  const tools: Record<string, NamespaceAvailability> = {};
  for (const extension of registry.extensions) {
    const state = input.extension(extension.id);
    if (!state) continue;
    for (const namespace of extension.contributes.sdk ?? [])
      namespaces[namespace.id] = await stateOf(
        extension,
        state,
        namespace,
        input,
      );
    for (const tool of extension.tools ?? [])
      tools[tool.name] = await stateOf(extension, state, tool, input);
  }
  return { namespaces, tools };
}

/** Ids of the configured namespaces, for the tool description. */
export function configuredNamespaces(
  availability: QuickScriptAvailability,
): string[] {
  return Object.entries(availability)
    .filter(([, state]) => state.configured)
    .map(([id]) => id);
}
