export type SetupGuideArea =
  | "open-project"
  | "provider"
  | "voice"
  | "scoped-models"
  | "agent-defaults";

export type SetupGuidePreparation = {
  kind: "settings";
  pageId: string;
  /** Detail item of a page with detail views. */
  itemId?: string;
  sectionId: string;
};

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
  "open-project": [
    {
      id: "open-project-switcher",
      title: "Open the project switcher",
      description:
        "Use the project control in the titlebar to open or switch projects.",
      targetId: "guide-project-open",
      fallback: "Choose the project icon in the titlebar.",
      advanceByClickingTarget: true,
    },
    {
      id: "open-project-browse",
      title: "Open a project folder",
      description:
        "Choose Open to find and open a project folder from your computer.",
      targetId: "guide-project-browse",
      fallback:
        "The project browser is already open when there are no recent projects.",
    },
  ],
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
        kind: "settings",
        pageId: "providers",
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
        kind: "settings",
        pageId: "providers",
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
        kind: "settings",
        pageId: "providers",
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
        kind: "settings",
        pageId: "providers",
        sectionId: "subscriptions",
      },
    },
  ],
  "scoped-models": [
    {
      id: "scoped-models-view",
      title: "Show all models",
      description:
        "Choose All to browse every authenticated model, not only the ones already in scope.",
      targetId: "setup-scoped-models-view",
      fallback: "Open Settings → Models and choose All above the model list.",
      preparation: {
        kind: "settings",
        pageId: "models",
        sectionId: "models",
      },
      advanceByClickingTarget: true,
    },
    {
      id: "scoped-models-catalog",
      title: "Search and check models",
      description:
        "Search by model, provider, or capability, and check the models you want in scope (a provider's checkbox adds all of its shown models). Changes save immediately; leaving everything unchecked keeps all models available.",
      targetId: "setup-scoped-models-catalog",
      fallback:
        "In Settings → Models, check the models the composer should offer.",
      preparation: {
        kind: "settings",
        pageId: "models",
        sectionId: "models",
      },
    },
    {
      id: "scoped-models-default",
      title: "Star the default",
      description:
        "Star a scoped model to make it the default for new agents and pick its reasoning level.",
      targetId: "setup-scoped-models-default",
      fallback:
        "In Settings → Models, use the star on a scoped model to make it the default.",
      preparation: {
        kind: "settings",
        pageId: "models",
        sectionId: "models",
      },
    },
  ],
  "agent-defaults": [
    {
      id: "agent-default-permission",
      title: "Choose default permissions",
      description: "Set the approval level new agents use by default.",
      targetId: "setup-agent-default-permission",
      fallback:
        "Open Settings → General and choose a default under Model and permissions.",
      preparation: {
        kind: "settings",
        pageId: "general",
        sectionId: "model",
      },
    },
    {
      id: "agent-profiles",
      title: "Review agent profiles",
      description:
        "Choose the model, permissions and instructions the Coding, Planning, Explore and Developer profiles use.",
      targetId: "setup-agent-profiles",
      fallback: "Open Settings → Agents and edit a built-in profile.",
      preparation: {
        kind: "settings",
        pageId: "agents",
        sectionId: "agents",
      },
    },
  ],
};
