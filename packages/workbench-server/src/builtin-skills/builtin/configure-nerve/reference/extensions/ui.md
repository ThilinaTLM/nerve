# UI: previews, pages, panels

Exact signatures: `reference/extensions/api.md`. This page explains how frames work and what is easy to get wrong.

Previews, pages and panels are browser frames, written as a Svelte 5 component (`.svelte`) or a module whose default export mounts into an element (`.ts`, `.tsx`). The build compiles each `entry` with Vite and Tailwind into `dist/ui/<id>/`, with the extension folder as Vite's root. Themes are data (`reference/extensions/themes.md`). Declare them under `ui` in `defineExtension`:

```ts
ui: {
  previews: [{ id: "table", label: "Table", match: { extensions: [".csv", ".tsv"] }, entry: "src/previews/table/Table.svelte" }],
  pages: [{ id: "overview", label: "Overview", icon: "layout-dashboard", entry: "src/pages/overview/Overview.svelte" }],
  panels: [{ id: "checklist", label: "Checklist", icon: "list-checks", entry: "src/panels/checklist/Checklist.svelte" }],
}
```

- **Preview**: renders files of the listed extensions in place of the source view.
- **Page**: a tab not tied to a file, listed in the new-tab menu (the chevron next to +) unless `newMenu: false`.
- **Panel**: a dock panel beside the conversation.

A project is always open: user extensions contribute to every project, project extensions to their own.

## Talking to Nerve

A frame has no network and no direct file access. Everything goes through `host` (`reference/extensions/api/extension-sdk/frame/host.d.ts`), whose doc comments say which contribution kinds may make each call and its limits; a call from the wrong kind fails with `not_allowed`.

- Fetch remote data through a backend method with `host.backend.call`.
- Hidden tabs and panels unload their frame, so save what must survive ("Keeping state" below).
- Copy with `host.clipboard.writeText` / `writeImage` from a click handler; outside one the host refuses with `not_allowed`.
- Menus, pickers and dialogs are drawn by the host, outside the frame ("Host-drawn menus and pickers" below). Like copying, they need a click or key press in the frame: `host.ui.menu`, `host.ui.pick` and `host.ui.confirm` refuse with `not_allowed` otherwise. Open them directly from the handler, not after a long wait.
- Start a conversation with `host.chat.startConversation({ prompt, title?, model?, agentProfile?, permissionRuleSet?, send?, open? })` from a click handler. Declare `permissions.frame: ["chat.startConversation"]`; `model`, `agentProfile` and `permissionRuleSet` name this extension's own settings of that type (unset: Nerve's default). `send: false` leaves the prompt unsent in the new conversation's composer.
- `host` is grouped by what it touches: `backend`, `pages`, `workspace`, `project`, `theme`, `mode`, `file`, `store`, `tabState`, `chat`, `clipboard`, `settings`, `ui`. `host.settings.get(key)` reads one setting (`undefined` when unset); `host.ready` resolves with the extension id, contribution and page params (`await host.pages.params()` reads them in a page). `host.mode` and `host.theme.kind` are Svelte stores: `const { mode } = host;`, then `$mode`.
- Bytes travel as base64, so prefer text methods and range reads for large files.

## Keeping state

| Store           | For                                               | Scope and limits                                                                                                          |
| --------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `host.tabState` | Small UI state of one tab (scroll, selection)     | This tab or panel; 64 KiB; kept in the app, dropped with old tabs                                                         |
| `host.store`    | The extension's data (documents, drawings, cache) | This extension in this project, shared by all its frames and its backend (`ctx.store`); kept by the daemon; 4 MiB per key |

Every `host.store` key has a `revision`. Writes are last-write-wins unless you pass `ifRevision` (`0`: only if the key does not exist); a stale one fails with `conflict`, so read again, merge and retry. Other frames of the extension get `host.store.onChange`; reload the key there instead of overwriting it.

The host never migrates or clears stored data. Put a version in values you may reshape, and upgrade on read:

```ts
const entry = await host.store.get("board"); // undefined when the key does not exist
const board =
  entry?.value.schemaVersion === 2 ? entry.value : upgradeBoard(entry?.value);
```

## Editing in previews

`edit` on a preview chooses how the user edits the file:

- `"source"` (default for text): Nerve's source editor; the preview re-renders from the saved file. Prefer this.
- `"custom"`: the frame edits and writes with `host.file.write`, following the `host.mode` store. It is shown to the user as broad access, so use it only when the format needs a real editor. Write the whole new content and let the host own saving and the dirty state.
- `"none"` (default for binary files): no edit toggle.

