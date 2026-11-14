import type {
  ExtensionsView,
  ExtensionTarget,
  ExtensionView,
} from "@nervekit/contracts/extensions";
import { upgradeEntry } from "@nervekit/contracts/extensions";
import { builtinExtensions, extensionMetadata } from "@nervekit/quick-script";
import type { AgentConfigurationService } from "../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import type {
  ExtensionContext,
  ExtensionScopeRef,
  ExtensionSettingsService,
} from "../infrastructure/configuration/extensions/extension-settings-service.js";
import { conversationExtensionContext } from "./conversation-extensions.js";
import {
  quickScriptAvailability,
  selectedAtlassianAccount,
  selectedSearchAccount,
  type AccountDirectory,
} from "./quick-script-availability.js";

export type ExtensionViewOptions = {
  extensions: ExtensionSettingsService;
  agents: Pick<AgentConfigurationService, "paths" | "getEffective">;
  accounts(): AccountDirectory;
  /** Whether a saved credential exists for the account (`atlassian:<id>`, `tavily:<id>`). */
  hasCredential(kind: "atlassian" | "tavily", id: string): Promise<boolean>;
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
    const accounts = options.accounts();
    const atlassian = selectedAtlassianAccount(resolution, accounts);
    const search = selectedSearchAccount(resolution, accounts);
    const availability = quickScriptAvailability(resolution, accounts, {
      atlassian: atlassian
        ? await options.hasCredential("atlassian", atlassian)
        : false,
      tavily: search ? await options.hasCredential("tavily", search) : false,
    });
    const definitions = new Map(
      options.extensions.definitions.map((definition) => [
        definition.id,
        definition,
      ]),
    );
    const extensions = builtinExtensions.map((manifest): ExtensionView => {
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
    });
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
