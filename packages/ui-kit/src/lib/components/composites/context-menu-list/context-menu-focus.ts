/** Context key through which menu items tell their list not to restore focus. */
export const CONTEXT_MENU_FOCUS_KEY = Symbol("context-menu-list-focus");

export type ContextMenuFocusControl = { skipNextRestore: () => void };

/**
 * Whether a closing menu should return focus to its trigger. Skipped when the
 * chosen action asked to keep focus, or when focus already sits on something
 * outside the menu (for example an inline editor the action just mounted).
 */
export function shouldRestoreMenuFocus(state: {
  skipRequested: boolean;
  /** An element outside the menu holds focus (not the document body). */
  focusOutsideMenu: boolean;
}): boolean {
  return !state.skipRequested && !state.focusOutsideMenu;
}