A custom-edit preview, reduced to the parts that matter:

```svelte
<script lang="ts">
import { Button, host } from "@nervekit/extension-sdk/ui";

const { mode } = host;

let text = $state("");
let dirty = $state(false);

async function load() {
  text = await host.file.text();
  dirty = false;
}

$effect(() => {
  void load();
  // Keep unsaved edits when the file changes on disk.
  return host.file.onChange(() => {
    if (!dirty) void load();
  });
});

async function save() {
  await host.file.write(text);
  dirty = false;
  host.ui.notify("Saved", "success");
}
</script>

{#if $mode === "edit"}
  <textarea
    class="h-full w-full bg-background text-ui"
    bind:value={text}
    oninput={() => (dirty = true)}></textarea>
  <Button size="sm" disabled={!dirty} onclick={save}>Save</Button>
{:else}
  <pre class="text-ui">{text}</pre>
{/if}
```

## Look and feel

Build every frame from Nerve's UI patterns in `reference/extensions/ui-patterns.md`: panels like the Git and Files panels, pages like the settings pages, and floating toolbars for previews and canvas-like pages. The components come from `@nervekit/extension-sdk/ui`, icons from the same entry (`import { Plus } from "@nervekit/extension-sdk/ui"`; `Badge` is the component, its icon is `BadgeIcon`). The host draws only the tab title and close button; a panel frame draws its own header (`PanelHeader`). Show loading, empty and error states.

## Host-drawn menus and pickers

A frame cannot draw outside its rectangle, so menus and choice lists are drawn by the host over the app. They carry the extension's name, show text only, and give focus back to the frame. One is open at a time (a second request fails with `cancelled`); Escape or a click elsewhere resolves `null`. `anchor` is an element of the frame (measured when you call) or a rectangle `{ x, y, width?, height? }` in the frame's CSS pixels; the host keeps the result inside the window.

```ts
// Menu: resolves the chosen item's id, or null.
const id = await host.ui.menu(
  [
    { id: "open", label: "Open", icon: "folder-open", shortcut: "Enter" },
    { id: "wrap", label: "Wrap lines", checked: wrap },
    { type: "separator" },
    { type: "label", label: "Share" },
    {
      type: "submenu",
      label: "Export",
      icon: "download",
      items: [
        { id: "csv", label: "CSV" },
        { id: "json", label: "JSON" },
      ],
    },
    { id: "delete", label: "Delete", icon: "trash-2", destructive: true },
  ],
  { anchor: button },
);

// Pick: single resolves an id, multiple resolves the ids after Apply (or Enter); null when dismissed.
const ids = await host.ui.pick({
  mode: "multiple",
  title: "Columns",
  ariaLabel: "Columns to show",
  items: columns.map((c) => ({
    id: c.key,
    label: c.name,
    group: c.table,
    detail: c.type,
    keywords: c.aliases,
  })),
  selected: visible,
  anchor: button,
});
```

