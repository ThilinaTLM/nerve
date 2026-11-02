import type { DiscoverNewsEntry } from "./entries.js";

/**
 * Release announcements, newest release first. Every entry belongs to the app
 * version it shipped in, or `next` for unreleased changes. `policy.test.ts`
 * guards the invariants the Discover layout depends on.
 */
export const discoverNewsCatalog: readonly DiscoverNewsEntry[] = [
  {
    id: "live-pull-requests",
    version: 1,
    releasedIn: "0.38.0",
    featured: true,
    artwork: "pull-requests",
    title: "Pull requests that stay live",
    summary:
      "Checks, reviews, and merge state update on their own, with linked conversations in the details pane.",
    details: [
      "Open a pull request to see a header that shows its merge state, plus activity, commits grouped by day, live checks, and unified file diffs.",
      "Linked conversations list the work in Nerve that mentions the pull request, so you can jump back to the discussion behind a change.",
      "Nerve refreshes pull requests after pushes, merges, and when an agent opens one. Filter the list by All, Mine, or To review.",
    ],
    action: {
      kind: "guide",
      guideId: "workbench",
      label: "Tour the Workbench",
    },
  },
  {
    id: "away-notifications",
    version: 1,
    releasedIn: "0.38.0",
    artwork: "notifications",
    title: "Notifications that know when you're away",
    summary:
      "Nothing interrupts a conversation you're watching. Toasts and system pop-ups wait until you're elsewhere.",
    action: {
      kind: "settings",
      pageId: "notifications",
      sectionId: "general",
      label: "Notification settings",
    },
  },
  {
    id: "folder-browser",
    version: 1,
    releasedIn: "0.38.0",
    artwork: "projects",
    title: "Open any folder, or just drop it in",
    summary:
      "Browse to a project with the new folder browser, or drag a folder onto the title bar to open it.",
  },
  {
    id: "quote-selection",
    version: 1,
    releasedIn: "0.38.0",
    artwork: "quote",
    title: "Quote exactly what you need",
    summary:
      "Select text in a reply, then Quote it into the composer. Lists, code, and tables keep their formatting.",
  },
  {
    id: "new-themes",
    version: 1,
    releasedIn: "0.38.0",
    artwork: "themes",
    title: "New themes: Graphite and Melange",
    summary:
      "Pick Nerve, Melange, or Graphite in one Theme picker. Each browser or window remembers its own.",
    action: {
      kind: "settings",
      pageId: "workbench",
      sectionId: "appearance",
      label: "Choose a theme",
    },
  },
  {
    id: "profiles-replace-modes",
    version: 1,
    releasedIn: "0.38.0",
    artwork: "profiles",
    title: "Agent profiles replace modes",
    summary:
      "Pick Coding, Planning, or your own profile, each with its own instructions, model, and permissions.",
    action: {
      kind: "settings",
      pageId: "agents",
      sectionId: "agents",
      label: "Manage profiles",
    },
  },
  {
    id: "connected-workbench",
    version: 1,
    releasedIn: "0.37.0",
    featured: true,
    artwork: "workbench",
    title: "From prompt to pull request, without losing your place",
    summary:
      "Refreshed Git and PR panels, header Activity, clearer questions, and steadier tool updates.",
    details: [
      "Git and Pull requests share a repository list with branch and status context. Sync from a repository row, see the current branch's PR beside your changes, and filter PRs by All, Mine, or To review.",
      "Open the bell in the header for Activity: items needing you come first, followed by running and finished work. Background Git operations report progress and failures there while you keep working.",
      "The prompt composer brings attachments, profile, model, permissions, capabilities, context, and voice into one toolbar. Grouped suggestions insert references as chips, and dictation appears at the caret.",
      "Agent questions (ask_user) can collect several answers in one card. Choose an option or add detail with completions, images, and voice; drafts survive reloads and submitted answers stay visible.",
      "Tool cards keep stable sections and progress chips from streaming arguments through completion. Reserved result slots and in-place updates reduce layout jumps as output arrives.",
      "Under the hood, Rust-native completion indexing joins native Git reads, file watching, and managed processes. Startup and storage accounting have also been streamlined; Git mutations still use the Git CLI.",
    ],
    action: {
      kind: "guide",
      guideId: "workbench",
      label: "Tour the Workbench",
    },
  },
];
