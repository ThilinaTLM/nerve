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
/** One entry of a row's right-click menu (`menuItems` of `PanelRow`, `PanelRowCard`, `PanelTree`). The host draws it: submenus are flattened to `Parent › Child`, separators and labels are dropped. */
export type ContextMenuItem =
  | {
      /** An action entry (the default). */
      type?: "item";
      /** Text shown. */
      label: string;
      /** Greyed out and not selectable. */
      disabled?: boolean;
      /** Drawn as a dangerous action. */
      destructive?: boolean;
      /** Runs when the entry is chosen. */
      onSelect?: () => void;
    }
  | {
      /** Divider; dropped by the host menu. */
      type: "separator";
    }
  | {
      /** Caption; dropped by the host menu. */
      type: "label";
      /** Caption text. */
      label: string;
    }
  | {
      /** Nested entries, shown as `label › entry`. */
      type: "submenu";
      /** Prefix of the nested entries. */
      label: string;
      /** Disables every nested entry. */
      disabled?: boolean;
      /** The nested entries. */
      items: ContextMenuItem[];
    };
/** Choice of a `SelectField` or `RadioGroupField`. */
export type FieldChoice = {
  /** Reported through `value` / `onValueChange`. */
  value: string;
  /** Text shown. */
  label: string;
  /** Muted second line. */
  detail?: string;
  /** Not selectable. */
  disabled?: boolean;
};
/** Labelled select (the field to put in a `FieldRow` control). Props: `items: FieldChoice[]`, `bind:value`, `id` (for `FieldRow htmlFor`), `placeholder`, `disabled`, `ariaLabel`, `onValueChange`, `class`, `triggerClass`, `contentClass`. The open list is clipped to the frame; for long or searchable lists use `CommandList` in a `FloatingPanel` or inline. */
export const SelectField: Part;
/** Switch with a label and one-line description, the whole row clickable. Props: `bind:checked`, `label`, `description`, `disabled`, `onCheckedChange`. Inside a `PageSection` prefer `ToggleRow`. */
export const SwitchField: Part;
/** Radio choices with optional detail lines. Props: `items: FieldChoice[]`, `bind:value`, `orientation` (`vertical` default, `horizontal`), `ariaLabel`, `disabled`, `onValueChange`. */
export const RadioGroupField: Part;
/** Row of a `CommandList`: filtered by every word of the query against `label`, `group` and `keywords`, listed under its `group`. */
export type CommandItem = {
  /** Stable, unique key. */
  key: string;
  /** Text shown and searched. */
  label: string;
  /** Heading the row is listed under; typing it matches the whole group. */
  group: string;
  /** Extra search terms that are not shown (ids, aliases). */
  keywords?: readonly string[];
};
/**
 * Command-palette list: a search field over grouped rows with arrow-key navigation and Enter to choose, like Nerve's model and agent pickers. Props: `items: CommandItem[]` (extra fields allowed), `onChoose(item)`, `ariaLabel` (required), `bind:query`, `placeholder`, `isSelected(item)`, `isDisabled(item)`, `icon` (snippet per item), `row` (snippet `(item, { active, selected })` replacing the label), `empty` (text or snippet), `stableHeight` (CSS height that stops the list jumping while filtering), `autofocus` (default true), `leading` (snippet above the rows). Use it inline or inside a `FloatingPanel`; a frame has no popover.
 */
export const CommandList: Part;
/** Virtualized list for thousands of rows. Props: `items`, `getKey(item, index)`, `row` (snippet `{ item, index, visible }`), `estimateSize(index)`, `overscan`, `gap`, `paddingStart`, `paddingEnd`, `class`, `viewportClass`, `viewportAriaLabel`. Give it a bounded height. Trees use `PanelTree virtualized`. */
export const VirtualScroller: Part;

// ── Panels ─────────────────────────────────────────────────────────────────
// A panel is built like Nerve's Git, Files and Launches panels: `PanelView` > banner (`PanelHeader`, optional `PanelFilterBar`) > one scroll region of `PanelList`/`PanelTree` rows or `PanelSection`s.

