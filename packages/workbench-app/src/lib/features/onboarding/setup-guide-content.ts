export type SetupGuideArea =
  | "provider"
  | "voice"
  | "scoped-models"
  | "agent-defaults";

export type SetupGuidePreparation =
  | { kind: "auth"; pageId: string; sectionId: string }
  | { kind: "settings"; pageId: string; sectionId: string };

export type SetupGuideStep = {
  id: string;
  title: string;
  description: string;
  targetId: string;
  fallback: string;
  preparation?: SetupGuidePreparation;
  advanceByClickingTarget?: boolean;
};

export const setupGuideSteps: Record<
  SetupGuideArea,
  readonly SetupGuideStep[]
> = {
  provider: [
    {
      id: "provider-subscription",
      title: "Connect a subscription",
      description:
        "Use Connections to authenticate a supported subscription provider.",
      targetId: "setup-auth-connect-subscription",
      fallback:
        "Open Connections → Subscriptions and choose Connect subscription.",
      preparation: {
        kind: "auth",
        pageId: "connections",
        sectionId: "subscriptions",
      },
    },
    {
      id: "provider-api-key",
      title: "Add an API key",
      description:
        "API keys are another direct way to connect a model provider. Compatible local or self-hosted endpoints can instead be added from Custom providers.",
      targetId: "setup-auth-add-api-key",
      fallback:
        "Open Connections → API keys and choose Add API key. Custom providers remain available separately for compatible local or self-hosted endpoints.",
      preparation: {
        kind: "auth",
        pageId: "connections",
        sectionId: "api-keys",
      },
    },
  ],
  voice: [
    {
      id: "voice-connect",
      title: "Connect a subscription",
      description:
        "Voice input uses an OpenAI Codex/ChatGPT subscription connection.",
      targetId: "setup-auth-connect-subscription",
      fallback:
        "Open Connections → Subscriptions and choose Connect subscription.",
      preparation: {
        kind: "auth",
        pageId: "connections",
        sectionId: "subscriptions",
      },
      advanceByClickingTarget: true,
    },
    {
      id: "voice-codex-choice",
      title: "Choose OpenAI Codex",
      description:
        "Select OpenAI Codex and complete the ChatGPT subscription sign-in. The composer microphone becomes available after connection.",
      targetId: "setup-auth-openai-codex-choice",
      fallback:
        "In the provider dialog, select OpenAI Codex. If it is already connected, close the dialog to see the connected row.",
      preparation: {
        kind: "auth",
        pageId: "connections",
        sectionId: "subscriptions",
      },
    },
  ],
  "scoped-models": [
    {
      id: "scoped-models-add",
      title: "Choose Add models",
      description:
        "Open the scoped-model catalog to limit which authenticated models appear in the composer.",
      targetId: "setup-scoped-models-add",
      fallback: "Open Settings → Models and choose Add models.",
      preparation: { kind: "settings", pageId: "models", sectionId: "models" },
      advanceByClickingTarget: true,
    },
    {
      id: "scoped-models-catalog",
      title: "Search and select models",
      description:
        "Search, filter by provider, and check the models you want in scope.",
      targetId: "setup-scoped-models-catalog",
      fallback:
        "Click Add models first; the search, filters, and model catalog will appear in the dialog.",
      preparation: { kind: "settings", pageId: "models", sectionId: "models" },
    },
    {
      id: "scoped-models-save",
      title: "Save the selection",
      description:
        "Save your choices. Leaving every model unchecked is valid and keeps all authenticated models available.",
      targetId: "setup-scoped-models-save",
      fallback: "In the Add models dialog, choose Save selection when ready.",
      preparation: { kind: "settings", pageId: "models", sectionId: "models" },
    },
  ],
  "agent-defaults": [
    {
      id: "agent-default-mode",
      title: "Choose the default mode",
      description: "Set whether new agents begin in coding or planning mode.",
      targetId: "setup-agent-default-mode",
      fallback: "Open Settings → Agents → Defaults to choose a mode.",
      preparation: {
        kind: "settings",
        pageId: "agents",
        sectionId: "defaults",
      },
    },
    {
      id: "agent-default-permission",
      title: "Choose default permissions",
      description: "Set the approval level new agents use by default.",
      targetId: "setup-agent-default-permission",
      fallback:
        "Open Settings → Agents → Defaults to choose a permission level.",
      preparation: {
        kind: "settings",
        pageId: "agents",
        sectionId: "defaults",
      },
    },
    {
      id: "agent-explore-model",
      title: "Choose the Explore model",
      description:
        "Pick the model and thinking level used by Explore subagents.",
      targetId: "setup-agent-explore-model",
      fallback:
        "Open Settings → Agents → Explore agent and use the model picker.",
      preparation: {
        kind: "settings",
        pageId: "agents",
        sectionId: "explore-agent",
      },
    },
    {
      id: "agent-default-model",
      title: "Choose the main model",
      description:
        "Finish with the main agent model and its default thinking level—the settings you will use most often. Additional approval and compaction controls remain available nearby.",
      targetId: "setup-agent-default-model",
      fallback:
        "Open Settings → Agents → Defaults and use the main model picker.",
      preparation: {
        kind: "settings",
        pageId: "agents",
        sectionId: "defaults",
      },
    },
  ],
};
