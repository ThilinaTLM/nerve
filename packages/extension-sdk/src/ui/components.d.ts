// Types of `ui/components.ts` (the implementation is compiled by the extension's UI build and
// stays out of this program: the UI kit's sources need the Svelte compiler to type-check).
// `test/ui-components.test.ts` keeps both files' export names equal.
import type { Component } from "svelte";

/** A Svelte 5 component of the UI kit; props are the shadcn-svelte props of that component (`class`, `children`, native element attributes) plus the ones listed on it here. */
type Part = Component<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
/** A multi-part component: `<Tabs.Root>`, `<Tabs.List>`, … Each part is a Svelte component. */
type Parts<Names extends string> = Record<Names, Part>;
/** What `cn` accepts: class strings, falsy values to skip and nested arrays. */
type ClassValue = string | false | null | undefined | ClassValue[];

/** Joins class names and resolves conflicting Tailwind utilities (the later wins): `cn("px-2", active && "bg-muted", className)`. */
export function cn(...inputs: ClassValue[]): string;
/** Button (`<Button onclick={…}>`). Props: `variant` (`default`, `outline`, `success`, `ghost`, `destructive`, `link`; default `default`), `size` (`default`, `sm`, `icon`, `icon-sm`), `active` (toggle state), `pressed` (`aria-pressed`), `href` (renders a link), `disabled`, `type` (default `button`). */
export const Button: Part;
/** Class string of a button for other elements: `buttonVariants({ variant, size, class })` with the `Button` variants and sizes. */
export function buttonVariants(options?: {
  /** Button `variant`; default `default`. */
  variant?: string;
  /** Button `size`; default `default`. */
  size?: string;
  /** Extra classes. */
  class?: string;
}): string;
/** Small chip. Props: `variant` (`neutral` default, `brand`, `info`, `success`, `warning`, `destructive`), `href` (renders a link). */
export const Badge: Part;
/** Class string of a badge for other elements: `badgeVariants({ variant, class })`. */
export function badgeVariants(options?: {
  /** Badge `variant`; default `neutral`. */
  variant?: string;
  /** Extra classes. */
  class?: string;
}): string;
/** Text input (`<Input bind:value />`). Native input attributes. */
export const Input: Part;
/** Multi-line text input (`<Textarea bind:value />`). */
export const Textarea: Part;
/** Form label (`<Label for="id">`). */
export const Label: Part;
/** Checkbox (`bind:checked`). */
export const Checkbox: Part;
/** On/off switch (`bind:checked`). */
export const Switch: Part;
/** Loading placeholder block; size it with `class`. */
export const Skeleton: Part;
/** Spinning loading indicator. */
export const Spinner: Part;
/** Keyboard key hint (`<Kbd>⌘K</Kbd>`). */
export const Kbd: Part;
/** Divider line; `orientation` `horizontal` (default) or `vertical`. */
export const Separator: Part;
/** Progress bar; `value` 0–`max` (default 100). */
export const Progress: Part;
/** Scrollable area with styled scrollbars; give it a bounded height. */
export const ScrollArea: Part;
/** Tabs: `<Tabs.Root bind:value><Tabs.List><Tabs.Trigger value="a">…</Tabs.Trigger></Tabs.List><Tabs.Content value="a">…</Tabs.Content></Tabs.Root>`. */
export const Tabs: Parts<"Root" | "List" | "Trigger" | "Content">;
/** Select: `<Select.Root type="single" bind:value><Select.Trigger/><Select.Content><Select.Item value label/></Select.Content></Select.Root>`. Works, but the open list is clipped to the frame. */
export const Select: Parts<"Root" | "Item" | "Content" | "Trigger" | "Portal">;
/** Tooltip: wrap in `Tooltip.Provider`, then `Root`, `Trigger`, `Content`. Works, but is clipped to the frame. */
export const Tooltip: Parts<
  "Root" | "Trigger" | "Content" | "Provider" | "Portal"
>;
/** Collapsible section: `Root` (`bind:open`), `Trigger`, `Content`. */
export const Collapsible: Parts<"Root" | "Content" | "Trigger">;
/** Empty state: `Root` with `Header`, `Media`, `Title`, `Description` and `Content`. */
export const Empty: Parts<
  "Root" | "Header" | "Media" | "Title" | "Description" | "Content"
