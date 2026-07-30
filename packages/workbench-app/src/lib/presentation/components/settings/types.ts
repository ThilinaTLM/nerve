import type { Component } from "svelte";

export type SettingsTabDef = {
  id: string;
  label: string;
  disabled?: boolean;
};

export type SettingsPageDef = {
  id: string;
  label: string;
  icon: Component;
  description?: string;
  /** Always at least one tab. Single-tab pages render without a tab bar. */
  tabs: SettingsTabDef[];
};

export type SettingsChoice = {
  value: string;
  label: string;
  detail?: string;
  disabled?: boolean;
};

export type SettingsStatus = "ok" | "warning" | "error" | "muted";

export type SettingsTone = "info" | "success" | "warning" | "error";
