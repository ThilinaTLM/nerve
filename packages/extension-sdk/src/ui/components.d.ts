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
/** Message box. Props: `tone` (`neutral`, `brand`, `info`, `success`, `warning`, `destructive`), `layout` (`block` or `strip`), `icon` (a component), `title`, `text`, `actions` and `children` (snippets). */
export const Callout: Part;
/** Quiet caption above a group of rows. Props: `label`, `count`, `icon`. */
export const GroupLabel: Part;
/** Icon-only button with a tooltip. Props: `icon` (a component, e.g. from `@lucide/svelte`), `label` (required: tooltip and accessible name), `onclick`, `tone` (`neutral`, `destructive`), `active`, `disabled`, `busy`, `side` (tooltip side). */
export const IconAction: Part;
/** Search field with a clear button. Props: `bind:value`, `placeholder`, `clearable` (default true), `onValueChange`, `icon`, `trailing` (snippet). */
export const SearchInput: Part;
/** Small coloured dot. Props: `tone` (`neutral`, `brand`, `info`, `success`, `warning`, `destructive`), `size` (`xs`, `sm`, `md`), `variant` (`solid`, `outline`), `pulse`, `label`. */
export const StatusDot: Part;
/** Circular progress. Props: `percent` (0–100, clamped), `tone`. */
export const ProgressRing: Part;
/** Vertical scroll area that shows overflow with edge shadows. Props: `surface` (`panel`, `card` or `popover`: the background the shadows fade into; default `card`), `height`, `viewport` (bindable element), `children`. */
export const ScrollRegion: Part;
