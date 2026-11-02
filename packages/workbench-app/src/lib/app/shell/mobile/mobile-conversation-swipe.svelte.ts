import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import type { ConversationSummary } from "@nervekit/contracts/core";
import type { MobileRowSwipeAction } from "$lib/presentation/shell";
import { mobileConversationMenu } from "./mobile-conversation-menu.svelte";

type MenuAction = Extract<ContextMenuItem, { type?: "item" }>;

export type MobileConversationRowActions = {
  menuItems: ContextMenuItem[];
  /** Swipe right: mark done / reopen. */
  swipeLeading?: MobileRowSwipeAction;
  /** Swipe left: pin / unpin, then delete. */
  swipeTrailing?: MobileRowSwipeAction[];
};

function findAction(
  items: readonly ContextMenuItem[],
  labels: readonly string[],
): MenuAction | undefined {
  return items.find(
    (item): item is MenuAction =>
      item.type !== "separator" &&
      item.type !== "label" &&
      item.type !== "submenu" &&
      labels.includes(item.label),
  );
}

function swipeAction(
  item: MenuAction,
  tone: MobileRowSwipeAction["tone"],
): MobileRowSwipeAction {
  return {
    label: item.label,
    icon: item.icon as MobileRowSwipeAction["icon"],
    tone,
    onSelect: () => item.onSelect?.(),
  };
}

/**
 * Row actions for a conversation on a phone list. Swipe actions are taken from
 * the same menu the long-press sheet shows, so state changes and the delete
 * confirmation behave identically however they are reached.
 */
export function mobileConversationRowActions(
  conversation: ConversationSummary,
): MobileConversationRowActions {
  const menuItems = mobileConversationMenu(conversation);
  const done = findAction(menuItems, ["Mark done", "Reopen"]);
  const pin = findAction(menuItems, ["Pin", "Unpin"]);
  const remove = findAction(menuItems, ["Delete"]);
  const trailing = [
    pin && swipeAction(pin, "info"),
    remove && !remove.disabled ? swipeAction(remove, "destructive") : undefined,
  ].filter((action): action is MobileRowSwipeAction => Boolean(action));
  return {
    menuItems,
    swipeLeading: done ? swipeAction(done, "success") : undefined,
    swipeTrailing: trailing.length ? trailing : undefined,
  };
}
