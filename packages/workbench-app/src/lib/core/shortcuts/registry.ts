import {
  formatShortcut,
  formatShortcutForAria,
  type ShortcutBinding,
} from "./keyboard";

export type ShortcutCategory = "Conversation" | "Composer" | "Panes" | "View";

export type ShortcutCommandId =
  | "conversation.new"
  | "conversation.newFromProject"
  | "pane.close"
  | "pane.closeOthers"
  | "pane.refresh"
  | "pane.previous"
  | "pane.next"
  | `pane.focusByIndex.${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
  | "projectSearch.focus"
  | "composer.focus"
  | "composer.send"
  | "composer.stopRun"
  | "composer.toggleMic"
  | "composer.cancelMic"
  | "composer.toggleMode"
  | "composer.cyclePermission"
  | "composer.cycleThinking"
  | "zoom.in"
  | "zoom.out"
  | "zoom.reset";

export type ShortcutCommand = {
  id: ShortcutCommandId;
  label: string;
  category: ShortcutCategory;
  defaultBinding: ShortcutBinding;
  allowInEditable?: boolean;
};

const paneIndexCommands = Array.from({ length: 9 }, (_, index) => {
  const number = index + 1;
  return {
    id: `pane.focusByIndex.${number}` as ShortcutCommandId,
    label: `Focus pane ${number}`,
    category: "Panes" as const,
    defaultBinding: { key: String(number), mod: true },
  };
});

export const DEFAULT_SHORTCUTS: ShortcutCommand[] = [
  {
    id: "conversation.new",
    label: "New chat",
    category: "Conversation",
    defaultBinding: { key: "n", mod: true },
  },
  {
    id: "conversation.newFromProject",
    label: "New chat from project",
    category: "Conversation",
    defaultBinding: { key: "n", mod: true, shift: true },
  },
  {
    id: "pane.close",
    label: "Close pane",
    category: "Panes",
    defaultBinding: { key: "w", mod: true },
    allowInEditable: true,
  },
  {
    id: "pane.closeOthers",
    label: "Close other panes",
    category: "Panes",
    defaultBinding: { key: "w", mod: true, shift: true },
  },
  {
    id: "pane.refresh",
    label: "Refresh pane",
    category: "Panes",
    defaultBinding: { key: "r", mod: true },
  },
  {
    id: "pane.previous",
    label: "Previous pane",
    category: "Panes",
    defaultBinding: { key: "[", mod: true },
  },
  {
    id: "pane.next",
    label: "Next pane",
    category: "Panes",
    defaultBinding: { key: "]", mod: true },
  },
  ...paneIndexCommands,
  {
    id: "projectSearch.focus",
    label: "Focus project search",
    category: "Conversation",
    defaultBinding: { key: "k", mod: true },
  },
  {
    id: "composer.focus",
    label: "Focus composer",
    category: "Composer",
    defaultBinding: { key: "escape" },
    allowInEditable: true,
  },
  {
    id: "composer.send",
    label: "Send prompt",
    category: "Composer",
    defaultBinding: { key: "enter", mod: true },
    allowInEditable: true,
  },
  {
    id: "composer.stopRun",
    label: "Stop active run",
    category: "Composer",
    defaultBinding: { key: ".", mod: true },
    allowInEditable: true,
  },
  {
    id: "composer.toggleMic",
    label: "Toggle voice recording",
    category: "Composer",
    defaultBinding: { key: "v", alt: true },
    allowInEditable: true,
  },
  {
    id: "composer.cancelMic",
    label: "Cancel voice recording",
    category: "Composer",
    defaultBinding: { key: "escape" },
    allowInEditable: true,
  },
  {
    id: "composer.toggleMode",
    label: "Toggle coding/planning mode",
    category: "Composer",
    defaultBinding: { key: "m", alt: true },
    allowInEditable: true,
  },
  {
    id: "composer.cyclePermission",
    label: "Cycle permission level",
    category: "Composer",
    defaultBinding: { key: "p", alt: true },
    allowInEditable: true,
  },
  {
    id: "composer.cycleThinking",
    label: "Cycle thinking level",
    category: "Composer",
    defaultBinding: { key: "t", alt: true },
    allowInEditable: true,
  },
  {
    id: "zoom.in",
    label: "Zoom in",
    category: "View",
    defaultBinding: { key: "=", mod: true },
  },
  {
    id: "zoom.out",
    label: "Zoom out",
    category: "View",
    defaultBinding: { key: "-", mod: true },
  },
  {
    id: "zoom.reset",
    label: "Reset zoom",
    category: "View",
    defaultBinding: { key: "0", mod: true },
  },
];

export function getShortcut(
  id: ShortcutCommandId,
): ShortcutCommand | undefined {
  return DEFAULT_SHORTCUTS.find((command) => command.id === id);
}

export function getShortcutBinding(
  id: ShortcutCommandId,
): ShortcutBinding | undefined {
  return getShortcut(id)?.defaultBinding;
}

export function getShortcutLabel(id: ShortcutCommandId): string | undefined {
  const binding = getShortcutBinding(id);
  return binding ? formatShortcut(binding) : undefined;
}

export function getShortcutAriaLabel(
  id: ShortcutCommandId,
): string | undefined {
  const binding = getShortcutBinding(id);
  return binding ? formatShortcutForAria(binding) : undefined;
}
