import Blocks from "@lucide/svelte/icons/blocks";
import Bot from "@lucide/svelte/icons/bot";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import KeyRound from "@lucide/svelte/icons/key-round";
import Mic from "@lucide/svelte/icons/mic";
import PanelsTopLeft from "@lucide/svelte/icons/panels-top-left";
import Search from "@lucide/svelte/icons/search";
import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
import type { Component } from "svelte";
import type { GuideId } from "../guides/catalog.js";

export const guideIcons: Record<GuideId, Component> = {
  atlassian: Blocks,
  "open-project": FolderOpen,
  provider: KeyRound,
  voice: Mic,
  "scoped-models": SlidersHorizontal,
  "agent-defaults": Bot,
  "web-search": Search,
  workbench: PanelsTopLeft,
};
