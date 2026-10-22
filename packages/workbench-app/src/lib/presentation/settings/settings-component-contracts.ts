import type { Component } from "svelte";
import type { StatusTone } from "@nervekit/ui-kit/display/status";

export type SettingsSectionDef = {
  id: string;
  label: string;
  disabled?: boolean;
};

export type SettingsPageDef = {
  id: string;
  label: string;
  icon: Component;
  description?: string;
  /**
   * Anchored subsections of the page. Every section is rendered in the same
   * scroll view; sidebar links scroll to them. Pages with a single section do
   * not render a submenu.
   */
  sections: SettingsSectionDef[];
};

export type SettingsChoice = {
  value: string;
  label: string;
  detail?: string;
  disabled?: boolean;
};

export type SettingsStatus = "ok" | "warning" | "error" | "muted";

/** A count or flag at the end of a nav row, e.g. project changes on a page. */
export type SettingsNavBadge = {
  text: string;
  tone: Extract<StatusTone, "info" | "warning">;
};

/** One page link in the settings nav. `id` is the page id used for routing. */
export type SettingsNavItem = {
  id: string;
  label: string;
  icon: Component;
  badge?: SettingsNavBadge;
  disabled?: boolean;
};

/**
 * A labelled run of nav items. Omit `title` for a group that needs no caption
 * (only when it is not the first group of a titled nav).
 */
export type SettingsNavGroup = {
  id: string;
  title?: string;
  items: SettingsNavItem[];
};

/** Identity block above the nav: "User settings", or a project name + path. */
export type SettingsScopeHeader = {
  title: string;
  /** Second line, e.g. "All projects" or the project name. */
  subtitle?: string;
  /** Third line, a filesystem path (rendered monospace). */
  path?: string;
};
