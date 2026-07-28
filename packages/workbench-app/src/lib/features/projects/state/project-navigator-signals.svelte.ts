// Signal used by app-level shortcut handlers to open the searchable conversation
// browser owned by the project navigator, without holding a component ref.
export const projectNavigatorSignals = $state({
  searchFocusToken: 0,
});

export function focusProjectSearch(): void {
  projectNavigatorSignals.searchFocusToken += 1;
}
