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
  | "settings"
  | "settings-page"
  | "logs"
  | "launches"
  | "launch";

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
  settings: () => import("./MobileSettingsHost.svelte"),
  "settings-page": () => import("./MobileSettingsPageHost.svelte"),
  logs: () => import("./MobileLogsHost.svelte"),
  launches: () => import("./MobileLaunchesHost.svelte"),
  launch: () => import("./MobileLaunchOutputHost.svelte"),
} satisfies Record<LazyMobileRouteKind, () => MobileScreenModule>;

export type { LazyMobileRouteKind };
