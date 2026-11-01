import type { Component } from "svelte";

export type GalleryGroup = "Foundations" | "Shared" | "Workbench";

export interface GallerySectionEntry {
  id: string;
  title: string;
  group: GalleryGroup;
  /** One line describing what the page covers. */
  summary: string;
  load: () => Promise<{ default: Component }>;
}

export const GALLERY_GROUPS: readonly GalleryGroup[] = [
  "Foundations",
  "Shared",
  "Workbench",
];

/**
 * The gallery mirrors the real desktop workbench: one page per IDE area,
 * showing only the components and variants the app actually renders. The
 * Primitives page is the exception: it is a reference for every ui-kit
 * primitive with its full variant × size matrix. Sections are lazy so heavy
 * renderers only load when opened.
 */
export const GALLERY_SECTIONS: readonly GallerySectionEntry[] = [
  {
    id: "tokens",
    title: "Colors & surfaces",
    group: "Foundations",
    summary:
      "Surface ladder, status tones, and the radius and elevation values in use.",
    load: () => import("./sections/TokensSection.svelte"),
  },
  {
    id: "primitives",
    title: "Primitives",
    group: "Foundations",
    summary:
      "Every ui-kit primitive with its variants, sizes, and prop-driven states (reference; not limited to variants in use).",
    load: () => import("./sections/PrimitivesSection.svelte"),
  },
  {
    id: "typography",
    title: "Typography & icons",
    group: "Foundations",
    summary: "The type sizes, weights, and icon sizes the workbench uses.",
    load: () => import("./sections/TypographySection.svelte"),
  },
  {
    id: "controls",
    title: "Controls",
    group: "Shared",
    summary:
      "Buttons, badges, fields, toggles, switches, and status indicators — only the variants in use.",
    load: () => import("./sections/ControlsSection.svelte"),
  },
  {
    id: "composites",
    title: "Composites",
    group: "Shared",
    summary:
      "ScrollRegion, VirtualScroller, FloatingToolbar, StreamingText, HeightFollow, SelectRow, GithubMark, and the Markdown, Mermaid and plain-text renderers.",
    load: () => import("./sections/CompositesSection.svelte"),
  },
  {
    id: "overlays",
    title: "Dialogs, popovers & menus",
    group: "Shared",
    summary:
      "DialogShell, ConfirmDialog, PopoverPanel, ContextMenuList, DropdownMenu, and Tooltip as the app uses them.",
    load: () => import("./sections/OverlaysSection.svelte"),
  },
  {
    id: "shell",
    title: "Shell chrome",
    group: "Workbench",
    summary:
      "Titlebar, dock and editor tab strips, status bar and its popovers.",
    load: () => import("./sections/ShellSection.svelte"),
  },
  {
    id: "panels",
    title: "Side panels",
    group: "Workbench",
    summary:
      "Panel kit plus the real panels: conversations, files, git, launches, notes.",
    load: () => import("./sections/PanelsSection.svelte"),
  },
  {
    id: "conversation",
    title: "Conversation",
    group: "Workbench",
    summary:
      "Transcript rows: user prompts, assistant markdown, thinking, command blocks, notices, activity.",
    load: () => import("./sections/ConversationSection.svelte"),
  },
  {
    id: "tool-cards",
    title: "Tool calls",
    group: "Workbench",
    summary:
      "Card anatomy and the tool cards that appear in real transcripts, in their key states.",
    load: () => import("./sections/ToolCardsSection.svelte"),
  },
  {
    id: "composer",
    title: "Composer",
    group: "Workbench",
    summary:
      "Composer frame, toolbar chips, model and capabilities pickers, context and todo chips.",
    load: () => import("./sections/ComposerSection.svelte"),
  },
  {
    id: "editors",
    title: "Editors & viewers",
    group: "Workbench",
    summary:
      "CodeMirror viewer/editor, find panel, file pane (code and markdown), diff, and Mermaid.",
    load: () => import("./sections/EditorsSection.svelte"),
  },
  {
    id: "logs",
    title: "Logs",
    group: "Workbench",
    summary: "Logs pane, log rows per level, and the floating toolbar.",
    load: () => import("./sections/LogsSection.svelte"),
  },
  {
    id: "settings",
    title: "Settings",
    group: "Workbench",
    summary:
      "Settings shell and sidebar, sections, rows, lists, inline messages, and a composed page.",
    load: () => import("./sections/SettingsSection.svelte"),
  },
];
