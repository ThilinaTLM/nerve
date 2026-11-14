import type {
  ExtensionsView,
  ExtensionTarget,
  ExtensionView,
} from "@nervekit/contracts/extensions";
import { upgradeEntry } from "@nervekit/contracts/extensions";
import { extensionMetadata } from "@nervekit/extensions";
import type { AgentConfigurationService } from "../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import type {
  ExtensionContext,
  ExtensionScopeRef,
  ExtensionSettingsService,
} from "../infrastructure/configuration/extensions/extension-settings-service.js";
import { conversationExtensionContext } from "./conversation-extensions.js";
import type { QuickScriptRegistry } from "@nervekit/tools/quick-script";
import type { AccountsReader } from "../domains/accounts/accounts.service.js";
import { extensionAvailability } from "./extension-availability.js";
import { createExtensionPorts } from "./extension-ports.js";

export type ExtensionViewOptions = {
  extensions: ExtensionSettingsService;
  agents: Pick<AgentConfigurationService, "paths" | "getEffective">;
  /** The extensions the views describe. */
  registry: QuickScriptRegistry;
  accounts: AccountsReader;
};

export function toScopeRef(target: ExtensionTarget): ExtensionScopeRef {
  return target;
}

/** Resolved extension view per scope: values with sources, availability, metadata and schema. */
export function createExtensionViews(options: ExtensionViewOptions) {
  async function context(target: ExtensionTarget): Promise<ExtensionContext> {
    if (target.scope === "user") return { role: "lead" };
    if (target.scope === "project")
      return { projectId: target.projectId, role: "lead" };
    return conversationExtensionContext(options.agents, target.conversationId);
  }

  async function view(target: ExtensionTarget): Promise<ExtensionsView> {
    const ref = toScopeRef(target);
    const ctx = await context(target);
    const [resolution, file] = await Promise.all([
      options.extensions.resolve(ctx, target.scope),
      options.extensions.read(ref),
    ]);
    const { namespaces: availability } = await extensionAvailability(
      options.registry,
      resolution,
      options.accounts,
      {
        checkSecrets: true,
        ports: createExtensionPorts({ resolution, accounts: options.accounts }),
      },
    );
    const definitions = new Map(
      options.extensions.definitions.map((definition) => [
        definition.id,
        definition,
      ]),
    );
    const extensions = options.registry.extensions.map(
      (manifest): ExtensionView => {
        const resolved = resolution.extensions[manifest.id];
        const stored = file.entries[manifest.id];
        const definition = definitions.get(manifest.id)!;
        const upgraded = stored ? upgradeEntry(definition, stored) : undefined;
        return {
          metadata: extensionMetadata(manifest),
          settingsSchema: manifest.settings,
          accountKinds: manifest.accounts ?? [],
          enabled: resolved.enabled,
          fields: resolved.fields,
          stored:
            upgraded &&
            upgraded.status !== "newer" &&
            upgraded.status !== "failed"
              ? {
                  ...(upgraded.entry.enabled !== undefined
                    ? { enabled: upgraded.entry.enabled }
                    : {}),
                  settings: upgraded.entry.settings ?? {},
                }
              : null,
          readOnly: upgraded?.status === "newer",
          locked:
            target.scope === "conversation"
              ? options.extensions.lockedFields(ctx.appliedProfile, manifest.id)
              : [],
          availability: Object.fromEntries(
            (manifest.contributes.sdk ?? []).flatMap((namespace) =>
              availability[namespace.id]
                ? [[namespace.id, availability[namespace.id]]]
                : [],
            ),
          ),
        };
      },
    );
    return {
      target,
      extensions,
      file: {
        status: file.status,
        path: file.path,
        revision: file.revision,
        digest: file.digest,
        trusted: file.trusted,
      },
      diagnostics: resolution.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        // Diagnostics name a layer; the schema's layer set matches the resolver's.
      })),
      unknown: resolution.unknown.map(({ id, layer }) => ({ id, layer })),
    };
  }

  return { view, context };
}
export type ExtensionViews = ReturnType<typeof createExtensionViews>;
