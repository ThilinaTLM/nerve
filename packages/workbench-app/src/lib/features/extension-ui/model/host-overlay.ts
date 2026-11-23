import type {
  BridgeAnchor,
  BridgeMenuEntry,
  BridgeParams,
} from "@nervekit/contracts/extensions";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import type { CommandItem } from "@nervekit/ui-kit/components/composites/popover-panel";
import type { ExtensionIconComponent } from "./extension-icons";

/*
 * Pure parts of the menus and pickers the host draws for an extension frame: where the frame's
 * coordinates land in the app window, and the ui-kit shapes the bridge's entries turn into.
 */

type Rect = { left: number; top: number; width: number; height: number };

/** A rectangle with the geometry fields of a `DOMRect` (what a floating layer measures). */
export type AnchorRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
  toJSON(): unknown;
};

function rect(x: number, y: number, width: number, height: number): AnchorRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    toJSON: () => ({ x, y, width, height }),
  };
}

/**
 * The anchor of a frame, in app-window coordinates: the frame's rectangle plus the anchor, which
 * is in the frame's CSS pixels. An anchor outside the frame (an element scrolled away) is pulled
 * to its edge, so the overlay never points at another part of the app. Without an anchor the
 * point is the frame's center.
 */
export function anchorInApp(
  frame: Rect,
  anchor: BridgeAnchor | undefined,
): AnchorRect {
  if (!anchor)
    return rect(
      frame.left + frame.width / 2,
      frame.top + frame.height / 2,
      0,
      0,
    );
  const x = Math.min(Math.max(anchor.x, 0), frame.width);
  const y = Math.min(Math.max(anchor.y, 0), frame.height);
  const width = Math.min(anchor.width ?? 0, frame.width - x);
  const height = Math.min(anchor.height ?? 0, frame.height - y);
  return rect(frame.left + x, frame.top + y, width, height);
}

/** Every lucide icon name a menu mentions, submenus included. */
export function menuIconNames(entries: readonly BridgeMenuEntry[]): string[] {
  const names = new Set<string>();
  const visit = (list: readonly BridgeMenuEntry[]) => {
    for (const entry of list) {
      if (entry.type === "separator" || entry.type === "label") continue;
      if (entry.icon) names.add(entry.icon);
      if (entry.type === "submenu") visit(entry.items);
    }
  };
  visit(entries);
  return [...names];
}

/**
 * The menu the user sees: the extension's name on top (so it cannot pass as Nerve's own menu),
 * then the frame's entries as ui-kit menu items. `onChoose` gets the id of the chosen item.
 */
export function menuItemsOf(
  entries: readonly BridgeMenuEntry[],
  options: {
    extensionName: string;
    icons: ReadonlyMap<string, ExtensionIconComponent>;
    onChoose: (id: string) => void;
  },
): ContextMenuItem[] {
  const convert = (list: readonly BridgeMenuEntry[]): ContextMenuItem[] =>
    list.map((entry): ContextMenuItem => {
      if (entry.type === "separator") return { type: "separator" };
      if (entry.type === "label") return { type: "label", label: entry.label };
      const icon = entry.icon ? options.icons.get(entry.icon) : undefined;
      if (entry.type === "submenu")
        return {
          type: "submenu",
          label: entry.label,
          ...(icon ? { icon } : {}),
          ...(entry.disabled ? { disabled: true } : {}),
          items: convert(entry.items),
        };
      return {
        label: entry.label,
        ...(icon ? { icon } : {}),
        ...(entry.shortcut ? { shortcut: entry.shortcut } : {}),
        ...(entry.checked === undefined ? {} : { checked: entry.checked }),
        ...(entry.disabled ? { disabled: true } : {}),
        ...(entry.destructive ? { destructive: true } : {}),
        onSelect: () => options.onChoose(entry.id),
      };
    });
  return [
    { type: "label", label: `From ${options.extensionName}` },
    { type: "separator" },
    ...convert(entries),
  ];
}

/** A row of a host-drawn picker. */
export type PickRow = CommandItem & {
  detail?: string;
  icon?: string;
  disabled: boolean;
};

/** The picker's rows; an item without a group is listed under no heading. */
export function pickRowsOf(items: BridgeParams<"ui.pick">["items"]): PickRow[] {
  return items.map((item) => ({
    key: item.id,
    label: item.label,
    group: item.group ?? "",
    ...(item.keywords ? { keywords: item.keywords } : {}),
    ...(item.detail ? { detail: item.detail } : {}),
    ...(item.icon ? { icon: item.icon } : {}),
    disabled: item.disabled === true,
  }));
}

/** Rows with a search field only when the list is long enough to need one. */
export const pickSearchThreshold = 8;
