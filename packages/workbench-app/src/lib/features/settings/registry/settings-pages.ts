import TextCursorInput from "@lucide/svelte/icons/text-cursor-input";
import type { Component } from "svelte";
import KeyRound from "@lucide/svelte/icons/key-round";
import Timer from "@lucide/svelte/icons/timer";
import Bell from "@lucide/svelte/icons/bell";
import Bot from "@lucide/svelte/icons/bot";
import CloudCog from "@lucide/svelte/icons/cloud-cog";
import HardDrive from "@lucide/svelte/icons/hard-drive";
import Keyboard from "@lucide/svelte/icons/keyboard";
import Library from "@lucide/svelte/icons/library";
import Lightbulb from "@lucide/svelte/icons/lightbulb";
import Mic from "@lucide/svelte/icons/mic";
import Monitor from "@lucide/svelte/icons/monitor";
import Plug from "@lucide/svelte/icons/plug";
import Blocks from "@lucide/svelte/icons/blocks";
import ServerCog from "@lucide/svelte/icons/server-cog";
import Cpu from "@lucide/svelte/icons/cpu";
import Shield from "@lucide/svelte/icons/shield";
import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
import Users from "@lucide/svelte/icons/users";
import Wrench from "@lucide/svelte/icons/wrench";
import Smartphone from "@lucide/svelte/icons/smartphone";
import Radio from "@lucide/svelte/icons/radio";
import Info from "@lucide/svelte/icons/info";
import type {
  SettingsNavBadge,
  SettingsNavGroup,
  SettingsNavItem,
  SettingsPageDef,
} from "$lib/presentation/settings";
import {
  resolveSettingsTarget,
  settingsScopeForPage,
  pagesByScope,
  settingsNavLayout,
  type PageData,
} from "./settings-page-data";

export { resolveSettingsTarget, settingsScopeForPage };

const icons: Record<string, Component> = {
  providers: CloudCog,
  extensions: Blocks,
  accounts: KeyRound,
  "mcp-servers": Plug,
  general: SlidersHorizontal,
  tools: Wrench,
  skills: Library,
  agents: Bot,
  "sub-agents": Users,
  "permission-rules": Shield,
  models: Cpu,
  workbench: Monitor,
  notifications: Bell,
  shortcuts: Keyboard,
  voice: Mic,
  titles: TextCursorInput,
  suggestions: Lightbulb,
  storage: HardDrive,
  "background-jobs": Timer,
  remote: Radio,
  devices: Smartphone,
  system: ServerCog,
  about: Info,
};

/**
 * The open project, when there is one. One surface serves both tab kinds: the
 * project only adds a column on layered pages.
 */
export type SettingsSurface = { projectName?: string };

/** Pages that have a User and a project layer. */
export const layeredPageIds: readonly string[] = [
  "general",
  "tools",
  "skills",
  "extensions",
  "mcp-servers",
];

/** Page ids in nav order; the same with or without a project. */
const surfacePageIds: readonly string[] = settingsNavLayout.flatMap(
  (group) => group.pages,
);

/** Stale or foreign ids (restored state, links) fall back to General. */
export function resolveSurfacePageId(pageId: string | undefined): string {
  return pageId && surfacePageIds.includes(pageId) ? pageId : "general";
}

function pageData(id: string, surface: SettingsSurface): PageData {
  const base = pagesByScope.user[id] ?? pagesByScope.project[id]!;
  return {
    ...base,
    // A project's own skills open a review page.
    ...(id === "skills" && surface.projectName
      ? { detail: { param: "skill" } }
      : {}),
  };
}

function pageDef(id: string, surface: SettingsSurface): SettingsPageDef {
  return { id, icon: icons[id]!, ...pageData(id, surface) };
}

/** Page definitions (with sections) of the surface, in nav order. */
export function settingsPagesFor(surface: SettingsSurface): SettingsPageDef[] {
  return surfacePageIds.map((id) => pageDef(id, surface));
}

/** The page for an id; stale or foreign ids resolve to the default page. */
export function settingsPageFor(
  surface: SettingsSurface,
  pageId: string | undefined,
): SettingsPageDef {
  return pageDef(resolveSurfacePageId(pageId), surface);
}

/** The grouped nav; `badges` marks pages with items that need the user. */
export function settingsNavFor(
  surface: SettingsSurface,
  badges: Readonly<Record<string, SettingsNavBadge>> = {},
): SettingsNavGroup[] {
  return settingsNavLayout.map(({ id, title, pages: ids }) => ({
    id,
    title,
    items: ids.map(
      (pageId): SettingsNavItem => ({
        id: pageId,
        label: pageData(pageId, surface).label,
        icon: icons[pageId]!,
        ...(badges[pageId] ? { badge: badges[pageId] } : {}),
      }),
    ),
  }));
}
