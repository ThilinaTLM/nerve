import { EditorView } from "@codemirror/view";

export const composerEditorTheme = EditorView.theme({
  "&": {
    background: "transparent",
    color: "var(--foreground)",
    maxHeight: "min(40vh, 320px)",
  },
  ".cm-content": {
    caretColor: "var(--primary)",
    // Prompt text is prose: sans by default. Shell-command mode (`!`) is the
    // only monospace state; ComposerEditor.svelte flips it via `.shell-mode`.
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-sm)",
    lineHeight: "1.5",
    padding: "10px 12px 6px",
  },
  ".cm-line": { padding: "0 2px" },
  ".cm-cursor": { borderLeftColor: "var(--primary)" },
  ".cm-placeholder": {
    color: "color-mix(in oklab, var(--muted-foreground) 75%, transparent)",
  },
  ".cm-executable-command-block-line": {
    backgroundColor: "color-mix(in oklab, var(--info) 9%, transparent)",
  },
  ".cm-executable-command-block-command": {
    backgroundColor: "color-mix(in oklab, var(--info) 16%, transparent)",
    color: "var(--foreground)",
    borderRadius: "var(--radius-sm)",
  },
  ".cm-scroller": {
    minHeight: "92px",
    maxHeight: "min(40vh, 320px)",
    overflow: "auto",
  },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--primary)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
    {
      backgroundColor: "color-mix(in oklab, var(--primary) 22%, transparent)",
    },
  /* chips stream: mention chips + dictation placeholder */
  ".cm-mention-chip": {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    height: "1.25rem",
    margin: "0 1px",
    padding: "0 0.375rem",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    background: "var(--muted)",
    color: "var(--foreground)",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-xs)",
    fontWeight: "500",
    lineHeight: "1",
    verticalAlign: "middle",
    userSelect: "none",
    whiteSpace: "nowrap",
    maxWidth: "100%",
  },
  ".cm-mention-chip-icon": {
    width: "0.75rem",
    height: "0.75rem",
    flexShrink: "0",
    color: "var(--muted-foreground)",
  },
  ".cm-mention-chip-file .cm-mention-chip-icon": { color: "var(--success)" },
  ".cm-mention-chip-info .cm-mention-chip-icon": { color: "var(--info)" },
  ".cm-mention-chip-label": {
    minWidth: "0",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  // Width fits the longest state ("Transcribing 0:00") so neither the timer
  // nor a state change reflows the surrounding text.
  ".cm-dictation-chip": {
    width: "8.75rem",
    justifyContent: "flex-start",
    fontVariantNumeric: "tabular-nums",
  },
  "&.cm-nerve-dictating .cm-placeholder": { display: "none" },
  ".cm-dictation-label": { flex: "1" },
  ".cm-dictation-time": { color: "var(--muted-foreground)" },
  ".cm-dictation-icon": {
    width: "0.625rem",
    height: "0.625rem",
    flex: "none",
    borderRadius: "9999px",
  },
  ".cm-dictation-chip[data-dictation='recording']": {
    borderColor: "color-mix(in oklab, var(--destructive) 45%, transparent)",
  },
  ".cm-dictation-chip[data-dictation='recording'] .cm-dictation-icon": {
    background: "var(--destructive)",
    animation: "cm-nerve-dictation-pulse 1.2s ease-in-out infinite",
  },
  ".cm-dictation-chip[data-dictation='transcribing'] .cm-dictation-icon": {
    border: "1.5px solid var(--muted-foreground)",
    borderTopColor: "transparent",
    animation: "cm-nerve-dictation-spin 0.8s linear infinite",
  },
  ".cm-dictation-chip[data-dictation='failed']": {
    borderColor: "color-mix(in oklab, var(--destructive) 45%, transparent)",
    color: "var(--destructive)",
  },
  ".cm-dictation-chip[data-dictation='failed'] .cm-dictation-icon": {
    background: "var(--destructive)",
    borderRadius: "2px",
  },
  "@keyframes cm-nerve-dictation-pulse": { "50%": { opacity: "0.35" } },
  "@keyframes cm-nerve-dictation-spin": { to: { transform: "rotate(360deg)" } },
});