/** Root of a panel. Owns the height, the panel surface and padding; snippets `banner` (pinned: `PanelHeader`, `PanelFilterBar`, a `Callout layout="strip"`) and `toolbar`; `children` is the content, which owns the one scroll region (`ScrollArea`, `PanelTree virtualized`, `PanelSplit`). Props: `contentClass`. */
export const PanelView: Part;
/** First line of a panel: title, count and trailing icon actions (`PanelToolbarButton`s). Props: `title` (required), `count`, `trailing` (snippet), `class`. */
export const PanelHeader: Part;
/** Icon button of a panel header or row. Props: `icon` (from `@nervekit/extension-sdk/icons`), `label` (required: tooltip and accessible name), `onclick`, `loading` (spinner), `active`, `disabled`, `showLabel` (icon and text), `dense` (inside rows), `href`, `badge` (snippet). */
export const PanelToolbarButton: Part;
/** Search field and scope chips under a `PanelHeader` (Git's "Filter repos or branches" with "All 6 · Changed 0 · Attention 0"). Props: `bind:query`, `placeholder` (the field shows when `query` or `placeholder` is set), `ariaLabel`, `scopes: PanelFilterScope[]` (chips show when non-empty), `bind:scope`, `scopeLabel` (chip group's accessible name), `onScopeChange`, `extra` (snippet below). The panel filters its rows itself. */
export const PanelFilterBar: Part;
/** Scope chip of a `PanelFilterBar`. */
export type PanelFilterScope = {
  /** Reported through `scope` / `onScopeChange`. */
  value: string;
  /** Chip text. */
  label: string;
  /** Shown after the label ("All 6"). */
  count?: number;
  /** Tooltip explaining the scope. */
  title?: string;
};
/** Sticky, always-open heading of a group of rows (a repository, a date). Props: `title` (required), `icon`, `count`, `meta` and `actions` (snippets). Use `PanelSection` when the user should collapse the group. */
export const PanelSectionHeader: Part;
/** Collapsible section: a chevron header line that stays visible when closed, then the body. Props: `bind:open` (default true), `title`, `icon`, `count`, `label` (snippet replacing title, icon and count), `meta` (snippet: muted text inside the toggle), `actions` (snippet after the toggle; clicks do not toggle), `onOpenChange`, `keepMounted`, `children`. Persist `open` with `host.viewState`. */
export const PanelSection: Part;
/** Stacked, collapsible, resizable areas sharing the panel height, like Git's repository list, branch and changes areas: 1px draggable dividers (keyboard: arrows, Enter resets), collapsed areas shrink to their header. Props: `areas: PanelSplitArea[]` (top to bottom), `bind:layout` (`PanelSplitLayout`, plain JSON; start from `emptyPanelSplitLayout()`, never `undefined`, and persist it with `host.viewState`), `onChange(layout)`, `area` (snippet `{ area, open, toggle, measure, overflows }`). Render each area as `<PanelSection {open} onOpenChange={toggle} keepMounted class="h-full min-h-0" bodyClass={overflows ? "min-h-0 flex-1 overflow-y-auto" : "min-h-0 flex-1 overflow-hidden"}>` with `headerPx: 32`, and put `{@attach measure}` on the body's natural-height content. Methods via `bind:this`: `toggle(id)`, `open(id)`. */
export const PanelSplit: Part;
/** One area of a `PanelSplit`. */
export type PanelSplitArea = {
  /** Stable key; also the key in `PanelSplitLayout`. */
  id: string;
  /** False keeps the area always open. Default true. */
  collapsible?: boolean;
  /** Start collapsed until the layout says otherwise. */
  defaultCollapsed?: boolean;
  /** Smallest open height in px. */
  minPx: number;
  /** Cap of the automatic height as a share (0–1) of the panel. Default 1. */
  autoMaxShare?: number;
  /** The open area with the highest value fills the rest. Default: its index (the lowest area fills). */
  fill?: number;
  /** Header height in px: the collapsed height (32 for a `PanelSection` header). */
  headerPx?: number;
  /** The automatic height may go below `minPx` for short content. */
  fitContent?: boolean;
  /** Accessible name of the divider below the area. */
  resizeLabel?: string;
};
/** Collapsed flags and dragged sizes (share 0–1) per area id; a missing entry is the default. */
export type PanelSplitLayout = {
  /** Collapsed flag per area id. */
  collapsed: Record<string, boolean>;
  /** Dragged height per area id, as a share (0–1) of the panel. */
  sizes: Record<string, number>;
};
/** A new empty `PanelSplitLayout`. */
export function emptyPanelSplitLayout(): PanelSplitLayout;
/** Container of `PanelRow`s with list semantics. Props: `ariaLabel`, `role` (`list` default, `none`). */
export const PanelList: Part;
/**
 * The row of every panel list and tree. Props: `label` (required), `onclick`, `leading` (snippet: icon or `StatusDot`), `badges`, `actions` (snippet of `PanelToolbarButton dense`, revealed on hover/focus unless `alwaysShowActions`), `description`, `labelLines` (1 or 2; `labelLines={2}` adds `detail` with `detailTone`, `trailing` and `meta` snippets), `tone` (`StatusDot` tones), `mono` (paths), `selected`, `active`, `disabled`, `dimmed`, `dense`, `indent`, `menuItems: ContextMenuItem[]` (right-click menu drawn by the host), `title` (tooltip), `editor` (snippet replacing the label for inline rename), drag events.
 */
export const PanelRow: Part;
/** A card holding one or more rows (a pull request with its checks). Props: `selected`, `menuItems`, `onclick`, `children`; put `hoverable={false}` on inner `PanelRow`s. */
export const PanelRowCard: Part;
/** Titled card inside a panel. Props: `title` (required), `icon`, `titleActions`, `meta` and `actions` (snippets), `children`. */
export const PanelCard: Part;
/**
 * Keyboard-navigable tree (files, folders of launches). Props: `nodes` (from `buildPanelTree` or `buildPanelItemTree`), `ariaLabel` (required), `onItemActivate(item)`, `expandedIds` with `onItemExpansionChange` / `onGroupExpansionChange` (controlled expansion; omit for internal state), `getItemSelected`, `getItemTone`, `getItemTitle`, `getItemMenuItems(item)` and `getGroupMenuItems(path)` (host-drawn menus), `itemLeading`, `itemBadges`, `itemActions`, `groupActions` (snippets), `itemMono`, `virtualized` (large trees; it then owns the scroll region), `multiselectable`, drag handlers.
 */
