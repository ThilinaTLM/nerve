import Blocks from "@lucide/svelte/icons/blocks";
import BookOpen from "@lucide/svelte/icons/book-open";
import Calendar from "@lucide/svelte/icons/calendar";
import ChartBar from "@lucide/svelte/icons/chart-bar";
import ChartLine from "@lucide/svelte/icons/chart-line";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import Clock from "@lucide/svelte/icons/clock";
import Code from "@lucide/svelte/icons/code";
import Database from "@lucide/svelte/icons/database";
import FileText from "@lucide/svelte/icons/file-text";
import Folder from "@lucide/svelte/icons/folder";
import Globe from "@lucide/svelte/icons/globe";
import ImageIcon from "@lucide/svelte/icons/image";
import Inbox from "@lucide/svelte/icons/inbox";
import Kanban from "@lucide/svelte/icons/kanban";
import Layers from "@lucide/svelte/icons/layers";
import LayoutDashboard from "@lucide/svelte/icons/layout-dashboard";
import List from "@lucide/svelte/icons/list";
import ListChecks from "@lucide/svelte/icons/list-checks";
import MapIcon from "@lucide/svelte/icons/map";
import MessageSquare from "@lucide/svelte/icons/message-square";
import Package from "@lucide/svelte/icons/package";
import Puzzle from "@lucide/svelte/icons/puzzle";
import Search from "@lucide/svelte/icons/search";
import Settings from "@lucide/svelte/icons/settings";
import Table from "@lucide/svelte/icons/table";
import Terminal from "@lucide/svelte/icons/terminal";
import Workflow from "@lucide/svelte/icons/workflow";
import Zap from "@lucide/svelte/icons/zap";
import type { Component } from "svelte";

export type ExtensionIconComponent = Component<{
  size?: number;
  strokeWidth?: number;
  class?: string;
  "aria-hidden"?: "true";
}>;

// Extensions name a lucide icon; shipping every glyph would bloat the bundle, so the host
// maps the common ones and shows a puzzle piece for the rest.
const icons: Record<string, ExtensionIconComponent> = {
  blocks: Blocks,
  "book-open": BookOpen,
  calendar: Calendar,
  "chart-bar": ChartBar,
  "chart-line": ChartLine,
  "circle-check": CircleCheck,
  clock: Clock,
  code: Code,
  database: Database,
  "file-text": FileText,
  folder: Folder,
  globe: Globe,
  image: ImageIcon,
  inbox: Inbox,
  kanban: Kanban,
  layers: Layers,
  "layout-dashboard": LayoutDashboard,
  list: List,
  "list-checks": ListChecks,
  map: MapIcon,
  "message-square": MessageSquare,
  package: Package,
  puzzle: Puzzle,
  search: Search,
  settings: Settings,
  table: Table,
  terminal: Terminal,
  workflow: Workflow,
  zap: Zap,
};

export function extensionIcon(
  name: string | undefined,
): ExtensionIconComponent {
  return (
    (name && Object.hasOwn(icons, name) ? icons[name] : undefined) ?? Puzzle
  );
}
