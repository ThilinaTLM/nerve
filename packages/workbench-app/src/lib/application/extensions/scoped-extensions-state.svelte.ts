import type {
  ExtensionMutationResult,
  ExtensionsView,
  ExtensionTarget,
} from "@nervekit/contracts/extensions";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";
import { publishUserExtensions } from "./selected-accounts.svelte";
import { observeConversationChannel } from "$lib/application/startup/conversation-connection";

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

  observe(): () => void {
    return observeConversationChannel({
      recover: () => this.reload(),
      disconnected() {},
      event() {},
      notice() {},
    });
  }
}

/** Id and name of every registered extension, for the settings breadcrumb. */
export async function loadExtensionItems(): Promise<
  { id: string; label: string }[]
> {
  const view = await requestWorkbench("extensions.get", {
    target: { scope: "user" },
  });
  return view.extensions.map(({ metadata }) => ({
    id: metadata.id,
    label: metadata.name,
  }));
}
