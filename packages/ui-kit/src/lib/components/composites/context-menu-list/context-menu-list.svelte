<script lang="ts" module>
// @lucide/svelte icons are Svelte components; keep the icon slot loosely typed.
/**
 * A menu entry's icon: a Svelte component (a Lucide icon). A menu drawn by a host outside the
 * page (extension frames, see `setItemMenuRenderer`) takes a Lucide icon name in kebab case
 * (`"trash-2"`) instead, because the host draws the icon.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Icon component interop.
export type MenuIcon = any;

/** What a menu opens against: an element, or any object that measures a rect. */
export type AnchorRect = DOMRectReadOnly;

/**
 * One entry of a context menu (`menuItems` of `PanelRow`, `PanelRowCard`; `getItemMenuItems` and
 * `getGroupMenuItems` of `PanelTree`). A host that draws menus outside the page may limit their
 * size and depth.
 */
export type ContextMenuItem =
  | {
      /** An action entry (the default). */
      type?: "item";
      /** Text shown. */
      label: string;
      /** Icon, see `MenuIcon`. */
      icon?: MenuIcon;
      /** Key hint shown at the end (`"Ctrl+K"`); it does not bind a key. */
      shortcut?: string;
      /** A toggle state: the item shows a check mark when `true`. */
      checked?: boolean;
      /** Greyed out and not selectable. */
      disabled?: boolean;
      /** Drawn as a dangerous action. */
      destructive?: boolean;
      /**
       * The action moves focus itself (an inline editor, a dialog), so closing
       * the menu must not hand focus back to the trigger afterwards.
       */
      movesFocus?: boolean;
      /** Runs when the entry is chosen. */
      onSelect?: () => void;
    }
  /** Divider between groups. */
  | { type: "separator" }
  | {
      /** Caption above the entries that follow. */
      type: "label";
      /** Caption text. */
      label: string;
      /** Icon before the caption, see `MenuIcon`. */
      icon?: MenuIcon;
    }
  | {
      /** Nested menu. */
      type: "submenu";
      /** Text shown. */
      label: string;
      /** Icon, see `MenuIcon`. */
      icon?: MenuIcon;
      /** Greyed out and not openable. */
      disabled?: boolean;
      /** The nested entries. */
      items: ContextMenuItem[];
    };
</script>

<script lang="ts">
import { setContext, type Snippet } from "svelte";
import * as ContextMenu from "@nervekit/ui-kit/components/ui/context-menu";
import { cn } from "@nervekit/ui-kit/utils";
import ContextMenuListItems from "./context-menu-list-items.svelte";
import {
  CONTEXT_MENU_FOCUS_KEY,
  shouldRestoreMenuFocus,
} from "./context-menu-focus";

let {
  children,
  items,
  open = $bindable(false),
  anchor,
  class: className,
  triggerClass,
  disabled = false,
  nativeTouch = false,
  onOpenChange,
}: {
  /** The element that opens the menu on its context-menu gesture. Leave out
   * together with `anchor` to open the menu from `open` alone. */
  children?: Snippet;
  items: ContextMenuItem[];
  /** Whether the menu is shown; set it to open the menu without a gesture. */
  open?: boolean;
  /** Opens the menu at this element or rect (any object with
   * `getBoundingClientRect`) below it, instead of at the pointer. */
  anchor?: { getBoundingClientRect(): AnchorRect } | null;
  class?: string;
  triggerClass?: string;
  /** Keep the trigger mounted but inert (e.g. while no actions exist yet). */
  disabled?: boolean;
  /** Leave touch long-press to the platform (text selection and the OS edit
   * menu) instead of opening this menu. Use on editable or selectable text,
   * where the menu would steal focus and dismiss the on-screen keyboard. */
  nativeTouch?: boolean;
  onOpenChange?: (open: boolean) => void;
} = $props();

// Closing a menu returns focus to its trigger. That is right after a plain
// action, but wrong when the action already moved focus (an inline editor
// mounted by "Rename"): the restore would blur it again.
let contentRef = $state<HTMLElement | null>(null);
let skipFocusRestore = false;
setContext(CONTEXT_MENU_FOCUS_KEY, {
  skipNextRestore: () => (skipFocusRestore = true),
});

function handleCloseAutoFocus(event: Event): void {
  const skip = skipFocusRestore;
  skipFocusRestore = false;
  const active = document.activeElement;
  const focusOutsideMenu =
    active instanceof HTMLElement &&
    active !== document.body &&
    !contentRef?.contains(active);
  if (!shouldRestoreMenuFocus({ skipRequested: skip, focusOutsideMenu }))
    event.preventDefault();
}

// Pointer type of the latest press. Disabling the trigger also clears its
// pending long-press timer, and its `contextmenu` handler then lets the
// native menu through.
let touchPress = $state(false);

function trackPointer(event: PointerEvent): void {
  touchPress = nativeTouch && event.pointerType !== "mouse";
}

function assertNoEllipsis(list: ContextMenuItem[]): void {
  if (!import.meta.env.DEV) return;
  for (const item of list) {
    if (item.type === "separator") continue;
    if (item.type === "label") {
      checkLabel(item.label);
      continue;
    }
    if (item.type === "submenu") {
      checkLabel(item.label);
      assertNoEllipsis(item.items);
      continue;
    }
    checkLabel(item.label);
  }
}

function checkLabel(label: string): void {
  if (label.includes("…") || label.includes("...")) {
    console.warn(`Context menu label must not contain an ellipsis: "${label}"`);
  }
}

$effect(() => assertNoEllipsis(items));
</script>

<ContextMenu.Root bind:open {onOpenChange}>
  {#if children}
    <ContextMenu.Trigger
      class={cn(nativeTouch && "select-text", triggerClass)}
      disabled={disabled || touchPress}
      onpointerdowncapture={trackPointer}
    >
      {@render children()}
    </ContextMenu.Trigger>
  {/if}
  <ContextMenu.Content
    class={className}
    customAnchor={anchor ?? null}
    side={anchor ? "bottom" : undefined}
    bind:ref={contentRef}
    onCloseAutoFocus={handleCloseAutoFocus}
  >
    <ContextMenuListItems {items} />
  </ContextMenu.Content>
</ContextMenu.Root>
