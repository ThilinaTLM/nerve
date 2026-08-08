export const CURRENT_ONBOARDING_VERSION = 1;
export const CURRENT_PRODUCT_TOUR_VERSION = 1;

export type TourStepId =
  | "conversations"
  | "panel-new-conversation"
  | "tab-new-conversation"
  | "composer"
  | "permission"
  | "mode"
  | "context"
  | "model"
  | "send"
  | "history"
  | "git"
  | "pull-requests"
  | "tasks"
  | "files"
  | "scratch-notes"
  | "context-panel"
  | "skills"
  | "providers"
  | "settings"
  | "status"
  | "help"
  | "finish";

export type VersionedGuideItem = { introducedIn: number };

export type TourStep = VersionedGuideItem & {
  id: TourStepId;
  title: string;
  description: string;
  targetId?: string;
  fallback?: string;
};

export const tourSteps: readonly TourStep[] = [
  {
    id: "conversations",
    introducedIn: 1,
    title: "Your project conversations",
    description:
      "The Conversations panel keeps every saved conversation for the active project together. Return here to reopen previous work or start something new.",
    targetId: "conversations-tab",
  },
  {
    id: "panel-new-conversation",
    introducedIn: 1,
    title: "Start from the Conversations panel",
    description:
      "Use New chat in the Conversations panel header to create a conversation in the active project.",
    targetId: "panel-new-conversation",
  },
  {
    id: "tab-new-conversation",
    introducedIn: 1,
    title: "Start from the editor tabs",
    description:
      "The plus action beside the center editor tabs creates the same new conversation without leaving your current workspace.",
    targetId: "tab-new-conversation",
  },
  {
    id: "composer",
    introducedIn: 1,
    title: "Write the first prompt",
    description:
      "The tour has opened a pending conversation. Type a prompt here, drop files into the composer, paste images, or use suggestions to begin.",
    targetId: "composer",
  },
  {
    id: "permission",
    introducedIn: 1,
    title: "Choose a permission level",
    description:
      "Permission controls whether the agent can only read, asks before tool calls, or works autonomously. You can change it before sending a prompt.",
    targetId: "composer-permission",
  },
  {
    id: "mode",
    introducedIn: 1,
    title: "Switch between coding and planning",
    description:
      "Coding mode implements changes. Planning mode inspects and prepares a reviewed approach before edits.",
    targetId: "composer-mode",
  },
  {
    id: "context",
    introducedIn: 1,
    title: "Watch context usage",
    description:
      "Open context details to inspect the active model window and compact a long conversation when needed.",
    targetId: "composer-context",
  },
  {
    id: "model",
    introducedIn: 1,
    title: "Pick the model and thinking level",
    description:
      "Choose an available scoped model and its thinking level for this conversation before the run starts.",
    targetId: "composer-model",
  },
  {
    id: "send",
    introducedIn: 1,
    title: "Send or dictate your prompt",
    description:
      "Use voice input to dictate when it is configured, then send the prompt to start the agent run.",
    targetId: "composer-send-actions",
  },
  {
    id: "history",
    introducedIn: 1,
    title: "Navigate and branch conversations",
    description:
      "Conversation History is a graph of messages and branches. Jump to an earlier point or edit from the middle without losing the original path.",
    targetId: "conversation-history",
  },
  {
    id: "git",
    introducedIn: 1,
    title: "Review Git changes",
    description:
      "Inspect the working tree, review file diffs, and use branch, fetch, and sync actions from the Git Changes panel.",
    targetId: "git-workflow",
    fallback: "Open a Git project to review local changes.",
  },
  {
    id: "pull-requests",
    introducedIn: 1,
    title: "Manage pull requests",
    description:
      "Open GitHub pull requests to inspect checks, commits, changed files, linked conversations, and merge readiness.",
    targetId: "pull-request-workflow",
    fallback: "Open a GitHub project to use pull request workflows.",
  },
  {
    id: "tasks",
    introducedIn: 1,
    title: "Track reusable tasks",
    description:
      "The Tasks panel organizes saved task definitions and their runs so you can launch, monitor, and revisit repeatable agent work.",
    targetId: "tasks-panel",
  },
  {
    id: "files",
    introducedIn: 1,
    title: "Browse project files",
    description:
      "Use the Files panel to navigate the active project tree, inspect Git status, and open files in the center workspace.",
    targetId: "files-panel",
  },
  {
    id: "scratch-notes",
    introducedIn: 1,
    title: "Keep scratch notes",
    description:
      "Scratch Notes keeps lightweight project notes close to the conversation without mixing them into agent history.",
    targetId: "scratch-notes-panel",
  },
  {
    id: "context-panel",
    introducedIn: 1,
    title: "Inspect conversation context",
    description:
      "The Context panel shows the files and other context attached to the active conversation so you can understand what the agent can use.",
    targetId: "context-panel",
  },
  {
    id: "skills",
    introducedIn: 1,
    title: "Suggestions, skills, and Agent Browser",
    description:
      "Skills extend agent workflows at global or project scope. Agent Browser skills enable guided browser interaction, while Suggestions customize reusable prompt actions.",
    targetId: "settings-skills",
  },
  {
    id: "providers",
    introducedIn: 1,
    title: "Manage model providers",
    description:
      "Open Providers and authentication from the titlebar to connect subscriptions, API keys, and custom model providers.",
    targetId: "providers",
  },
  {
    id: "settings",
    introducedIn: 1,
    title: "Customize Nerve",
    description:
      "Settings is the central place for workbench preferences, scoped models, agent defaults, suggestions, tools, skills, storage, and system options.",
    targetId: "settings",
  },
  {
    id: "status",
    introducedIn: 1,
    title: "Usage and live status",
    description:
      "The status bar tracks subscription usage, background tasks, pending approvals, Git state, connection health, layout controls, and zoom.",
    targetId: "status-controls",
  },
  {
    id: "help",
    introducedIn: 1,
    title: "Return to the product tour",
    description:
      "Use Help in the titlebar whenever you want to reopen setup guidance or replay the complete product tour.",
    targetId: "help",
  },
  {
    id: "finish",
    introducedIn: 1,
    title: "You are ready to explore",
    description:
      "Your project and workbench are ready. New guide steps can appear here as Nerve adds features.",
  },
] as const;

export function guideItemsForRun<T extends VersionedGuideItem>(
  items: readonly T[],
  completedVersion: number,
  manual: boolean,
): T[] {
  return items.filter((item) => manual || item.introducedIn > completedVersion);
}
