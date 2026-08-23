import ConversationCenterHost from "$lib/app/composition/centers/ConversationCenterHost.svelte";
import type { Component } from "svelte";

export { ConversationCenterHost };

export type CenterViewModule = Promise<{ default: Component }>;

/** Concrete feature wiring belongs in the composition root, not the shell. */
export const centerViewLoaders = {
  task: () => import("$lib/features/tasks/components/TaskCenterHost.svelte"),
  file: () =>
    import("$lib/features/filesystem/components/FileCenterHost.svelte"),
  mermaid: () =>
    import("$lib/features/filesystem/components/MermaidCenterHost.svelte"),
  pr: () => import("$lib/features/git/components/PullRequestCenterHost.svelte"),
  diff: () => import("$lib/features/git/components/GitDiffCenterHost.svelte"),
  settings: () =>
    import("$lib/app/composition/centers/SettingsCenterHost.svelte"),
  logs: () => import("$lib/features/logs/components/LogsCenterHost.svelte"),
  discover: () =>
    import("$lib/app/composition/centers/DiscoverCenterHost.svelte"),
} satisfies Record<string, () => CenterViewModule>;

export type RegisteredCenterViewKind = keyof typeof centerViewLoaders;
