import Bell from "@lucide/svelte/icons/bell";
import CloudCog from "@lucide/svelte/icons/cloud-cog";
import Bot from "@lucide/svelte/icons/bot";
import HardDrive from "@lucide/svelte/icons/hard-drive";
import Keyboard from "@lucide/svelte/icons/keyboard";
import Library from "@lucide/svelte/icons/library";
import Lightbulb from "@lucide/svelte/icons/lightbulb";
import Monitor from "@lucide/svelte/icons/monitor";
import Mic from "@lucide/svelte/icons/mic";
import Server from "@lucide/svelte/icons/server";
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import Shield from "@lucide/svelte/icons/shield";
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
    id: "providers",
    label: "Providers",
    icon: CloudCog,
    sections: [
      { id: "subscriptions", label: "Subscriptions" },
      { id: "api-keys", label: "API Keys" },
      { id: "custom-providers", label: "Custom Providers" },
      { id: "custom-models", label: "Custom Models" },
      { id: "tavily-profiles", label: "Tavily Profiles" },
      { id: "atlassian-profiles", label: "Atlassian Profiles" },
    ],
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
    id: "permissions",
    label: "Permissions",
    icon: Shield,
    description:
      "Understand tool risk and manage supervised-mode approval preferences.",
    sections: [
      { id: "defaults", label: "Defaults" },
      { id: "behavior", label: "How permissions behave" },
      { id: "project-allowed", label: "Current project" },
      { id: "always-allowed", label: "Global grants" },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    icon: Wrench,
    sections: [
      { id: "core", label: "Core" },
      { id: "third-party", label: "Third Party" },
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
    id: "suggestions",
    label: "Suggestions",
    icon: Lightbulb,
    description:
      "Project suggestions override user and built-in suggestions with the same name.",
    sections: [{ id: "suggestions", label: "Suggestions" }],
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
    id: "shortcuts",
    label: "Shortcuts",
    icon: Keyboard,
    description:
      "Shortcuts are fixed and use the primary modifier for your platform.",
    sections: [{ id: "shortcuts", label: "Shortcuts" }],
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
