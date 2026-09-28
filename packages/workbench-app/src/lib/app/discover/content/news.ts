import type { DiscoverNewsEntry } from "./entries.js";

/**
 * Release announcements, newest release first. Every entry belongs to the app
 * version it shipped in; `content/news.test.ts` guards the invariants the
 * Discover layout depends on.
 */
export const discoverNewsCatalog: readonly DiscoverNewsEntry[] = [
  {
    id: "async-subagents",
    version: 1,
    releasedIn: "next",
    featured: true,
    artwork: "workbench",
    title: "Delegate coding work to persistent teammates",
    summary:
      "Async Subagents let the lead assign autonomous implementation work while it continues with its own tasks.",
    details: [
      "Enable Async Subagents in Settings → Tools → Core, or for the current conversation from Tools and skills beside the composer.",
      "Named teammates share the project worktree, retain their own context for follow-up assignments, and appear in the Context panel.",
      "Teammates do not automatically receive the lead transcript, so assignments should include relevant findings, paths, and constraints.",
      "Up to four teammate assignments can run at once. Completion is delivered durably and can wake the lead.",
    ],
    action: {
      kind: "settings",
      pageId: "tools",
      sectionId: "core",
      label: "Configure Async Subagents",
    },
  },
  {
    id: "composer-power-tools",
    version: 2,
    releasedIn: "0.31.0",
    featured: true,
    artwork: "workbench",
    title: "A faster, more connected prompt composer",
    summary:
      "Reference live work, use editing actions, and move through composer settings without leaving the keyboard.",
    details: [
      "Type @task: to find a background task and insert its task ID, or @pr: to find a pull request and insert its GitHub URL.",
      "Right-click in the editor for Undo, Redo, Cut, Copy, Paste, and Select all.",
      "Use Shift+Tab for Coding or Planning, Alt+M for models, and Alt+T for reasoning levels. Ctrl or Cmd+N now works while typing.",
      "Open Tools and skills beside the composer to quickly enable or disable capabilities for this conversation. Changes apply to the next run.",
      "Slash commands have distinct icons, and /new starts a fresh conversation.",
    ],
    action: {
      kind: "settings",
      pageId: "shortcuts",
      sectionId: "shortcuts",
      label: "View shortcuts",
    },
  },
  {
    id: "conversation-inbox",
    version: 1,
    releasedIn: "0.29.0",
    featured: true,
    artwork: "conversations",
    title: "Conversations work like a focused inbox",
    summary:
      "Pinned, Today, and Yesterday groups keep active work in front of you.",
    details: [
      "Mark a finished conversation complete to move it out of the active list.",
      "Use the conversations settings menu to tune grouping or clean up old threads.",
    ],
  },
  {
    id: "discover-home",
    version: 1,
    releasedIn: "0.29.0",
    artwork: "discover",
    title: "Discover collects setup, news, and tips",
    summary:
      "One place for what is new, what still needs configuring, and how to work faster.",
  },
  {
    id: "workbench-tour",
    version: 1,
    releasedIn: "0.29.0",
    artwork: "workbench",
    title: "Guided tour of the Workbench",
    summary:
      "A short walkthrough of conversations, composer controls, panels, Git, and tasks.",
    action: { kind: "guide", guideId: "workbench", label: "Start tour" },
  },
  {
    id: "github-pull-requests",
    version: 1,
    releasedIn: "0.29.0",
    title: "Pull requests moved into the Git panel",
    summary:
      "Review pull request status for the repositories in your project without leaving Nerve.",
  },
];
