import { MediaQuery } from "svelte/reactivity";
import type { SandboxUtilityTab } from "./sandbox-ui-types";

const SIDEBAR_KEY = "nerve.sandboxManager.workbench.sidebarCollapsed";
const UTILITY_KEY = "nerve.sandboxManager.workbench.utilityCollapsed";
const COMPACT_QUERY = "max-width: 1023px";
const PHONE_QUERY = "max-width: 639px";

function readBoolean(key: string, fallback: boolean): boolean {
  if (typeof localStorage === "undefined") return fallback;
  const value = localStorage.getItem(key);
  if (value === null) return fallback;
  return value === "1";
}

function writeBoolean(key: string, value: boolean): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, value ? "1" : "0");
}

let compactQuery: MediaQuery | undefined;
let phoneQuery: MediaQuery | undefined;
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  compactQuery = new MediaQuery(COMPACT_QUERY);
  phoneQuery = new MediaQuery(PHONE_QUERY);
}

export const sandboxResponsive = {
  get isCompact(): boolean {
    return compactQuery?.current ?? false;
  },
  get isPhone(): boolean {
    return phoneQuery?.current ?? false;
  },
};

export const sandboxWorkbenchLayout = $state({
  utilityTab: "context" as SandboxUtilityTab,
  sidebarCollapsed: readBoolean(SIDEBAR_KEY, false),
  utilityCollapsed: readBoolean(UTILITY_KEY, false),
  navDrawerOpen: false,
  utilityDrawerOpen: false,
});

export function setSidebarCollapsed(collapsed: boolean): void {
  sandboxWorkbenchLayout.sidebarCollapsed = collapsed;
  writeBoolean(SIDEBAR_KEY, collapsed);
}

export function setUtilityCollapsed(collapsed: boolean): void {
  sandboxWorkbenchLayout.utilityCollapsed = collapsed;
  writeBoolean(UTILITY_KEY, collapsed);
}

export function setNavDrawerOpen(open: boolean): void {
  sandboxWorkbenchLayout.navDrawerOpen = open;
  if (open) sandboxWorkbenchLayout.utilityDrawerOpen = false;
}

export function setUtilityDrawerOpen(open: boolean): void {
  sandboxWorkbenchLayout.utilityDrawerOpen = open;
  if (open) sandboxWorkbenchLayout.navDrawerOpen = false;
}

export function openNavDrawer(): void {
  setNavDrawerOpen(true);
}

export function openUtilityDrawer(): void {
  setUtilityDrawerOpen(true);
}

export function closeDrawers(): void {
  sandboxWorkbenchLayout.navDrawerOpen = false;
  sandboxWorkbenchLayout.utilityDrawerOpen = false;
}
