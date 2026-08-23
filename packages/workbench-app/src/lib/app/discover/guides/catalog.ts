import type { SetupGuideArea } from "./setup-content.js";

export type GuideId =
  | "open-project"
  | "provider"
  | "voice"
  | "scoped-models"
  | "agent-defaults"
  | "web-search"
  | "workbench";

export type GuidePriority = "must-do" | "highly-recommended" | "optional";
export type GuideCategory = "setup" | "walkthrough";
export type GuideLifecycle = "available" | "new" | "upcoming";
export type GuideCompletionSignal =
  | "project-open"
  | "provider-ready"
  | "voice-ready"
  | "web-search-ready";

export type GuideRun =
  | { kind: "setup-coach"; area: SetupGuideArea }
  | { kind: "workbench-tour" };

export type GuideDefinition = {
  id: GuideId;
  version: number;
  title: string;
  description: string;
  category: GuideCategory;
  priority: GuidePriority;
  lifecycle: GuideLifecycle;
  actionLabel?: string;
  run?: GuideRun;
  completionSignal?: GuideCompletionSignal;
};

export const guideCatalog: readonly GuideDefinition[] = [
  {
    id: "open-project",
    version: 1,
    title: "Open a project",
    description:
      "Choose a project folder so Nerve can keep conversations, files, Git changes, and agent work together.",
    category: "setup",
    priority: "must-do",
    lifecycle: "available",
    actionLabel: "Start guide",
    run: { kind: "setup-coach", area: "open-project" },
    completionSignal: "project-open",
  },
  {
    id: "provider",
    version: 1,
    title: "Connect a model provider",
    description:
      "Authenticate a subscription, API key, or compatible custom provider before prompting an agent.",
    category: "setup",
    priority: "must-do",
    lifecycle: "available",
    actionLabel: "Start guide",
    run: { kind: "setup-coach", area: "provider" },
    completionSignal: "provider-ready",
  },
  {
    id: "voice",
    version: 1,
    title: "Enable voice input",
    description:
      "Connect an OpenAI Codex subscription to dictate prompts from the composer.",
    category: "setup",
    priority: "highly-recommended",
    lifecycle: "available",
    actionLabel: "Start guide",
    run: { kind: "setup-coach", area: "voice" },
    completionSignal: "voice-ready",
  },
  {
    id: "scoped-models",
    version: 1,
    title: "Configure scoped models",
    description:
      "Choose which authenticated models appear in the composer so model selection stays focused.",
    category: "setup",
    priority: "highly-recommended",
    lifecycle: "available",
    actionLabel: "Start guide",
    run: { kind: "setup-coach", area: "scoped-models" },
  },
  {
    id: "agent-defaults",
    version: 1,
    title: "Configure agent defaults",
    description:
      "Choose the mode, permissions, model, and thinking defaults used by new agents.",
    category: "setup",
    priority: "highly-recommended",
    lifecycle: "available",
    actionLabel: "Start guide",
    run: { kind: "setup-coach", area: "agent-defaults" },
  },
  {
    id: "web-search",
    version: 1,
    title: "Set up web search",
    description:
      "Add a Tavily API key to let agents use the web_search tool for current information.",
    category: "setup",
    priority: "optional",
    lifecycle: "available",
    actionLabel: "Start guide",
    run: { kind: "setup-coach", area: "web-search" },
    completionSignal: "web-search-ready",
  },
  {
    id: "workbench",
    version: 1,
    title: "Work through the Workbench",
    description:
      "Tour conversations, composer controls, panels, Git workflows, tasks, providers, settings, and Help.",
    category: "walkthrough",
    priority: "highly-recommended",
    lifecycle: "available",
    actionLabel: "Start tour",
    run: { kind: "workbench-tour" },
  },
];
