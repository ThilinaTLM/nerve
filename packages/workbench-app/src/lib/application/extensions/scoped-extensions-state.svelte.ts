import type {
  ExtensionCatalogEntry,
  ExtensionMutationResult,
  InstalledExtensionResult,
  ExtensionsView,
  ExtensionTarget,
} from "@nervekit/contracts/extensions";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";
import { publishUserExtensions } from "./selected-accounts.svelte";
import { onEvent } from "$lib/application/events/workbench-event-bus";
import { extensionChangeAffects } from "./extension-scope";
import {
  observeConversationChannel,
  requestConversation,
} from "$lib/application/startup/conversation-connection";
import { toTrustedDigest } from "@nervekit/contracts/core";

/** The settings entry of one extension at a scope; omitted keys are removed. */
export type ExtensionEntryChange = {
  enabled?: boolean;
  settings?: Record<string, unknown>;
};

type EditableTarget = Extract<ExtensionTarget, { scope: "user" | "project" }>;

function describe(
  result: Exclude<ExtensionMutationResult, { status: "saved" }>,
) {
  switch (result.status) {
    case "conflict":
      return "The extension settings changed elsewhere. Review the current values and try again.";
    case "unavailable":
      return "The extension settings file is unavailable. Fix or reset it first.";
    case "read-only":
      return result.message;
    case "invalid":
      return result.issues.map((issue) => issue.message).join(" ");
  }
}

/**
 * Extension settings of one scope as the daemon resolves them. A project
 * scope also loads the user scope: its values are what the project inherits.
 */
export class ScopedExtensionsState {
  view = $state.raw<ExtensionsView>();
  /** The user's view while a project is shown; what a project value differs from. */
  inherited = $state.raw<ExtensionsView>();
  error = $state<string>();
  saving = $state(false);
  target: EditableTarget | undefined;
  private generation = 0;