- **Menu entries**: items `{ id, label, icon?, shortcut?, checked?, disabled?, destructive? }` (`shortcut` is a hint, not a binding), `{ type: "separator" }`, `{ type: "label", label }` (caption), `{ type: "submenu", label, icon?, disabled?, items }`. Limits: at most 200 entries in all (separators, labels and submenu entries count), submenus two deep, labels 1–200 characters, ids 1–128 characters and unique. Over a limit the call rejects with `BridgeError` `invalid_request` and the reason, and logs it with `console.error`: the host never cuts a menu.
- **Pick items**: `{ id, label, group?, detail?, keywords?, icon?, disabled? }`, 1–2,000 of them; `selected` lists ids chosen on open. A search field appears above 8 items.
- **Icons** are lucide names in kebab case, never markup: the host draws a fixed set of common ones and no icon for any other name: `plus`, `minus`, `check`, `x`, `copy`, `clipboard`, `scissors`, `trash-2`, `pencil`, `save`, `download`, `upload`, `external-link`, `link`, `refresh-cw`, `rotate-ccw`, `rotate-cw`, `undo-2`, `redo-2`, `search`, `filter`, `settings`, `sliders-horizontal`, `eye`, `eye-off`, `star`, `heart`, `bookmark`, `flag`, `pin`, `tag`, `folder`, `folder-open`, `file`, `file-text`, `file-plus`, `file-code`, `image`, `play`, `pause`, `square`, `circle`, `info`, `circle-alert`, `triangle-alert`, `circle-check`, `circle-x`, `circle-help`, `bell`, `lock`, `lock-open`, `key`, `user`, `users`, `mail`, `message-square`, `send`, `share`, `git-branch`, `git-commit-horizontal`, `git-merge`, `code`, `terminal`, `table`, `list`, `list-checks`, `layout-grid`, `columns-2`, `rows-2`, `arrow-up`, `arrow-down`, `arrow-left`, `arrow-right`, `chevron-up`, `chevron-down`, `chevrons-up-down`, `arrow-up-down`, `move`, `maximize-2`, `minimize-2`, `zoom-in`, `zoom-out`, `sun`, `moon`, `palette`, `type`, `bold`, `italic`, `align-left`, `calendar`, `clock`, `history`, `archive`, `database`, `globe`, `zap`, `sparkles`, `wand-sparkles`, `bug`, `hash`, `ellipsis`.
- `SelectField` in a frame opens `host.ui.pick` (`mode: "single"`), `FloatingToolbarMenu` opens `host.ui.menu`, and the context menus of rows and trees (`menuItems`) open `host.ui.menu` with the whole tree. Rows and trees take `icon` as a lucide name string (`{ label: "Copy", icon: "copy" }`), not a component.

## Not allowed in frames

The build fails with a fix for imports that cannot work inside a frame rectangle:

| Not allowed                 | Use                                       |
| --------------------------- | ----------------------------------------- |
| Dialog, alert dialog        | `host.ui.confirm(...)`, or an inline form |
| Sheet                       | A pane or collapsible section             |
| Context menu, dropdown menu | `host.ui.menu(entries, { anchor })`       |
| Select, popover list        | `SelectField`, or `host.ui.pick(...)`     |
| Sonner or other toasts      | `host.ui.notify(message, level)`          |

Also unavailable: network (`fetch`, WebSocket), top navigation, popups, `<form>` submission (the frame is sandboxed without `allow-forms`, so `onsubmit` never fires: use `onclick` and `onkeydown` handlers), and anything outside the frame's rectangle. `Tooltip` (and the tooltips of icon buttons) work inside the frame: they flip and shift to stay in its rectangle. `CommandList` draws an inline list.

The frame's origin is opaque, so `localStorage`, `IndexedDB`, cookies and `navigator.clipboard` fail: use `host.store` and `host.clipboard`. Runtime `<style>` elements, inline `style` attributes, workers and WebAssembly work.

## Libraries and assets

Assets come only from the frame's own folder, so bundle everything a library would download:

- Import a file's URL with `?url` (`import font from "./Virgil.woff2?url"`), many with `import.meta.glob("/node_modules/<pkg>/fonts/**/*.woff2", { query: "?url", import: "default", eager: true })` (paths starting with `/` are relative to the extension folder).
- Files in `public/` are copied as they are into every frame; refer to them relatively (`./fonts/x.woff2`).
- Workers: `new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })`.
- A library that fetches assets from a CDN usually has an asset-path setting; point it at bundled files.

A frame is at most 32 MiB; leave out what the feature does not need (large font sets, unused locales).

React components: install `react` and `react-dom`, and use a `.tsx` entry whose default export mounts and returns the cleanup. `host` works the same; follow the theme with `host.theme.kind.subscribe`.

```tsx
import { createRoot } from "react-dom/client";
import { Board } from "./Board";

export default function mount(target: HTMLElement) {
  const root = createRoot(target);
  root.render(<Board />);
  return () => root.unmount();
}
```

## Tests

`createFakeBridge` (`reference/extensions/api/extension-sdk/frame/testing.d.ts`) answers `host` like Nerve, with the same checks:

```ts
const bridge = createFakeBridge({
  kind: "preview",
  edit: "custom",
  file: { path: "a.csv", content: "a,b\n1,2\n" },
});
await host.ready;
await host.file.write("a,b\n3,4\n");
expect(bridge.fileText).toBe("a,b\n3,4\n");
```

Mount components with `mount` and `unmount` from `@nervekit/extension-sdk/testing` (Svelte's, the same copy the components compile against) in the Vitest DOM environment, and wait for async loads with `vi.waitFor`. Each UI scaffold has such a test next to its component (`Table.test.ts`).
