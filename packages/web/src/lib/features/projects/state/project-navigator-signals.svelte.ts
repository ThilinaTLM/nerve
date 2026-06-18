// Signal used by app-level shortcut handlers to focus the project search field
// owned by the project navigator, without holding a ref into the component.
export const projectNavigatorSignals = $state({
  searchFocusToken: 0,
});

export function focusProjectSearch(): void {
  projectNavigatorSignals.searchFocusToken += 1;
}
