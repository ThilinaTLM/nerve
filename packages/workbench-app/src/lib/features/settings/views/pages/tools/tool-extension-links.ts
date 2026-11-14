import type { ExtensionView } from "@nervekit/contracts/extensions";
import {
  activeNamespaces,
  displayValue,
  extensionFix,
  namespaceProblem,
  sentence,
  type AccountChoices,
} from "../extensions/extensions-view";
import type { ToolId } from "./tool-settings";

/** Where a tool's setup lives: an extension's detail, or the Extensions list. */
export type ToolSettingsLink = { item?: string };

export function toolSettingsLink(id: ToolId): ToolSettingsLink | undefined {
  switch (id) {
    // A core tool that follows the Web extension; tools extensions contribute link by `ToolDescriptor.extension`.
    case "web_fetch":
      return { item: "web" };
    case "quick_script":
      return {};
    default:
      return undefined;
  }
}

/** What an extension adds to a tool row: its summary, or a problem with a link to fix it. */
export type ToolExtensionState = {
  summary?: string;
  problem?: string;
  fix?: { extensionId: string; label: string; section: string };
  /** The switch cannot be used until the problem is fixed. */
  disabled?: boolean;
};

function accountName(
  extension: ExtensionView,
  key: string,
  accounts: AccountChoices,
): string | undefined {
  const field = extension.settingsSchema.fields[key];
  return field
    ? displayValue(field, extension.fields[key]?.value, accounts)
    : undefined;
}

/**
 * Core tool rows whose setup lives in an extension: Web fetch follows the Web
 * extension, and Quick script lists the namespaces that are on. `undefined`
 * leaves the row alone. Tools an extension contributes use
 * {@link extensionToolState}.
 */
export function toolExtensionState(
  id: ToolId,
  extensions: readonly ExtensionView[] | undefined,
  accounts: AccountChoices,
): ToolExtensionState | undefined {
  if (!extensions) return undefined;
  const find = (extensionId: string) =>
    extensions.find((extension) => extension.metadata.id === extensionId);
  switch (id) {
    case "web_fetch": {
      const web = find("web");
      if (!web || web.enabled.value) return undefined;
      return turnedOff(web);
    }
    case "quick_script": {
      const problem = namespaceProblem(extensions);
      if (problem) {
        const owner = find(problem.extensionId)!;
        const fix = extensionFix(owner, accounts);
        return {
          problem: problem.text,
          fix: {
            extensionId: problem.extensionId,
            label: fix?.label ?? "Review",
            section: fix?.section ?? "settings",
          },
        };
      }
      return { summary: activeNamespaces(extensions).join(", ") };
    }
    default:
      return undefined;
  }
}

function turnedOff(owner: ExtensionView): ToolExtensionState {
  return {
    disabled: true,
    problem: `Turned off in the ${owner.metadata.name} extension`,
    fix: {
      extensionId: owner.metadata.id,
      label: `Open ${owner.metadata.name}`,
      section: "settings",
    },
  };
}

/**
 * What the contributing extension says about one of its direct tools: switched
 * off, not usable yet (with the way to fix it), or the extension and account it uses.
 */
export function extensionToolState(
  toolName: string,
  extensionId: string,
  extensions: readonly ExtensionView[] | undefined,
  accounts: AccountChoices,
): ToolExtensionState | undefined {
  const owner = extensions?.find(
    (extension) => extension.metadata.id === extensionId,
  );
  if (!owner) return undefined;
  if (!owner.enabled.value) return turnedOff(owner);
  const state = owner.toolAvailability?.[toolName];
  if (state && !state.available) {
    const kind = owner.accountKinds[0]?.kind;
    const hasAccounts = kind ? (accounts[kind]?.length ?? 0) > 0 : false;
    return {
      problem: sentence(state.reason),
      fix: {
        extensionId,
        label: !kind
          ? "Review"
          : hasAccounts
            ? "Choose account"
            : "Add account",
        section: kind && !hasAccounts ? "accounts" : "settings",
      },
    };
  }
  const accountNames = Object.keys(owner.settingsSchema.fields)
    .filter((key) => owner.settingsSchema.fields[key]?.type === "account")
    .flatMap((key) => {
      const name = accountName(owner, key, accounts);
      return name ? [name] : [];
    });
  return {
    summary: [`${owner.metadata.name} extension`, ...accountNames].join(" · "),
  };
}
