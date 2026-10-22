import ConversationCenterHost from "$lib/app/composition/centers/ConversationCenterHost.svelte";
import type { Component } from "svelte";

export { ConversationCenterHost };

export type CenterViewModule = Promise<{ default: Component }>;

/** Concrete feature wiring belongs in the composition root, not the shell. */
export const centerViewLoaders = {
  "async-bash": () =>
    import("$lib/features/conversations/adapters/AsyncBashCenterHost.svelte"),
  "system-prompt": () =>
    import("$lib/features/conversations/adapters/SystemPromptCenterHost.svelte"),
  launch: () => import("$lib/features/launches/hosts/LaunchCenterHost.svelte"),
  file: () => import("$lib/features/filesystem/hosts/FileCenterHost.svelte"),
  mermaid: () =>
    import("$lib/features/filesystem/hosts/MermaidCenterHost.svelte"),
  pr: () => import("$lib/features/git/hosts/PullRequestCenterHost.svelte"),
  diff: () => import("$lib/features/git/hosts/GitDiffCenterHost.svelte"),
  settings: () =>
    import("$lib/app/composition/centers/SettingsCenterHost.svelte"),
  "project-settings": () =>
    import("$lib/app/composition/centers/ProjectSettingsCenterHost.svelte"),
  logs: () => import("$lib/features/logs/hosts/LogsCenterHost.svelte"),
  discover: () =>
    import("$lib/app/composition/centers/DiscoverCenterHost.svelte"),
} satisfies Record<string, () => CenterViewModule>;

export type RegisteredCenterViewKind = keyof typeof centerViewLoaders;
