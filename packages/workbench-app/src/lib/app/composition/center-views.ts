import ConversationShell from "$lib/features/conversations/components/ConversationShell.svelte";
import type { Component } from "svelte";

export { ConversationShell };

export type CenterViewModule = Promise<{ default: Component }>;

/** Concrete feature wiring belongs in the composition root, not the shell. */
export const centerViewLoaders = {
  task: () => import("$lib/features/tasks/components/TaskShell.svelte"),
  file: () => import("$lib/features/filesystem/components/FileShell.svelte"),
  mermaid: () =>
    import("$lib/features/filesystem/components/MermaidShell.svelte"),
  pr: () => import("$lib/features/git/components/PrShell.svelte"),
  diff: () => import("$lib/features/git/components/DiffShell.svelte"),
  settings: () =>
    import("$lib/features/settings/components/SettingsShell.svelte"),
  logs: () => import("$lib/features/logs/components/LogsShell.svelte"),
} satisfies Record<string, () => CenterViewModule>;

export type RegisteredCenterViewKind = keyof typeof centerViewLoaders;
