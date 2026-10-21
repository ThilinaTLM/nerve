export type TourStepId =
  | "conversations"
  | "panel-new-conversation"
  | "tab-new-conversation"
  | "composer"
  | "permission"
  | "profile"
  | "context"
  | "capabilities"
  | "activity"
  | "model"
  | "send"
  | "history"
  | "git"
  | "pull-requests"
  | "launches"
  | "files"
  | "scratch-notes"
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
      "The tour has opened a conversation. Type a prompt here, drop files into the composer, or paste images to begin.",
    targetId: "composer",
  },
  {
    id: "permission",
    introducedIn: 1,
    title: "Choose a permission rule set",
    description:
      "Permission controls whether the agent can only read, asks before tool calls, or works autonomously. You can change it before sending a prompt.",
    targetId: "composer-permission",
  },
  {
    id: "profile",
    introducedIn: 2,
    title: "Choose an agent profile",
    description:
      "You choose the profile here, or with Shift+Tab or /profile; the agent cannot switch profiles. Coding implements changes. Planning inspects the project and presents a written plan for your review, then approval returns to the default profile.",
    targetId: "composer-profile",
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
    id: "capabilities",
    introducedIn: 2,
    title: "Choose capabilities and sub-agents",
    description:
      "Capabilities beside the composer controls optional tools for this conversation; changes apply to the next run. Enable Sub-agents to delegate asynchronous work using profiles configured in Settings → Sub-agents. Teammates share your worktree but cannot see the lead's conversation, so include context and clear editing boundaries in assignments.",
    targetId: "composer-capabilities",
    fallback:
      "Open a conversation to find Capabilities beside the composer, or configure profiles in Settings → Sub-agents.",
  },
  {
    id: "activity",
    introducedIn: 2,
    title: "Follow agents and background commands",
    description:
      "When there is activity, the transcript activity island beside the composer offers Agents and Commands. Open a teammate's transcript or a background command's output, use Back to lead to return, or Jump to latest to catch up. Bash can run in the background and reports its exit automatically; async_bash lets the agent read logs or stop a command.",
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
    id: "launches",
    introducedIn: 2,
    title: "Run saved project commands",
    description:
      "Launch configs replace task definitions for reusable project commands such as dev servers. Create a config in Launches with a command, optional working directory and port, and a single or concurrent run policy. Start, restart, stop, and inspect output here. The agent's launch tool runs existing configs but cannot create or edit them.",
    targetId: "launches-panel",
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
      "Settings is the central place for workbench preferences, scoped models, conversation defaults, tools, skills, storage, and system options.",
    targetId: "settings",
  },
  {
    id: "status",
    introducedIn: 1,
    title: "Usage and live status",
    description:
      "The status bar tracks subscription usage, background launches, pending approvals, Git state, connection health, layout controls, and zoom.",
    targetId: "status-controls",
  },
  {
    id: "help",
    introducedIn: 1,
    title: "Return to Nerve guides",
    description:
      "Use Help in the titlebar whenever you want to reopen the Guides catalog or replay a completed guide.",
    targetId: "help",
  },
  {
    id: "finish",
    introducedIn: 1,
    title: "You are ready to explore",
    description:
      "Your project and Workbench are ready. Return to Nerve guides whenever you want a refresher or new guidance appears.",
  },
] as const;

export function guideItemsForRun<T extends VersionedGuideItem>(
  items: readonly T[],
  completedVersion: number,
  manual: boolean,
): T[] {
  return items.filter((item) => manual || item.introducedIn > completedVersion);
}
