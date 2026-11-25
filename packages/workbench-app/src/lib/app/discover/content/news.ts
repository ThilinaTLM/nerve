import type { DiscoverNewsEntry } from "./entries.js";

/**
 * Release announcements, newest release first. Every entry belongs to the app
 * version it shipped in, or `next` for unreleased changes. `policy.test.ts`
 * guards the invariants the Discover layout depends on.
 */
export const discoverNewsCatalog: readonly DiscoverNewsEntry[] = [
  {
    id: "forge-self-configuration",
    version: 1,
    releasedIn: "next",
    featured: true,
    artwork: "forge",
    title: "Tell Nerve what your project needs, and it builds it",
    summary:
      "Pick the Forge profile and describe what you want. It builds the extension, skill, or launch for you.",
    details: [
      "Forge writes and updates skills, extensions, launches, agent profiles, prompt suggestions, and permission rules, in your project or for you only.",
      "Extensions can add side panels, page tabs, file previews, themes, and quick script namespaces. For example, a panel that shows whether your QA and production environments are up.",
      "Extensions run sandboxed. Before one runs, Nerve shows what it asks for and waits for your consent. Sign-in and credentials stay with you.",
      "Nerve checks each change before applying it. If an edit is invalid, the previous version stays active, and the bell lists what needs your attention.",
    ],
    action: {
      kind: "settings",
      pageId: "extensions",
      sectionId: "builtin",
      label: "Open Extensions",
    },
  },
  {
    id: "mcp-servers",
    version: 1,
    releasedIn: "next",
    title: "Connect MCP servers",
    summary:
      "Add a server in Settings and agents reach its tools through quick script, so the prompt stays lean.",
    action: {
      kind: "settings",
      pageId: "mcp-servers",
      sectionId: "servers",
      label: "Add an MCP server",
    },
  },
  {
    id: "extension-accounts",
    version: 1,
    releasedIn: "next",
    title: "Accounts for your extensions",
    summary:
      "Sign in with OAuth or add an API key. Nerve encrypts credentials and refreshes them before they expire.",
    action: {
      kind: "settings",
      pageId: "accounts",
      sectionId: "accounts",
      label: "Open Accounts",
    },
  },
  {
    id: "tailscale-private-access",
    version: 1,
    releasedIn: "next",
    title: "Reach Nerve from anywhere through Tailscale",
    summary:
      "Turn on private access to serve Nerve on your tailnet only, with no certificate setup.",
    action: {
      kind: "settings",
      pageId: "remote",
      sectionId: "tailscale",
      label: "Set up private access",
    },
  },
  {
    id: "phone-push",
    version: 1,
    releasedIn: "next",
    artwork: "mobile",
    title: "A focused phone app with push notifications",
    summary:
      "Your phone gets a push when an agent needs input, fails, or finishes while you're away.",
  },
  {
    id: "unified-settings",
    version: 1,
    releasedIn: "next",
    title: "One Settings tab for you and your project",
    summary:
      "With a project open, pages show your settings and the project's side by side.",
  },
  {
    id: "trust-decisions",
    version: 1,
    releasedIn: "next",
    title: "Trust or decline project files",
    summary:
      "Decide on each item's page. A decline sticks, and the bell lists only what still needs review.",
  },
  {
    id: "profile-starters",
    version: 1,
    releasedIn: "next",
    artwork: "profiles",
    title: "Start a conversation from a profile",
    summary:
      "A new conversation offers Coding, Planning, Lead, and Forge. Pick the one that fits the task.",
  },
  {
    id: "launches-by-label",
    version: 1,
    releasedIn: "next",
    title: "Agents run your launches by name",
    summary:
      "Agents start, restart, and stop launches, and read their logs, using the labels in the Launches panel.",
  },
  {
    id: "todo-chip-removed",
    version: 1,
    releasedIn: "next",
    title: "The agent todo list is gone",
    summary:
      "Agents no longer keep a todo list, and the composer todo chip is removed.",
  },
  {
    id: "wake-recovery",
    version: 1,
    releasedIn: "next",
    title: "Recovers after your computer wakes",
    summary:
      "A desktop window that stalls after sleep now recovers by itself. Paths on Windows and macOS are steadier.",
  },
  {
    id: "quick-script-extensions",
    version: 1,
    releasedIn: "0.41.0",
    featured: true,
    artwork: "quick-script",
    title: "Agents can script Jira, Confluence, the web, and files in one step",
    summary:
      "Quick script runs a sandboxed script, and each call it makes is checked against your permissions.",
    details: [
      "Quick script combines Jira, Confluence, web fetch and search, files, diagrams, images, and Excel, Word, PowerPoint, CSV, and ZIP libraries in one sandboxed step.",
      "Each call the script makes is checked against your permission rules, and appears live in the tool card as it runs.",
      "Extensions add these capabilities. Open Settings → Extensions to set up accounts and turn each one on or off.",
      "The separate Jira and Confluence tools are gone. Quick script now handles both.",
    ],
    action: {
      kind: "settings",
      pageId: "extensions",
      sectionId: "builtin",
      label: "Open Extensions",
    },
  },
  {
    id: "read-only-external-reads",
    version: 1,
    releasedIn: "0.41.0",
    title: "Read-only now allows external reads",
    summary:
      "Web fetch and search, plus Jira and Confluence reads, work in Read-only. Writes are still denied.",
    action: {
      kind: "settings",
      pageId: "permission-rules",
      sectionId: "rule-sets",
      label: "Review permissions",
    },
  },
  {
    id: "rename-conversations",
    version: 1,
    releasedIn: "0.41.0",
    title: "Rename conversations",
    summary:
      "Choose Rename from a conversation's menu in the sidebar, an editor tab, or on mobile.",
  },
  {
    id: "copilot-usage",
    version: 1,
    releasedIn: "0.41.0",
    title: "GitHub Copilot usage in the usage chip",
    summary:
      "See your Copilot subscription quotas next to your other providers' limits.",
  },
  {
    id: "project-config-trust",
    version: 1,
    releasedIn: "0.41.0",
    title: "See when project agent settings aren't trusted",
    summary:
      "A warning with a one-click Trust action appears for an untrusted project agent.json.",
  },
  {
    id: "image-explanation-extension",
    version: 1,
    releasedIn: "0.41.0",
    title: "Image explanation is now an extension",
    summary:
      "Turn it on in Settings → Extensions to let the agent explain images. It is off by default.",
    action: {
      kind: "settings",
      pageId: "extensions",
      sectionId: "builtin",
      label: "Open Extensions",
    },
  },
  {
    id: "multi-repo-git",
    version: 1,
    releasedIn: "0.40.0",
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
    releasedIn: "0.40.0",
    title: "Fork a conversation from an earlier point",
    summary:
      "In History, choose Fork here to start a new conversation from any message. The original stays as is.",
  },
  {
    id: "files-panel-overhaul",
    version: 1,
    releasedIn: "0.40.0",
    title: "A faster, more capable Files panel",
    summary:
      "Edit files in place, jump to any file with Quick open, and search text across the project.",
  },
  {
    id: "device-pairing",
    version: 1,
    releasedIn: "0.40.0",
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
