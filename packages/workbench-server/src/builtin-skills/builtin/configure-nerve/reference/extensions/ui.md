# UI: previews, pages, panels

Exact signatures: `reference/extensions/api.md`. This page explains how frames work and what is easy to get wrong.

Previews, pages and panels are Svelte 5 frames. The build compiles each `entry` with Vite and Tailwind into `dist/ui/<id>/`. Themes are data (`reference/extensions/themes.md`). Declare them under `ui` in `defineExtension`:

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
- Save frame state with `host.viewState`: hidden tabs and panels unload their frame.
- Bytes travel as base64, so prefer text methods and range reads for large files.

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

Use the components from `@nervekit/extension-sdk/ui` (`reference/extensions/api/extension-sdk/ui/components.d.ts`) and icons from `@lucide/svelte`, so frames look like the rest of Nerve.

- Use theme-token utilities, never fixed colors, so frames follow every theme: `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-hover`, `text-destructive`, `text-success`, `text-ui`.
- Fill the frame (`h-screen`, `min-h-0 flex-1 overflow-auto`); the host draws the tab title, close button and panel header.
- Show loading, empty and error states. Use mono type only for code and paths.
- Keep heavy libraries behind dynamic `import()`.

## Not allowed in frames

The build fails with a fix for imports that cannot work inside a frame rectangle:

| Not allowed                 | Use                                       |
| --------------------------- | ----------------------------------------- |
| Dialog, alert dialog        | `host.ui.confirm(...)`, or an inline form |
| Sheet                       | A pane or collapsible section             |
| Context menu, dropdown menu | `host.ui.showMenu(items, { x, y })`       |
| Sonner or other toasts      | `host.ui.notify(message, level)`          |

Also unavailable: network (`fetch`, WebSocket), top navigation, popups, `<form>` submission (the frame is sandboxed without `allow-forms`, so `onsubmit` never fires: use `onclick` and `onkeydown` handlers), and anything outside the frame's rectangle. `Select` and `Tooltip` work but are clipped to the frame.

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
