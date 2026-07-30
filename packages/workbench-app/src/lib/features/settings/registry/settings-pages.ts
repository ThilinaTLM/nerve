import Bell from "@lucide/svelte/icons/bell";
import Bot from "@lucide/svelte/icons/bot";
import HardDrive from "@lucide/svelte/icons/hard-drive";
import Keyboard from "@lucide/svelte/icons/keyboard";
import Library from "@lucide/svelte/icons/library";
import Lightbulb from "@lucide/svelte/icons/lightbulb";
import Monitor from "@lucide/svelte/icons/monitor";
import Server from "@lucide/svelte/icons/server";
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import Wrench from "@lucide/svelte/icons/wrench";
import type { SettingsPageDef } from "$lib/presentation/components/settings";

export const settingsPages: SettingsPageDef[] = [
  {
    id: "workbench",
    label: "Workbench",
    icon: Monitor,
    tabs: [
      { id: "appearance", label: "Appearance" },
      { id: "desktop", label: "Desktop" },
    ],
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: Bell,
    tabs: [
      { id: "general", label: "General" },
      { id: "sounds", label: "Sounds" },
    ],
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    icon: Keyboard,
    description:
      "Shortcuts are fixed and use the primary modifier for your platform.",
    tabs: [{ id: "shortcuts", label: "Shortcuts" }],
  },
  {
    id: "agents",
    label: "Agents",
    icon: Bot,
    tabs: [
      { id: "defaults", label: "Defaults" },
      { id: "compaction", label: "Compaction" },
      { id: "explore", label: "Explore agent" },
    ],
  },
  {
    id: "suggestions",
    label: "Suggestions",
    icon: Lightbulb,
    description:
      "Project suggestions override user and built-in suggestions with the same name.",
    tabs: [{ id: "suggestions", label: "Suggestions" }],
  },
  {
    id: "models",
    label: "Models",
    icon: ShieldCheck,
    description: "Scoped models limit which models the composer offers.",
    tabs: [{ id: "models", label: "Models" }],
  },
  {
    id: "tools",
    label: "Tools",
    icon: Wrench,
    tabs: [
      { id: "built-in", label: "Built-in" },
      { id: "integrations", label: "Integrations" },
    ],
  },
  {
    id: "skills",
    label: "Skills",
    icon: Library,
    description:
      "Skills apply to subsequent agent runs. Project definitions take precedence over global skills with the same name.",
    tabs: [{ id: "skills", label: "Skills" }],
  },
  {
    id: "storage",
    label: "Storage",
    icon: HardDrive,
    description:
      "Understand what Nerve keeps locally and safely reclaim space.",
    tabs: [{ id: "storage", label: "Storage" }],
  },
  {
    id: "system",
    label: "System",
    icon: Server,
    tabs: [
      { id: "server", label: "Server" },
      { id: "diagnostics", label: "Diagnostics" },
    ],
  },
];
