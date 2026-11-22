/**
 * What an extension frame can ask of the rest of the app. The composition root registers the
 * implementations (this feature never imports another feature); calls fail when none is set.
 */
export type ExtensionHostActions = {
  /** Opens a project file in a tab. `path` is relative to the project or absolute inside it. */
  openFile(projectId: string, path: string): Promise<void> | void;
  /** Appends text to the active composer without sending. */
  insertIntoComposer(text: string): void;
  /** A frame started a conversation: puts `draft` (a prompt left unsent) into its composer and opens it when `open`. */
  conversationStarted(
    projectId: string,
    conversationId: string,
    options: { open: boolean; draft?: string },
  ): Promise<void>;
};

let actions: ExtensionHostActions | undefined;

export function registerExtensionHostActions(
  next: ExtensionHostActions,
): () => void {
  actions = next;
  return () => {
    if (actions === next) actions = undefined;
  };
}

export function extensionHostActions(): ExtensionHostActions {
  if (!actions) throw new Error("The app cannot do that right now");
  return actions;
}
