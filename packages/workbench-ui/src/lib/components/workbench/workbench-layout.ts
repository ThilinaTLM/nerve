export type WorkbenchShellModel = {
  compact?: boolean;
  sidebarCollapsed?: boolean;
  utilityCollapsed?: boolean;
  navDrawerOpen?: boolean;
  utilityDrawerOpen?: boolean;
  autoSaveId?: string;
  leftLabel?: string;
  rightLabel?: string;
};

export type WorkbenchLayoutActions = {
  onNavDrawerOpenChange?: (open: boolean) => void;
  onUtilityDrawerOpenChange?: (open: boolean) => void;
};

export function toggleWorkbenchPane(
  model: WorkbenchShellModel,
  pane: "navigator" | "utility",
): WorkbenchShellModel {
  if (model.compact) {
    return pane === "navigator"
      ? { ...model, navDrawerOpen: !model.navDrawerOpen }
      : { ...model, utilityDrawerOpen: !model.utilityDrawerOpen };
  }
  return pane === "navigator"
    ? { ...model, sidebarCollapsed: !model.sidebarCollapsed }
    : { ...model, utilityCollapsed: !model.utilityCollapsed };
}

export function closeWorkbenchDrawers(
  model: WorkbenchShellModel,
): WorkbenchShellModel {
  return { ...model, navDrawerOpen: false, utilityDrawerOpen: false };
}
