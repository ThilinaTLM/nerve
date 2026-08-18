import Bell from "@lucide/svelte/icons/bell";
import Bot from "@lucide/svelte/icons/bot";
import HardDrive from "@lucide/svelte/icons/hard-drive";
import Keyboard from "@lucide/svelte/icons/keyboard";
import Library from "@lucide/svelte/icons/library";
import Lightbulb from "@lucide/svelte/icons/lightbulb";
import Monitor from "@lucide/svelte/icons/monitor";
import Mic from "@lucide/svelte/icons/mic";
import Server from "@lucide/svelte/icons/server";
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import Wrench from "@lucide/svelte/icons/wrench";
import type { SettingsPageDef } from "$lib/presentation/components/settings";

export const settingsPages: SettingsPageDef[] = [
  {
    id: "workbench",
    label: "Workbench",
    icon: Monitor,
    sections: [
      { id: "appearance", label: "Appearance" },
      { id: "desktop", label: "Desktop" },
    ],
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: Bell,
    sections: [
      { id: "general", label: "General" },
      { id: "sounds", label: "Sounds" },
    ],
  },
  {
    id: "transcription",
    label: "Transcription",
    icon: Mic,
    description:
      "Configure the OpenAI model and context hints used for voice input.",
    sections: [
      { id: "model", label: "Model" },
      { id: "context", label: "Context" },
    ],
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    icon: Keyboard,
    description:
      "Shortcuts are fixed and use the primary modifier for your platform.",
    sections: [{ id: "shortcuts", label: "Shortcuts" }],
  },
  {
    id: "models",
    label: "Scoped Models",
    icon: ShieldCheck,
    description: "Scoped models limit which models the composer offers.",
    sections: [{ id: "models", label: "Scoped Models" }],
  },
  {
    id: "agents",
    label: "Agents",
    icon: Bot,
    sections: [
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
    sections: [{ id: "suggestions", label: "Suggestions" }],
  },
  {
    id: "tools",
    label: "Tools",
    icon: Wrench,
    sections: [
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
    sections: [{ id: "skills", label: "Skills" }],
  },
  {
    id: "storage",
    label: "Storage",
    icon: HardDrive,
    description:
      "Understand what Nerve keeps locally and safely reclaim space.",
    sections: [{ id: "storage", label: "Storage" }],
  },
  {
    id: "system",
    label: "System",
    icon: Server,
    sections: [
      { id: "network", label: "Network" },
      { id: "diagnostics", label: "Diagnostics" },
      { id: "daemon", label: "Daemon" },
      { id: "desktop-rendering", label: "Desktop rendering" },
      { id: "launch-context", label: "Launch context" },
      { id: "system-information", label: "System information" },
    ],
  },
];
