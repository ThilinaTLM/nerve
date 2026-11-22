/** Shared state between the Suggestions page header actions and its body. */
export class SuggestionsPageState {
  createDialogOpen = $state(false);
  /** The level "New suggestion" was chosen for. */
  createScope = $state<"user" | "project">("user");
  /** The open project's name, set by the page so the header can offer its level. */
  projectName = $state<string>();

  openCreate(scope: "user" | "project"): void {
    this.createScope = scope;
    this.createDialogOpen = true;
  }
}
