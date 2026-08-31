import type { Component } from "svelte";

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

export type SettingsTone = "info" | "success" | "warning" | "error";
