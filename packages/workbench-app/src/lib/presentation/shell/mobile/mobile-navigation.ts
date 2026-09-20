/**
 * Phone navigation model.
 *
 * The phone shell is a tab-and-detail shell, not a dock shell: four root tabs
 * live in the thumb zone and each one keeps its own single detail screen, so
 * leaving a conversation for the project tab and coming back lands where the
 * reader left off. Detail screens are full screen (no tab bar) so the composer
 * and long transcripts keep the whole viewport.
 */

export const MOBILE_TAB_IDS = ["inbox", "chats", "code", "more"] as const;
export type MobileTabId = (typeof MOBILE_TAB_IDS)[number];

/** The center tab stack (conversation, plan, settings, logs, diff, …). */
export type MobileCenterDetail = { kind: "center" };
/** A registered dock panel view rendered full screen. */
export type MobilePanelDetail = { kind: "panel"; viewId: string };
/** The project picker, a page on phones rather than a popover. */
export type MobileProjectsDetail = { kind: "projects" };
export type MobileDetail =
  | MobileCenterDetail
  | MobilePanelDetail
  | MobileProjectsDetail;

export type MobileNavState = {
  tab: MobileTabId;
  details: Partial<Record<MobileTabId, MobileDetail>>;
};

export function initialMobileNavState(): MobileNavState {
  return { tab: "inbox", details: {} };
}

export function isMobileTabId(value: string): value is MobileTabId {
  return (MOBILE_TAB_IDS as readonly string[]).includes(value);
}

export function activeMobileDetail(
  state: MobileNavState,
): MobileDetail | undefined {
  return state.details[state.tab];
}

/**
 * Re-tapping the active tab pops its detail, matching the platform gesture for
 * "take me back to the list".
 */
export function selectMobileTab(
  state: MobileNavState,
  tab: MobileTabId,
): MobileNavState {
  if (tab !== state.tab) return { ...state, tab };
  if (!state.details[tab]) return state;
  return { tab, details: withoutDetail(state.details, tab) };
}

export function openMobileCenterDetail(
  state: MobileNavState,
  tab: MobileTabId = state.tab,
): MobileNavState {
  return {
    tab,
    details: { ...state.details, [tab]: { kind: "center" } },
  };
}

export function openMobilePanelDetail(
  state: MobileNavState,
  viewId: string,
  tab: MobileTabId = "code",
): MobileNavState {
  return {
    tab,
    details: { ...state.details, [tab]: { kind: "panel", viewId } },
  };
}

export function openMobileProjectsDetail(
  state: MobileNavState,
): MobileNavState {
  return {
    ...state,
    details: { ...state.details, [state.tab]: { kind: "projects" } },
  };
}

export function closeMobileDetail(state: MobileNavState): MobileNavState {
  if (!state.details[state.tab]) return state;
  return { ...state, details: withoutDetail(state.details, state.tab) };
}

/**
 * The center stack is shared by every tab, so opening a center tab from one tab
 * invalidates the stale center detail parked on the others.
 */
export function retainSingleCenterDetail(
  state: MobileNavState,
): MobileNavState {
  const details: MobileNavState["details"] = {};
  for (const tab of MOBILE_TAB_IDS) {
    const detail = state.details[tab];
    if (!detail) continue;
    if (detail.kind === "center" && tab !== state.tab) continue;
    details[tab] = detail;
  }
  return { ...state, details };
}

function withoutDetail(
  details: MobileNavState["details"],
  tab: MobileTabId,
): MobileNavState["details"] {
  const next = { ...details };
  delete next[tab];
  return next;
}