export const PanelTree: Part;
/** Node of a `PanelTree`: an item (your value) or a generated folder group. */
export type PanelTreeNode<T> =
  | {
      /** One of your items. */
      kind: "item";
      /** Node id, used by `expandedIds`. */
      id: string;
      /** Text shown. */
      label: string;
      /** Labels from the root down to this node. */
      path: readonly string[];
      /** Your item. */
      value: T;
      /** Nested nodes. */
      children: readonly PanelTreeNode<T>[];
      /** Shows a disclosure before lazy children are loaded. */
      expandable?: boolean;
    }
  | {
      /** A folder generated from shared path segments. */
      kind: "group";
      /** Node id, used by `expandedIds`. */
      id: string;
      /** Folder name. */
      label: string;
      /** Segments from the root down to this folder. */
      path: readonly string[];
      /** Nested nodes. */
      children: readonly PanelTreeNode<T>[];
    };
/** Tree from path segments (`["src", "lib", "a.ts"]`): items are leaves, shared prefixes become folder groups. */
export function buildPanelTree<T>(
  items: readonly T[],
  options: {
    getPath: (item: T) => readonly string[];
    getKey: (item: T, index: number) => string;
    compareLabels?: (left: string, right: string) => number;
  },
): PanelTreeNode<T>[];
/** Tree from parent keys: items nest under their parent item. */
export function buildPanelItemTree<T>(
  items: readonly T[],
  options: {
    getKey: (item: T) => string;
    getParentKey: (item: T) => string | undefined;
    getLabel: (item: T) => string;
    isExpandable?: (item: T) => boolean;
  },
): PanelTreeNode<T>[];
/** Empty, loading or unavailable state of a panel. Props: `title` (required), `description`, `icon`, `action` (snippet with one small `Button`). */
export const PanelEmpty: Part;

// ── Pages ──────────────────────────────────────────────────────────────────
// A page is built like Nerve's settings pages: `PageView` > `PageHeader` > `PageSection`s of `FieldRow`/`ToggleRow` or a `PageList` of `PageItem`s.

/** Root of a page: fills the tab, owns the scroll region and centres the content column. Props: `width` (`default` 46rem, `wide` 72rem, `full`), `children`. */
export const PageView: Part;
/** Title block of a page. Props: `title` (required), `description`, `actions` (snippet of buttons), `below` (snippet: `Tabs.List`, a `SearchInput`), `parent` (`{ label, onBack }`: breadcrumb back to a list, for a detail view), `leading` (the item's mark in detail view). */
export const PageHeader: Part;
/** Titled group on a card surface. Props: `title`, `description`, `actions`, `labels`, `titleHint`, `beforeBody`, `footer` (snippets), `divided` (hairlines between `FieldRow`s; use it for settings forms), `surface` (default true; false when the body is a `PageList`), `id`, `bodyClass`, `children`. */
export const PageSection: Part;
/** Label, description and control on one line (stacked when narrow). Props: `label`, `description`, `htmlFor` (the control's id), `layout` (`inline` default, `stacked`, `responsive`), `control` (snippet: `Input`, `SelectField`, `Button`), `badges`, `hint` (snippets), `mono`, `children` (full-width content under it). */
export const FieldRow: Part;
/** `FieldRow` with a switch. Props: `label` (required), `description`, `bind:checked`, `disabled`, `onCheckedChange`, `badges`. */
export const ToggleRow: Part;
/** Card list of `PageItem`s; put it in a `PageSection surface={false}`. Props: `ariaLabel`. */
export const PageList: Part;
/** Entry of a `PageList` (an integration, a rule, a profile). Props: `title` (required), `icon` or `leading`, `summary` (one line), `mono`, `problem` with `problemAction` (`{ label, onclick }`), `bind:checked` with `onCheckedChange` and `switchLabel` (adds a switch), `always`, `disabled`, `lockedBy`, `onOpen` and `openLabel` (row opens a detail), `badges`, `meta`, `actions`, `children`, `compact`, `muted`. */
export const PageItem: Part;
/** Empty state of a page or section. Props: `title` (required), `description`, `icon`, `variant` (`plain` default, `card`: dashed box), `actions` (snippet). */
export const PageEmptyState: Part;
/** Grid of labelled values (counts, sizes, versions). Props: `items: PageStat[]` (labels must be unique). */
export const PageStatGrid: Part;
/** One value of a `PageStatGrid`; `wide` spans two columns. */
export type PageStat = {
  /** Caption above the value. */
  label: string;
  /** One line; the full text is in its tooltip. */
  value: string;
  /** Spans both columns. */
  wide?: boolean;
  /** Paths and identifiers. */
  mono?: boolean;
};

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
