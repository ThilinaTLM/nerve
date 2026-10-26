import type { Component } from "svelte";
import Bell from "@lucide/svelte/icons/bell";
import Bot from "@lucide/svelte/icons/bot";
import CloudCog from "@lucide/svelte/icons/cloud-cog";
import FileText from "@lucide/svelte/icons/file-text";
import HardDrive from "@lucide/svelte/icons/hard-drive";
import Keyboard from "@lucide/svelte/icons/keyboard";
import Library from "@lucide/svelte/icons/library";
import Lightbulb from "@lucide/svelte/icons/lightbulb";
import Mic from "@lucide/svelte/icons/mic";
import Monitor from "@lucide/svelte/icons/monitor";
import Play from "@lucide/svelte/icons/play";
import Plug from "@lucide/svelte/icons/plug";
import Server from "@lucide/svelte/icons/server";
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import Shield from "@lucide/svelte/icons/shield";
import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
import Users from "@lucide/svelte/icons/users";
import Wrench from "@lucide/svelte/icons/wrench";
import Boxes from "@lucide/svelte/icons/boxes";
import type {
  SettingsNavBadge,
  SettingsNavGroup,
  SettingsNavItem,
  SettingsPageDef,
  SettingsScopeHeader,
} from "$lib/presentation/settings";
import type { SettingsScopeTarget } from "./settings-scope";
import {
  defaultSettingsPageId,
  layoutByScope,
  pagesByScope,
  resolveSettingsPageId,
  settingsPageIds,
} from "./settings-page-data";

export { defaultSettingsPageId, resolveSettingsPageId, settingsPageIds };

const icons: Record<string, Component> = {
  providers: CloudCog,
  integrations: Plug,
  general: SlidersHorizontal,
  tools: Wrench,
  skills: Library,
  agents: Bot,
  "sub-agents": Users,
  "permission-rules": Shield,
  models: ShieldCheck,
  workbench: Monitor,
  notifications: Bell,
  shortcuts: Keyboard,
  voice: Mic,
  suggestions: Lightbulb,
  storage: HardDrive,
  system: Server,
  launch: Play,
  "instructions-files": FileText,
  trust: Boxes,
};

function pageDef(target: SettingsScopeTarget, id: string): SettingsPageDef {
  return { id, icon: icons[id]!, ...pagesByScope[target.kind][id]! };
}

/** Page definitions (with sections) for the scope, in nav order. */
export function settingsPagesFor(
  target: SettingsScopeTarget,
): SettingsPageDef[] {
  return settingsPageIds(target.kind).map((id) => pageDef(target, id));
}

/** The page for an id; stale or foreign ids resolve to the default page. */
export function settingsPageFor(
  target: SettingsScopeTarget,
  pageId: string | undefined,
): SettingsPageDef {
  return pageDef(target, resolveSettingsPageId(target.kind, pageId));
}

/** The grouped nav; `badges` marks pages with project differences or problems. */
export function settingsNavFor(
  target: SettingsScopeTarget,
  badges: Readonly<Record<string, SettingsNavBadge>> = {},
): SettingsNavGroup[] {
  const pages = pagesByScope[target.kind];
  return layoutByScope[target.kind].map(({ id, title, pages: ids }) => ({
    id,
    title,
    items: ids.map(
      (pageId): SettingsNavItem => ({
        id: pageId,
        label: pages[pageId]!.label,
        icon: icons[pageId]!,
        ...(badges[pageId] ? { badge: badges[pageId] } : {}),
      }),
    ),
  }));
}

export function settingsScopeHeader(
  target: SettingsScopeTarget,
  project?: { name: string },
): SettingsScopeHeader {
  return target.kind === "user"
    ? { title: "User settings" }
    : {
        title: "Project settings",
        subtitle: project?.name ?? "Project",
      };
}
