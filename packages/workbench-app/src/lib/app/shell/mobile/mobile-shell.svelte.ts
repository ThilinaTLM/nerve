import {
  activeMobileDetail,
  closeMobileDetail,
  initialMobileNavState,
  openMobileCenterDetail,
  openMobilePanelDetail,
  openMobileProjectsDetail,
  retainSingleCenterDetail,
  selectMobileTab,
  type MobileDetail,
  type MobileNavState,
  type MobileTabId,
} from "$lib/presentation/shell";

/**
 * Phone navigation state. Ephemeral by design: the shell is a monitoring
 * surface, so a reload starts at the inbox rather than restoring a stale
 * screen.
 */
let nav = $state<MobileNavState>(initialMobileNavState());

export const mobileNav = {
  get tab(): MobileTabId {
    return nav.tab;
  },
  get detail(): MobileDetail | undefined {
    return activeMobileDetail(nav);
  },
  get centerVisible(): boolean {
    return activeMobileDetail(nav)?.kind === "center";
  },
  get panelViewId(): string | undefined {
    const detail = activeMobileDetail(nav);
    return detail?.kind === "panel" ? detail.viewId : undefined;
  },
  get projectsVisible(): boolean {
    return activeMobileDetail(nav)?.kind === "projects";
  },
};

export function selectMobileTabId(tab: MobileTabId): void {
  nav = selectMobileTab(nav, tab);
}

/** Show the center stack (conversation, plan, settings, …) on the active tab. */
export function showMobileCenter(tab?: MobileTabId): void {
  nav = retainSingleCenterDetail(openMobileCenterDetail(nav, tab));
}

export function showMobilePanel(viewId: string): void {
  nav = openMobilePanelDetail(nav, viewId);
}

export function showMobileProjects(): void {
  nav = openMobileProjectsDetail(nav);
}

export function backFromMobileDetail(): void {
  nav = closeMobileDetail(nav);
}

export function resetMobileNav(): void {
  nav = initialMobileNavState();
}
