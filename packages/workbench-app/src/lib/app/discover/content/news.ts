import type { DiscoverNewsEntry } from "./entries.js";

/**
 * Release announcements, newest release first. Every entry belongs to the app
 * version it shipped in; `content/news.test.ts` guards the invariants the
 * Discover layout depends on.
 */
export const discoverNewsCatalog: readonly DiscoverNewsEntry[] = [
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
