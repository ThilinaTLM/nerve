import { EditorView } from "@codemirror/view";

export const composerEditorTheme = EditorView.theme({
  "&": {
    background: "transparent",
    color: "var(--foreground)",
    maxHeight: "min(40vh, 320px)",
  },
  ".cm-content": {
    caretColor: "var(--primary)",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-sm)",
    lineHeight: "1.5",
    padding: "18px 46px 14px 11px",
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
  ".cm-tooltip": {
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    background: "var(--popover)",
    color: "var(--popover-foreground)",
    boxShadow: "var(--shadow-lg)",
    overflow: "hidden",
  },
  ".cm-tooltip-autocomplete.nerve-composer-completions": {
    minWidth: "min(24rem, calc(100vw - 2rem))",
    maxWidth: "min(34rem, calc(100vw - 2rem))",
    padding: "0.15rem",
  },
  ".cm-tooltip-autocomplete.nerve-composer-completions > ul": {
    maxHeight: "none",
    overflow: "hidden",
    padding: "0.1rem",
    fontFamily: "var(--font-mono)",
  },
  ".cm-tooltip-autocomplete.nerve-composer-completions > ul > completion-section":
    {
      borderBottom: "0",
      color: "var(--muted-foreground)",
      fontFamily: "var(--font-sans)",
      fontSize: "var(--text-xs)",
      fontWeight: "500",
      letterSpacing: "0.02em",
      padding: "0.25rem 0.4rem 0.15rem",
      textTransform: "uppercase",
    },
  ".cm-tooltip-autocomplete.nerve-composer-completions > ul > li": {
    display: "flex",
    alignItems: "center",
    minHeight: "1.55rem",
    borderRadius: "var(--radius-sm)",
    padding: "0.18rem 0.4rem",
    color: "var(--popover-foreground)",
  },
  ".cm-tooltip-autocomplete.nerve-composer-completions > ul > li[aria-selected]":
    {
      background: "var(--accent)",
      color: "var(--accent-foreground)",
    },
  ".cm-tooltip-autocomplete.nerve-composer-completions .cm-completionLabel": {
    display: "none",
  },
  ".cm-tooltip-autocomplete.nerve-composer-completions .cm-completionDetail": {
    display: "none",
  },
  ".cm-tooltip-autocomplete.nerve-composer-completions .cm-nerve-row": {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    minWidth: "0",
    width: "100%",
  },
  ".cm-tooltip-autocomplete.nerve-composer-completions .cm-nerve-row-icon": {
    display: "inline-flex",
    flexShrink: "0",
    alignItems: "center",
    color: "var(--muted-foreground)",
  },
  ".cm-tooltip-autocomplete.nerve-composer-completions .nerve-completion-directory .cm-nerve-row-icon":
    { color: "var(--info)" },
  ".cm-tooltip-autocomplete.nerve-composer-completions .nerve-completion-file .cm-nerve-row-icon":
    { color: "var(--success)" },
  ".cm-tooltip-autocomplete.nerve-composer-completions .cm-nerve-row-main": {
    display: "flex",
    alignItems: "baseline",
    gap: "0.3rem",
    flex: "1",
    minWidth: "0",
  },
  ".cm-tooltip-autocomplete.nerve-composer-completions .cm-nerve-row-dir": {
    flexShrink: "1",
    minWidth: "0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    direction: "rtl",
    textAlign: "left",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-xs)",
    color: "var(--muted-foreground)",
  },
  ".cm-tooltip-autocomplete.nerve-composer-completions .cm-nerve-row-name": {
    flexShrink: "0",
    whiteSpace: "nowrap",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-sm)",
    fontWeight: "500",
    color: "var(--popover-foreground)",
  },
  ".cm-tooltip-autocomplete.nerve-composer-completions .cm-nerve-match": {
    color: "var(--primary)",
    fontWeight: "600",
  },
  ".cm-tooltip.cm-completionInfo": {
    maxWidth: "min(30rem, calc(100vw - 2rem))",
    padding: "0.55rem 0.7rem",
    color: "var(--popover-foreground)",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-xs)",
  },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--primary)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
    {
      backgroundColor: "color-mix(in oklab, var(--primary) 22%, transparent)",
    },
});
