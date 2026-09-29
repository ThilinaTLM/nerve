import type { Component } from "svelte";
import type { MobileRoute } from "$lib/app/shell/mobile/mobile-routes";

/**
 * Phone screens that bind feature internals, keyed by route kind. They load
 * on first visit so the phone shell's startup bundle stays small.
 */
type LazyMobileRouteKind =
  | "files"
  | "notes"
  | "note"
  | "context"
  | "settings"
  | "settings-page"
  | "logs"
  | "tasks"
  | "task";

export type MobileScreenProps<K extends MobileRoute["kind"]> = {
  route: Extract<MobileRoute, { kind: K }>;
  visible: boolean;
};

// Each screen narrows `route` to its own kind; `never` props accept them all.
type MobileScreenModule = Promise<{ default: Component<never> }>;

export const mobileScreenLoaders = {
  files: () => import("./MobileFilesHost.svelte"),
  notes: () => import("./MobileNotesHost.svelte"),
  note: () => import("./MobileNoteEditorHost.svelte"),
  context: () => import("./MobileContextHost.svelte"),
  settings: () => import("./MobileSettingsHost.svelte"),
  "settings-page": () => import("./MobileSettingsPageHost.svelte"),
  logs: () => import("./MobileLogsHost.svelte"),
  tasks: () => import("./MobileTasksHost.svelte"),
  task: () => import("./MobileTaskOutputHost.svelte"),
} satisfies Record<LazyMobileRouteKind, () => MobileScreenModule>;

export type { LazyMobileRouteKind };
