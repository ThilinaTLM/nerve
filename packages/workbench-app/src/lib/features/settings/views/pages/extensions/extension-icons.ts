import Blocks from "@lucide/svelte/icons/blocks";
import Globe from "@lucide/svelte/icons/globe";
import Layers from "@lucide/svelte/icons/layers";
import Workflow from "@lucide/svelte/icons/workflow";
import type { Component } from "svelte";

type Icon = Component<{ class?: string; "aria-hidden"?: "true" }>;

const icons: Record<string, Icon> = {
  layers: Layers,
  globe: Globe,
  workflow: Workflow,
};

/** The lucide icon an extension manifest names; unknown names get a generic one. */
export function extensionIcon(name: string): Icon {
  return icons[name] ?? Blocks;
}
