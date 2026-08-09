import type { SetupGuideArea } from "./setup-guide-content.js";

export type GuideId =
  | "open-project"
  | "provider"
  | "voice"
  | "scoped-models"
  | "agent-defaults"
  | "workbench";

export type GuidePriority = "must-do" | "highly-recommended" | "optional";
export type GuideLifecycle = "available" | "new" | "upcoming";
export type GuideCompletionSignal =
  | "project-open"
  | "provider-ready"
  | "voice-ready";

export type GuideRun =
  | { kind: "open-project" }
  | { kind: "setup-coach"; area: SetupGuideArea }
  | { kind: "workbench-tour" };

export type GuideDefinition = {
  id: GuideId;
  version: number;
  title: string;
  description: string;
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
    priority: "must-do",
    lifecycle: "available",
    actionLabel: "Open project",
    run: { kind: "open-project" },
    completionSignal: "project-open",
  },
  {
    id: "provider",
    version: 1,
    title: "Connect a model provider",
    description:
      "Authenticate a subscription, API key, or compatible custom provider before prompting an agent.",
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
    priority: "highly-recommended",
    lifecycle: "available",
    actionLabel: "Start guide",
    run: { kind: "setup-coach", area: "agent-defaults" },
  },
  {
    id: "workbench",
    version: 1,
    title: "Work through the Workbench",
    description:
      "Tour conversations, composer controls, panels, Git workflows, tasks, providers, settings, and Help.",
    priority: "highly-recommended",
    lifecycle: "available",
    actionLabel: "Start tour",
    run: { kind: "workbench-tour" },
  },
];
