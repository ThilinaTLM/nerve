import type { DiscoverNewsEntry } from "./entries.js";

/**
 * Release announcements, newest release first. Every entry belongs to the app
 * version it shipped in, or `next` for unreleased changes. `policy.test.ts`
 * guards the invariants the Discover layout depends on.
 */
export const discoverNewsCatalog: readonly DiscoverNewsEntry[] = [
  {
    id: "multi-repo-git",
    version: 1,
    releasedIn: "next",
    featured: true,
    artwork: "git-actions",
    title: "Every repository and worktree, in one Git panel",
    summary:
      "Browse a project's repositories and worktrees, spot what changed, and act on the selected branch.",
    details: [
      "The Git panel lists the project's repositories and worktrees as a tree. Show All, Changed, or Attention, or filter by repository or branch name.",
      "Pick a repository to see its Selected branch and Changes sections, with branch actions that know which worktree has the branch checked out.",
      "The Pull requests tab now has search, so you can find a pull request without scrolling.",
    ],
    action: {
      kind: "guide",
      guideId: "workbench",
      label: "Tour the Workbench",
    },
  },
  {
    id: "fork-conversation",
    version: 1,
    releasedIn: "next",
    title: "Fork a conversation from an earlier point",
    summary:
      "In History, choose Fork here to start a new conversation from any message. The original stays as is.",
  },
  {
    id: "files-panel-overhaul",
    version: 1,
    releasedIn: "next",
    title: "A faster, more capable Files panel",
    summary:
      "Edit files in place, jump to any file with Quick open, and search text across the project.",
  },
  {
    id: "device-pairing",
    version: 1,
    releasedIn: "next",
    title: "Pair your phone and sign in with a passkey",
    summary:
      "Pair a device with a QR code, then sign in with a passkey. Manage devices and sign-ins in Settings.",
    action: {
      kind: "settings",
      pageId: "devices",
      sectionId: "devices",
      label: "Manage devices",
    },
  },
  {
    id: "indigo-theme",
    version: 1,
    releasedIn: "0.39.1",
    artwork: "themes",
    title: "New dark theme: Indigo",
    summary:
      "A deep purple dark theme joins Nerve, Melange, and Graphite in the Theme picker.",
    action: {
      kind: "settings",
      pageId: "workbench",
      sectionId: "appearance",
      label: "Choose a theme",
    },
  },
  {
    id: "repo-aware-suggestions",
    version: 1,
    releasedIn: "0.39.0",
    featured: true,
    artwork: "suggestions",
    title: "The next step, one click away",
    summary:
      "Suggestions above the composer follow your Git and PR state: commit, open a PR, push, or fix failing checks.",
    details: [
      "Built-in Git and GitHub suggestions appear only when they apply, such as Commit changes, Create a PR, Update PR, Pull upstream, and Fix failing checks.",
      "Each one sends a plain prompt that ends with the last known repository state, so the agent starts from facts instead of guesses.",
      "Click to send, or to queue while the agent is busy. Right-click to edit the prompt in the composer first.",
      "Review my changes, Clean up merged branch, and Continue are opt-in. Turn them on in Settings, or add your own suggestions.",
    ],
    action: {
      kind: "settings",
      pageId: "suggestions",
      sectionId: "suggestions",
      label: "Manage suggestions",
    },
  },
  {
    id: "engineering-docs-skill",
    version: 1,
    releasedIn: "0.39.0",
    artwork: "engineering-docs",
    title: "Built-in skill: engineering docs",
    summary:
      "Let agents write architecture docs and proposals, record decisions, and check your docs for drift.",
    action: {
      kind: "settings",
      pageId: "skills",
      sectionId: "skills",
      label: "Turn on in Skills",
    },
  },
  {
    id: "native-phone-shell",
    version: 1,
    releasedIn: "0.39.0",
    artwork: "mobile",
    title: "Nerve feels at home on your phone",
    summary:
      "A conversation hub with Chat, Changes, Files, and PR, plus swipe actions and a docked composer.",
  },
  {
    id: "windows-macos-fixes",
    version: 1,
    releasedIn: "0.38.1",
    title: "Steadier on Windows and macOS",
    summary:
      "Windows upgrades no longer fail on locked files, and the macOS app picks up your login shell PATH.",
  },
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
    id: "smart-repo-actions",
    version: 1,
    releasedIn: "0.38.0",
    artwork: "git-actions",
    title: "Repository rows that know the next step",
    summary:
      "Publish a new branch, pull, push, or sync, switch back to base, or open stashes right from the repo row.",
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
      "Git and Pull requests share one repository list, with the current branch's PR beside your changes.",
      "The header bell gathers Activity: what needs you first, then running and finished work.",
      "One composer toolbar holds attachments, profile, model, permissions, and voice.",
    ],
    action: {
      kind: "guide",
      guideId: "workbench",
      label: "Tour the Workbench",
    },
  },
];
