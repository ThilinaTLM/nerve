import type { ConfigurationResourceKind } from "@nervekit/contracts/configuration";
import Library from "@lucide/svelte/icons/library";
import Lightbulb from "@lucide/svelte/icons/lightbulb";
import Plug from "@lucide/svelte/icons/plug";
import Blocks from "@lucide/svelte/icons/blocks";
import Rocket from "@lucide/svelte/icons/rocket";
import Shield from "@lucide/svelte/icons/shield";
import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
import Users from "@lucide/svelte/icons/users";
import type { Component } from "svelte";

/** The identity icon of each reviewable kind, as on the settings pages. */
export const REVIEW_KIND_ICONS: Record<ConfigurationResourceKind, Component> = {
  "agent-preferences": SlidersHorizontal,
  "agent-profile": Users,
  "rule-set": Shield,
  "permission-overlay": Shield,
  "launch-catalog": Rocket,
  "mcp-servers": Plug,
  skill: Library,
  "prompt-suggestion": Lightbulb,
  extension: Blocks,
};
