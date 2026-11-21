import {
  accountFieldKinds,
  accountSecretFields,
} from "@nervekit/contracts/extensions";
import type { AccountInfo, Requires } from "@nervekit/extension-api";
import type {
  ExtensionManifest,
  NamespaceAvailability,
  QuickScriptAvailability,
} from "../quick-script/manifest-types.js";
import type { QuickScriptRegistry } from "../quick-script/registry.js";
import type { AvailabilityTarget, ExtensionCode } from "./code-adapter.js";
import { settingsPage } from "./errors.js";
import type { AccountCredentialState, AccountSelection } from "./ports.js";

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
    get(
      kind: string,
      id: string,
      selection?: AccountSelection,
    ): Promise<AccountInfo | undefined>;
    state(kind: string, id: string): Promise<AccountCredentialState>;
  };
  /** Check that a selected account is ready (not needing sign-in). Off for the tool description, which only needs `configured`. */
  checkSecrets: boolean;
  /** Opens the extension's code for its `availability` hooks (outside any run); without it hooks are skipped. `deriveAvailability` disposes what it opens. */
  code?(extension: ExtensionManifest): Promise<ExtensionCode>;
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
  /** The gate has an `availability` hook; its verdict comes from the extension's code. */
  availability?: unknown;
  /** What the hook belongs to. */
  target: AvailabilityTarget;
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
    const kinds =
      declared?.type === "account"
        ? accountFieldKinds(declared).flatMap(
            (id) => extension.accounts?.find((c) => c.kind === id) ?? [],
          )
        : [];
    const id = state.settings[field];
    let kind = kinds[0];
    let account: AccountInfo | undefined;
    if (typeof id === "string" && id)
      for (const candidate of kinds) {
        account = await input.accounts.get(candidate.kind, id, {
          extensionId: extension.id,
          field,
        });
        if (account) {
          kind = candidate;
          break;
        }
      }
    const label = kinds.map((c) => c.label).join(" or ") || "account";
    if (!kind || !account)
      return {
        configured: true,
        available: false,
        reason: `no ${label} is selected, or the selected one no longer exists.`,
        fix: `Ask the user to choose the ${label} to use, and to sign in to it if needed, in ${where}.`,
      };
    if (input.checkSecrets) {
      const credential = await input.accounts.state(kind.kind, account.id);
      if (credential !== "ready")
        return {
          configured: true,
          available: false,
          reason: {
            needs_sign_in: `the selected ${kind.label} needs sign-in.`,
            failed: `the selected ${kind.label} is signed in but its credential does not work.`,
            unavailable: `the extension that defines the selected ${kind.label} is off or gone.`,
          }[credential],
          fix: {
            needs_sign_in: `Ask the user to sign in to the account, or add its ${Object.values(
              accountSecretFields(kind),
            )
              .map((secret) => secret.label)
              .join(" and ")}, in ${where}.`,
            failed: `Ask the user to check the account in ${where}.`,
            unavailable: `Ask the user to enable that extension or choose another account in ${where}.`,
          }[credential],
        };
    }
  }
  if (gate.availability && input.code) {
    const verdict = await (
      await input.code(extension)
    ).availability(gate.target);
    if (verdict && !verdict.available)
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
  // One opened code per extension for this derivation, disposed at its end.
  const opened = new Map<string, Promise<ExtensionCode>>();
  const gated: AvailabilityInput = input.code
    ? {
        ...input,
        code: (extension) => {
          let code = opened.get(extension.id);
          if (!code) {
            code = input.code!(extension);
            opened.set(extension.id, code);
          }
          return code;
        },
      }
    : input;
  try {
    for (const extension of registry.extensions) {
      const state = input.extension(extension.id);
      if (!state) continue;
      for (const namespace of extension.contributes.sdk ?? [])
        namespaces[namespace.id] = await stateOf(
          extension,
          state,
          {
            ...namespace,
            target: { kind: "namespace", id: namespace.id },
          },
          gated,
        );
      for (const tool of extension.tools ?? [])
        tools[tool.name] = await stateOf(
          extension,
          state,
          { ...tool, target: { kind: "tool", name: tool.name } },
          gated,
        );
    }
  } finally {
    await Promise.all(
      [...opened.values()].map(async (code) => {
        try {
          await (await code).dispose();
        } catch {
          // Nothing left to release.
        }
      }),
    );
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