  async load(target: EditableTarget): Promise<void> {
    const generation = ++this.generation;
    if (JSON.stringify(this.target) !== JSON.stringify(target)) {
      this.view = undefined;
      this.inherited = undefined;
    }
    this.target = target;
    try {
      const [view, inherited] = await Promise.all([
        requestWorkbench("extensions.get", { target }),
        target.scope === "project"
          ? requestWorkbench("extensions.get", { target: { scope: "user" } })
          : undefined,
      ]);
      if (generation !== this.generation) return;
      this.view = view;
      this.inherited = inherited;
      publishUserExtensions(inherited ?? view);
      this.error = undefined;
    } catch (cause) {
      if (generation === this.generation)
        this.error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  reload(): Promise<void> {
    return this.target ? this.load(this.target) : Promise.resolve();
  }

  /** Replaces the stored entry of one extension at this scope. */
  save(id: string, entry: ExtensionEntryChange): Promise<boolean> {
    return this.mutate((target, expected) =>
      requestWorkbench("extensions.save", { target, expected, id, entry }),
    );
  }

  /** Removes the listed keys (or `enabled`); without `fields`, the whole entry. */
  reset(id: string, fields?: string[]): Promise<boolean> {
    return this.mutate((target, expected) =>
      requestWorkbench("extensions.reset", {
        target,
        expected,
        id,
        ...(fields ? { fields } : {}),
      }),
    );
  }

  /** Resets several extensions in order, each against the file the last one wrote. */
  async resetAll(ids: string[]): Promise<void> {
    for (const id of ids) if (!(await this.reset(id))) return;
  }

  async trustProject(trusted: boolean): Promise<boolean> {
    const view = this.view;
    const target = this.target;
    if (!view || target?.scope !== "project" || this.saving) return false;
    this.saving = true;
    try {
      const result = await requestWorkbench("extensions.trustProject", {
        projectId: target.projectId,
        expectedDigest: view.file.digest,
        trusted,
      });
      if (this.target !== target) return false;
      if (result.status === "conflict") {
        this.error = "The project's extension file changed. Review it again.";
        await this.load(target);
        return false;
      }
      this.view = result.view;
      this.error = undefined;
      return true;
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : String(cause);
      return false;
    } finally {
      this.saving = false;
    }
  }

  /** The user allows what was reviewed (`entry.consent`); only an installed, pending extension has it. */
  grantConsent(entry: ExtensionCatalogEntry): Promise<boolean> {
    const contentHash = entry.consent?.contentHash;
    if (!contentHash) return Promise.resolve(false);
    return this.installed(
      (target, source) =>
        requestWorkbench("extensions.grantConsent", {
          target,
          source,
          id: entry.id,
          contentHash,
        }),
      entry,
    );
  }

  /**
   * Declines a pending extension: it stays off and stops asking until the user
   * allows it. Recorded on the folder, like a revoke, whatever its files become.
   */
  async declineConsent(entry: ExtensionCatalogEntry): Promise<boolean> {
    const target = this.target;
    const contentHash = entry.consent?.contentHash;
    const projectId =
      entry.source === "user"
        ? null
        : entry.source === "project" && target?.scope === "project"
          ? target.projectId
          : undefined;
    if (!target || !contentHash || !entry.path || projectId === undefined)
      return false;
    if (this.saving) return false;
    this.saving = true;
    try {
      await requestConversation("trust.decide", {
        kind: "extension",
        projectId,
        resourceKey: entry.path,
        name: entry.id,
        contentDigest: toTrustedDigest(contentHash),
        status: "rejected",
      });
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : String(cause);
      return false;
    } finally {
      this.saving = false;
    }
    // The catalog reads decisions when it evaluates a folder.
    return this.reloadInstalled(entry.id);
  }

  revokeConsent(entry: ExtensionCatalogEntry): Promise<boolean> {
    return this.installed(
      (target, source) =>
        requestWorkbench("extensions.revokeConsent", {
          target,
          source,
          id: entry.id,
        }),
      entry,
    );
  }

  /** Re-reads installed extensions from disk: one, or all. A reload never grants consent. */
  reloadInstalled(id?: string): Promise<boolean> {
    return this.installed((target) =>
      requestWorkbench("extensions.reload", {
        target,
        ...(id ? { id } : {}),
      }),
    );
  }

  private async installed(
    run: (
      target: EditableTarget,
      source: "user" | "project",
    ) => Promise<InstalledExtensionResult>,
    entry?: ExtensionCatalogEntry,
  ): Promise<boolean> {
    const target = this.target;
    if (!target || this.saving) return false;
    const source = entry?.source === "project" ? "project" : "user";
    this.saving = true;
    try {
      const result = await run(target, source);
      if (this.target !== target) return false;
      if (result.status === "not_found") {
        this.error = "That extension is no longer there. Reload and try again.";
        await this.load(target);
        return false;
      }
      this.view = result.view;
      publishUserExtensions(result.view);
      this.error =
        result.status === "changed"
          ? "The extension's files changed while you reviewed them. Review it again."
          : undefined;
      return result.status === "saved";
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : String(cause);
      return false;
    } finally {
      this.saving = false;
    }
  }

  private async mutate(
    run: (
      target: EditableTarget,
      expected: { revision: number; digest: string },
    ) => Promise<ExtensionMutationResult>,
  ): Promise<boolean> {
    const target = this.target;
    const view = this.view;
    if (!target || !view || this.saving) return false;
    this.saving = true;
    try {
      const result = await run(target, {
        revision: view.file.revision,
        digest: view.file.digest,
      });
      if (this.target !== target) return false;
      if (result.status === "saved") {
        this.view = result.view;
        publishUserExtensions(result.view);
        this.error = undefined;
        return true;
      }
      this.error = describe(result);
      if (result.status === "conflict") await this.load(target);
      return false;
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : String(cause);
      return false;
    } finally {
      this.saving = false;
    }
  }

  /** Reloads on recovery and when another client changes a scope this view shows. */
  observe(): () => void {
    const stopChannel = observeConversationChannel({
      recover: () => this.reload(),
      disconnected() {},
      event() {},
      notice() {},
    });
    const stopChanged = onEvent("extensions.changed", (event) => {
      const changed = event.data.scope as ExtensionTarget;
      if (this.target && extensionChangeAffects(changed, this.target))
        void this.reload();
    });
    return () => {
      stopChannel();
      stopChanged();
    };
  }
}

/**
 * Id and name of every extension registered for a scope, for the settings
 * breadcrumb and detail routing. A project scope also has that project's
 * installed extensions, which the user scope does not.
 */
export async function loadExtensionItems(
  target: EditableTarget = { scope: "user" },
): Promise<{ id: string; label: string }[]> {
  const view = await requestWorkbench("extensions.get", { target });
  return view.extensions.map(({ metadata }) => ({
    id: metadata.id,
    label: metadata.name,
  }));
}
