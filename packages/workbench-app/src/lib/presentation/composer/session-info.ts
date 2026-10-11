/** One labelled value in the context popover's Session section. */
export type SessionField = { label: string; value?: string; mono?: boolean };

export type ConversationSessionInfo = {
  fields: readonly SessionField[];
  /** Copies text to the clipboard and reports the outcome to the user. */
  onCopy?: (text: string, label: string) => void;
};

export function sessionFieldsText(fields: readonly SessionField[]): string {
  return fields
    .map((field) => `${field.label}: ${field.value ?? "—"}`)
    .join("\n");
}
