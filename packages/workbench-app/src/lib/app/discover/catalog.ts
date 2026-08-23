import type { GuideId } from "./guides/catalog.js";

export type DiscoverEditorialId =
  | "conversation-inbox"
  | "discover-home"
  | "workbench-tour"
  | "focused-model-list"
  | "tool-selection";
export type DiscoverEditorialKind = "highlight" | "tip";
export type DiscoverNewsArtwork = "conversations" | "discover" | "workbench";

export type DiscoverEditorialAction =
  | { kind: "guide"; guideId: GuideId; label: string }
  | {
      kind: "settings";
      pageId: string;
      sectionId: string;
      label: string;
    };

type DiscoverEditorialBase = {
  id: DiscoverEditorialId;
  version: number;
  title: string;
  description: string;
  releaseLabel?: string;
  featured?: boolean;
  new?: boolean;
  action?: DiscoverEditorialAction;
};

export type DiscoverEditorialDefinition = DiscoverEditorialBase &
  (
    | { kind: "highlight"; artwork: DiscoverNewsArtwork }
    | { kind: "tip"; artwork?: never }
  );

export const discoverEditorialCatalog: readonly DiscoverEditorialDefinition[] =
  [
    {
      id: "conversation-inbox",
      version: 1,
      kind: "highlight",
      artwork: "conversations",
      title: "Turn conversations into a focused inbox",
      description:
        "Pinned, Today, and Yesterday groups keep active work organized. Mark finished conversations complete, then use the new settings menu to tune or clean up your list.",
      releaseLabel: "Conversation inbox",
      featured: true,
      new: true,
    },
    {
      id: "discover-home",
      version: 1,
      kind: "highlight",
      artwork: "discover",
      title: "A new home for learning Nerve",
      description:
        "Discover brings essential setup, guided walkthroughs, release highlights, and useful tips into one place you can revisit anytime.",
      releaseLabel: "New in Nerve",
      featured: true,
      new: true,
    },
    {
      id: "workbench-tour",
      version: 1,
      kind: "highlight",
      artwork: "workbench",
      title: "Explore the Workbench with a guided tour",
      description:
        "Take a quick tour of conversations, composer controls, panels, Git workflows, tasks, providers, and settings.",
      releaseLabel: "Guided tour",
      new: true,
      action: {
        kind: "guide",
        guideId: "workbench",
        label: "Start tour",
      },
    },
    {
      id: "focused-model-list",
      version: 1,
      kind: "tip",
      title: "Keep model selection focused",
      description:
        "Scoped models let you choose which authenticated models appear in the composer, making everyday selection faster.",
      action: {
        kind: "guide",
        guideId: "scoped-models",
        label: "Configure models",
      },
    },
    {
      id: "tool-selection",
      version: 1,
      kind: "tip",
      title: "Enable only the tools you need",
      description:
        "Every enabled tool adds its definition to the model context. Keeping unused tools disabled can reduce token overhead; enable extra capabilities when you need them.",
      action: {
        kind: "settings",
        pageId: "tools",
        sectionId: "third-party",
        label: "Review third-party tools",
      },
    },
  ];
