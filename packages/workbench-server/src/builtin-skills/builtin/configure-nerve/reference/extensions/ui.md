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

A frame has no network and no direct file access. Everything goes through `host` (`reference/extensions/api/extension-sdk/ui/host.d.ts`), whose doc comments say which contribution kinds may make each call and its limits; a call from the wrong kind fails with `not_allowed`.

- Fetch remote data through a backend method with `host.call`.
- Hidden tabs and panels unload their frame, so save what must survive ("Keeping state" below).
- Copy with `host.clipboard.writeText` / `writeImage` from a click handler; outside one the host refuses with `not_allowed`.
- Start a conversation with `host.conversations.start({ prompt, title?, model?, agentProfile?, permissionRuleSet?, send?, open? })` from a click handler. Declare `permissions.capabilities: ["conversations.start"]`; `model`, `agentProfile` and `permissionRuleSet` name this extension's own settings of that type (unset: Nerve's default). `send: false` leaves the prompt unsent in the new conversation's composer.
- Bytes travel as base64, so prefer text methods and range reads for large files.

## Keeping state

| Store                 | For                                               | Scope and limits                                                                                                                   |
| --------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `host.viewState`      | Small UI state of one tab (scroll, selection)     | This tab or panel; 64 KiB; kept in the app, dropped with old tabs                                                                  |
| `host.extensionStore` | The extension's data (documents, drawings, cache) | This extension in this project, shared by all its frames and its backend (`ctx.extensionStore`); kept by the daemon; 4 MiB per key |

Every `extensionStore` key has a `revision`. Writes are last-write-wins unless you pass `ifRevision` (`0`: only if the key does not exist); a stale one fails with `conflict`, so read again, merge and retry. Other frames of the extension get `host.onExtensionStoreChange`; reload the key there instead of overwriting it.

The host never migrates or clears stored data. Put a version in values you may reshape, and upgrade on read:

```ts
const { value, revision } = await host.extensionStore.get("board");
const board = value?.schemaVersion === 2 ? value : upgradeBoard(value);
```

## Editing in previews

`edit` on a preview chooses how the user edits the file:

- `"source"` (default for text): Nerve's source editor; the preview re-renders from the saved file. Prefer this.
- `"custom"`: the frame edits and writes with `host.file.write`, following the `mode` store. It is shown to the user as broad access, so use it only when the format needs a real editor. Write the whole new content and let the host own saving and the dirty state.
- `"none"` (default for binary files): no edit toggle.

A custom-edit preview, reduced to the parts that matter:

```svelte
<script lang="ts">
import { Button, host, mode } from "@nervekit/extension-sdk/ui";

let text = $state("");
let dirty = $state(false);

async function load() {
  text = await host.file.text();
  dirty = false;
}

$effect(() => {
  void load();
  // Keep unsaved edits when the file changes on disk.
  return host.onFileChange(() => {
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

Use the components from `@nervekit/extension-sdk/ui` (`reference/extensions/api/extension-sdk/ui/components.d.ts`) and icons from `@nervekit/extension-sdk/icons` (the lucide set: `import { Copy } from "@nervekit/extension-sdk/icons"`), so frames look like the rest of Nerve.

- Use theme-token utilities, never fixed colors, so frames follow every theme: `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-hover`, `text-destructive`, `text-success`, `text-ui`.
- Fill the frame (`h-screen`, `min-h-0 flex-1 overflow-auto`); the host draws the tab title, close button and panel header.
- Put the actions of a page, preview or panel in floating toolbars, like Nerve's own viewers. They stay out of the content and keep every extension consistent ("Floating toolbars" below).
- Show loading, empty and error states. Use mono type only for code and paths.
- Keep heavy libraries behind dynamic `import()`.

## Floating toolbars

Page-level actions, readouts, find fields and pane notices float over the content in a `FloatingLayer`. Exact props: the `Floating*` entries of `components.d.ts`.

```svelte
<div class="relative h-screen">
  <div class="h-full overflow-auto"><!-- content --></div>
  <FloatingLayer>
    {#snippet topEnd()}
      <FloatingToolbar label="Board actions">
        <FloatingToolbarGroup>
          <FloatingToolbarButton
            label="Find"
            shortcut="Ctrl+F"
            icon={Search}
            pressed={findOpen}
            onclick={() => (findOpen = !findOpen)}
          />
          <FloatingToolbarButton
            label="Export"
            icon={Download}
            onclick={exportBoard}
          />
          <FloatingToolbarMenu
            items={[{ id: "reset", label: "Reset board", destructive: true }]}
            onSelect={runMenu}
          />
        </FloatingToolbarGroup>
      </FloatingToolbar>
      {#if findOpen}
        <FloatingPanel
          label="Find"
          role="search"
          size="sm"
          onClose={() => (findOpen = false)}
        >
          <Input placeholder="Find" bind:value={query} />
        </FloatingPanel>
      {/if}
    {/snippet}
  </FloatingLayer>
</div>
```

- Anchors by meaning: `topStart` what the view shows (view choice, size readout); `topEnd` actions on the content, with a `FloatingPanel` stacked under its bar; `bottomEnd` zoom and fit as an icon-only `orientation="vertical"` bar, with a changing zoom level in a separate one-button bar beside it; `bottomStart` `FloatingNotice`s.
- Every bar button is a `FloatingToolbarButton` with a `label` (its tooltip); toggles use `pressed`; readouts use `FloatingToolbarText`; groups draw the dividers.
- Keep 4–8 controls per bar and put the rest in `FloatingToolbarMenu`, which opens `host.ui.showMenu`.
- Fields go only in a `FloatingPanel`.
- Enter, exit and resize motion is built in; add none.

## Not allowed in frames

The build fails with a fix for imports that cannot work inside a frame rectangle:

| Not allowed                 | Use                                       |
| --------------------------- | ----------------------------------------- |
| Dialog, alert dialog        | `host.ui.confirm(...)`, or an inline form |
| Sheet                       | A pane or collapsible section             |
| Context menu, dropdown menu | `host.ui.showMenu(items, { x, y })`       |
| Sonner or other toasts      | `host.ui.notify(message, level)`          |

Also unavailable: network (`fetch`, WebSocket), top navigation, popups, `<form>` submission (the frame is sandboxed without `allow-forms`, so `onsubmit` never fires: use `onclick` and `onkeydown` handlers), and anything outside the frame's rectangle. `Select` and `Tooltip` work but are clipped to the frame.

The frame's origin is opaque, so `localStorage`, `IndexedDB`, cookies and `navigator.clipboard` fail: use `host.extensionStore` and `host.clipboard`. Runtime `<style>` elements, inline `style` attributes, workers and WebAssembly work.

## Libraries and assets

Assets come only from the frame's own folder, so bundle everything a library would download:

- Import a file's URL with `?url` (`import font from "./Virgil.woff2?url"`), many with `import.meta.glob("/node_modules/<pkg>/fonts/**/*.woff2", { query: "?url", import: "default", eager: true })` (paths starting with `/` are relative to the extension folder).
- Files in `public/` are copied as they are into every frame; refer to them relatively (`./fonts/x.woff2`).
- Workers: `new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })`.
- A library that fetches assets from a CDN usually has an asset-path setting; point it at bundled files.

A frame is at most 32 MiB; leave out what the feature does not need (large font sets, unused locales).

React components: install `react` and `react-dom`, and use a `.tsx` entry whose default export mounts and returns the cleanup. `host` works the same; follow the theme with `themeKind.subscribe`.

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

`createFakeBridge` (`reference/extensions/api/extension-sdk/ui/testing.d.ts`) answers `host` like Nerve, with the same checks:

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