>;
/** Radio group: `Root` (`bind:value`) with `Item` (`value`). */
export const RadioGroup: Parts<"Root" | "Item">;
/** Toggle button group: `Root` (`type` `single` or `multiple`, `bind:value`) with `Item` (`value`). */
export const ToggleGroup: Parts<"Root" | "Item">;
/** Resizable panes: `PaneGroup` (`direction`) containing `Pane` (`defaultSize`) separated by `Handle`. */
export const Resizable: Parts<"PaneGroup" | "Pane" | "Handle">;
/** Message box. Props: `tone` (`neutral`, `brand`, `info`, `success`, `warning`, `destructive`), `layout` (`block` or `strip`), `icon` (a component from `@nervekit/extension-sdk/icons`), `title`, `text`, `actions` and `children` (snippets). */
export const Callout: Part;
/** Quiet caption above a group of rows. Props: `label`, `count`, `icon` (from `@nervekit/extension-sdk/icons`). */
export const GroupLabel: Part;
/** Icon-only button with a tooltip. Props: `icon` (a component: import it from `@nervekit/extension-sdk/icons`, e.g. `import { Copy } from "@nervekit/extension-sdk/icons"`; do not install `@lucide/svelte`), `label` (required: tooltip and accessible name), `onclick`, `tone` (`neutral`, `destructive`), `active`, `disabled`, `busy`, `side` (tooltip side). */
export const IconAction: Part;
/** Search field with a clear button. Props: `bind:value`, `placeholder`, `clearable` (default true), `onValueChange`, `icon`, `trailing` (snippet). */
export const SearchInput: Part;
/** Small coloured dot. Props: `tone` (`neutral`, `brand`, `info`, `success`, `warning`, `destructive`), `size` (`xs`, `sm`, `md`), `variant` (`solid`, `outline`), `pulse`, `label`. */
export const StatusDot: Part;
/** Circular progress. Props: `percent` (0–100, clamped), `tone`. */
export const ProgressRing: Part;
/** Vertical scroll area that shows overflow with edge shadows. Props: `surface` (`panel`, `card` or `popover`: the background the shadows fade into; default `card`), `height`, `viewport` (bindable element), `children`. */
export const ScrollRegion: Part;
/**
 * Overlay for the floating chrome of a page, preview or panel. Place it inside a `relative` container that fills the frame (`<div class="relative h-screen">`), next to the content, not around it. Snippet props, one per anchor, each stacking several items: `topStart` (identity, view choice), `topEnd` (actions on the content: find, copy, download, more), `bottomEnd` (spatial navigation: zoom), `bottomStart` (notices). `class` adjusts the insets (`pr-5` clears a scrollbar lane).
 * Put the actions of a page in a `FloatingToolbar` here; do not build absolutely positioned bars.
 */
export const FloatingLayer: Part;
/**
 * The bar of a `FloatingLayer` anchor; it positions nothing itself. Props: `label` (required, accessible name), `orientation` (`horizontal` default, or `vertical`: icon-only buttons, for zoom in `bottomEnd`), `reveal` (`always` default, or `hover`: quiet until the pane is hovered or focused). Children: `FloatingToolbarGroup`, `FloatingToolbarButton`, `FloatingToolbarText`.
 */
export const FloatingToolbar: Part;
/** Related controls inside a `FloatingToolbar`; dividers between groups are drawn for you, so do not add separators. Props: `label` (accessible name), `collapse` (hidden in panes narrower than 28rem; only for readouts and actions that `FloatingToolbarMenu` also offers). */
export const FloatingToolbarGroup: Part;
/**
 * Icon button of a floating bar, with a tooltip. Props: `label` (required: tooltip and accessible name; do not add `title`), `icon` (a component from `@nervekit/extension-sdk/icons`), `text` (short visible text such as "100%" instead of the icon; horizontal bars only), `shortcut` (shown in the tooltip, e.g. "Ctrl+F"), `pressed` (toggle state; leave unset for a plain action), `disabled`, `busy` (spinner, blocks clicks), `tone` (`neutral`, `destructive`), `side` (tooltip side), `onclick`. The tooltip is clipped to the frame, so keep buttons off the frame edge it points past.
 */
export const FloatingToolbarButton: Part;
/** Readout inside a `FloatingToolbar` (match count, zoom level, size). Props: `tone` (`muted` default, `destructive`), `live` (announces changes), `title`, `class`, `children`. */
export const FloatingToolbarText: Part;
/**
 * Expanded form of a floating bar for fields (find, filter, go to). Fields (`Input`, `SearchInput`, `Select`) go only here, never on a `FloatingToolbar`. Props: `label` (required), `role` (`search` or `group`), `size` (`sm`, `md`, `lg`), `onClose` (called on Escape unless the event is default-prevented), `ref` (bindable element), `children`. Full width in narrow panes. Place it in a `FloatingLayer` anchor, usually `topEnd`.
 */
export const FloatingPanel: Part;
/** Lasting status of the pane, in the `bottomStart` anchor of a `FloatingLayer` (read-only file, truncated content). Props: `tone` (`info` default, `warning`), `onDismiss` (shows a dismiss button), `action` (snippet with one small `Button`), `children` (the message). */
export const FloatingNotice: Part;
/**
 * Overflow button of a `FloatingToolbar` for secondary actions: keep 4–8 controls on the bar and put the rest here. Opens a menu drawn by the host (`host.ui.showMenu`) below the button. Props: `items` (`MenuItem[]`: `id`, `label`, `disabled`, `destructive`), `onSelect(id)` (not called when the menu is dismissed), `label` (default "More actions"), `icon` (default the ellipsis).
 */
export const FloatingToolbarMenu: Part;
