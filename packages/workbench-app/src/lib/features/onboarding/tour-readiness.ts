export function needsProjectForTour(hasActiveProject: boolean): boolean {
  return !hasActiveProject;
}

export function activeTabIsConversation(kind: string | undefined): boolean {
  return kind === "conversation" || kind === "pending-conversation";
}

export function deferredTourCanContinue(input: {
  awaitingProject: boolean;
  hasActiveProject: boolean;
  projectPickerOpen: boolean;
}): boolean {
  return (
    input.awaitingProject && input.hasActiveProject && !input.projectPickerOpen
  );
}
