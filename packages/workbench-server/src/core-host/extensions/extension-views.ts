import type {
  ExtensionsView,
  ExtensionTarget,
  ExtensionView,
} from "@nervekit/contracts/extensions";
import { upgradeEntry } from "@nervekit/contracts/extensions";
import type { AgentConfigurationService } from "../../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import type {
  ExtensionContext,
  ExtensionScopeRef,
  ExtensionSettingsService,
} from "../../infrastructure/configuration/extensions/extension-settings-service.js";
import { conversationExtensionContext } from "./conversation-extensions.js";
import { extensionMetadata } from "@nervekit/tools/extension-host";
import type { ExtensionRegistryProvider } from "./extension-catalog/extension-catalog.js";
import type { AccountsReader } from "../../domains/accounts/accounts.service.js";
import { extensionAvailability } from "./extension-availability.js";
import { createExtensionPorts } from "./extension-ports.js";
import type { ExtensionStore } from "./extension-store/extension-store.js";
import type { VisionHost } from "../vision-models.js";

export type ExtensionViewOptions = {
  extensions: ExtensionSettingsService;
  agents: Pick<AgentConfigurationService, "paths" | "getEffective">;
  /** The extensions the views describe: the registry and catalog of the target's project. */
  catalog: ExtensionRegistryProvider;
  /** The directory of a project, to find its own extensions. */
  projectDirectory?(projectId: string): string | undefined;
  accounts: AccountsReader;
  vision?: VisionHost;
  /** The durable store behind `ctx.extensionStore` in availability hooks of a project's extensions. */
  extensionStore?: ExtensionStore;
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
    const projectDir = ctx.projectId
      ? options.projectDirectory?.(ctx.projectId)
      : undefined;
    // First: the settings definitions of the project's installed extensions come from what is composed.
    const [registry, catalog] = await Promise.all([
      options.catalog.registryFor(projectDir),
      options.catalog.entries(projectDir),
    ]);
    const [resolution, file] = await Promise.all([
      options.extensions.resolve(ctx, target.scope),
      options.extensions.read(ref),
    ]);
    const { namespaces: availability, tools: toolAvailability } =
      await extensionAvailability(registry, resolution, options.accounts, {
        checkSecrets: true,
        ports: createExtensionPorts({
          resolution,
          accounts: options.accounts,
          ...(options.vision ? { vision: options.vision } : {}),
          store: options.extensionStore,
          projectId: ctx.projectId,
        }),
      });
    const definitions = new Map(
      options.extensions
        .definitionsFor(ctx.projectId)
        .map((definition) => [definition.id, definition]),
    );
    const extensions = registry.extensions.map((manifest): ExtensionView => {
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
        toolAvailability: Object.fromEntries(
          (manifest.tools ?? []).flatMap((tool) =>
            toolAvailability[tool.name]
              ? [[tool.name, toolAvailability[tool.name]]]
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
      catalog,
      unknown: resolution.unknown.map(({ id, layer }) => ({ id, layer })),
    };
  }

  return { view, context };
}
