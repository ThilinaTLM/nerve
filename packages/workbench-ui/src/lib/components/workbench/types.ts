import type { ContextMenuItem } from "@nervekit/workbench-ui/components/ui/context-menu-list";
import type { StatusTone } from "@nervekit/workbench-ui/components/ui/status-dot";
import type { TabItem } from "@nervekit/workbench-ui/components/ui/tabs-bar";
import type { Component } from "svelte";

export type WorkbenchTabIdentity = { kind: string; id: string };

export type WorkbenchTabIcon = Component<{
  size?: number;
  strokeWidth?: number;
  class?: string;
  "aria-hidden"?: "true";
}>;

export type WorkbenchTabToggle = {
  label: string;
  title?: string;
  icon: WorkbenchTabIcon;
  disabled?: boolean;
  onClick?: (event: MouseEvent) => void;
};

export type WorkbenchTabStatus = {
  label?: string;
  tone?: StatusTone;
  pulse?: boolean;
};

export type WorkbenchTabModel = WorkbenchTabIdentity & {
  key?: string;
  label: string;
  title?: string;
  active?: boolean;
  running?: boolean;
  error?: boolean | string;
  closeable?: boolean;
  wide?: boolean;
  icon?: WorkbenchTabIcon;
  selectIcon?: WorkbenchTabIcon;
  status?: WorkbenchTabStatus;
  toggle?: WorkbenchTabToggle;
  draft?: boolean;
};

export type WorkbenchTabMenuBuilder = (input: {
  tab: WorkbenchTabModel;
  tabs: WorkbenchTabModel[];
  index: number;
}) => ContextMenuItem[];

export type WorkbenchUtilityTabItem = TabItem;
