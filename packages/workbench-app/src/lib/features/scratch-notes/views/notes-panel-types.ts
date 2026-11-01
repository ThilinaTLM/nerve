export type NotesPanelActions = {
  create(): void;
  retry(): void;
  setContent(noteId: string, content: string): void;
  flush(noteId: string): void;
  rename(noteId: string, title: string): void;
  remove(noteId: string): void;
};
