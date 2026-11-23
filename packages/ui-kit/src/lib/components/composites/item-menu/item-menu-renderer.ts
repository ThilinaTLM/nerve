import type { Component, Snippet } from "svelte";
import ContextMenuList, {
  type ContextMenuItem,
} from "../context-menu-list/index.js";

/**
 * Props every item-menu renderer receives. A renderer wraps `children` (the
 * item) and opens a menu of `items` on the item's context-menu gesture
 * (right click, long press). It must render `children` exactly once, whether
 * or not the menu is open, and honour `disabled`.
 */
export type ItemMenuRendererProps = {
  /** Menu entries; `onSelect` runs when one is chosen. */
  items: ContextMenuItem[];
  /** Keep the item rendered but suppress the menu. */
  disabled?: boolean;
  /** Class for the element wrapping `children`; unset, the wrapper is a plain block element. */
  triggerClass?: string;
  /** Called when the menu opens or closes. */
  onOpenChange?: (open: boolean) => void;
  children: Snippet;
};

export type ItemMenuRenderer = Component<ItemMenuRendererProps>;

// ContextMenuList already satisfies the renderer contract.
let renderer: ItemMenuRenderer = ContextMenuList as ItemMenuRenderer;

/**
 * Replaces the renderer used by every `ItemMenu` (panel rows, trees, cards,
 * item surfaces). Call once at startup; the default is the in-page
 * `ContextMenuList`. Hosts that cannot draw menus (sandboxed frames) register
 * a renderer that delegates to the host instead.
 */
export function setItemMenuRenderer(component: ItemMenuRenderer): void {
  renderer = component;
}

export function getItemMenuRenderer(): ItemMenuRenderer {
  return renderer;
}
