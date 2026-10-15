import type { DiscoverNewsEntry } from "./entries.js";

/**
 * Release announcements, newest release first. Every entry belongs to the app
 * version it shipped in, or `next` for unreleased changes. `policy.test.ts`
 * guards the invariants the Discover layout depends on.
 */
export const discoverNewsCatalog: readonly DiscoverNewsEntry[] = [
  {
    id: "unified-async-work",
    version: 1,
    releasedIn: "next",
    featured: true,
    artwork: "workbench",
    title: "Keep delegated work in view",
    summary:
      "Profile-based sub-agents and background commands share a transcript activity island.",
    details: [
      "In Settings → Sub-agents → Delegation, turn on Let the lead delegate, or enable Sub-agents in Capabilities beside the composer for this conversation. Profiles configure instructions, model, thinking, permissions, tools, and skills for new teammates.",
      "The lead assigns work asynchronously with subagent_prompt. Reusing a teammate's name queues a follow-up in its existing context; completion notices wake the lead without polling.",
      "Teammates share the project worktree, not the lead's conversation. Give each assignment relevant paths, findings, and constraints, and separate editing scopes to avoid conflicts.",
      "Open Agents in the transcript activity island to inspect teammate conversations, or Commands to open background command output. Back to lead returns from a teammate; Jump to latest returns to the newest transcript content.",
      "Use launch for saved dev-server commands and bash for ad hoc commands. Background bash runs notify the agent on exit; async_bash can list runs, read logs, or stop them.",
    ],
    action: {
      kind: "settings",
      pageId: "subagents",
      sectionId: "profiles",
      label: "Configure Sub-agents",
    },
  },
  {
    id: "launch-configurations",
    version: 1,
    releasedIn: "next",
    title: "Launch configs replace task definitions",
    summary:
      "Save project commands in Launches, then start, restart, stop, or inspect their output.",
    action: {
      kind: "guide",
      guideId: "workbench",
      label: "Tour the Workbench",
    },
  },
  {
    id: "background-bash",
    version: 1,
    releasedIn: "next",
    title: "Let shell work continue in the background",
    summary:
      "Run bash in the background immediately, or use configurable auto-backgrounding (120s by default).",
  },
  {
    id: "transcript-activity-island",
    version: 1,
    releasedIn: "next",
    title: "One place for conversation activity",
    summary:
      "Open Agents or Commands beside the composer to inspect teammates and background command output.",
  },
  {
    id: "async-subagents",
    version: 2,
    releasedIn: "0.32.0",
    featured: true,
    artwork: "workbench",
    title: "Delegate coding work to persistent teammates",
    summary:
      "Async Subagents let the lead assign autonomous implementation work while it continues with its own tasks.",
    details: [
      "Async delegation was introduced in 0.32.0. This overview reflects the current controls; see Keep delegated work in view for the profile-based workflow.",
      "Enable Let the lead delegate under Settings → Sub-agents → Delegation, or use Capabilities → Sub-agents beside the composer for this conversation.",
      "Named teammates share the project worktree and retain their own context for follow-up assignments. Open Agents in the transcript activity island to inspect their conversations.",
      "Teammates cannot see the lead's conversation, so assignments should include relevant findings, paths, and constraints. Completion notices report back to the lead without repeated status checks.",
    ],
    action: {
      kind: "settings",
      pageId: "subagents",
      sectionId: "profiles",
      label: "Configure Sub-agents",
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
      "Type @launch: to find a background launch and insert its launch ID, or @pr: to find a pull request and insert its GitHub URL.",
      "Right-click in the editor for Undo, Redo, Cut, Copy, Paste, and Select all.",
      "Use Shift+Tab for Coding or Planning, Alt+M for models, and Alt+T for reasoning levels. Ctrl or Cmd+N now works while typing.",
      "Open Capabilities beside the composer to quickly enable or disable capabilities for this conversation. Changes apply to the next run.",
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
      "A short walkthrough of conversations, composer controls, panels, Git, and launches.",
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
