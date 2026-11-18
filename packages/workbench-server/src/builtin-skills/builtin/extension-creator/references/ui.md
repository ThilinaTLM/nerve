# UI: previews, pages, panels

Previews, pages and panels are Svelte 5 frames. The build compiles each `entry` with Vite and Tailwind into `dist/ui/<id>/`. Themes are data (`themes.md`). Declare them under `ui` in `defineExtension`:

```ts
ui: {
  previews: [{ id: "table", label: "Table", match: { extensions: [".csv", ".tsv"] }, entry: "src/ui/table.svelte" }],
  pages: [{ id: "overview", label: "Overview", icon: "layout-dashboard", entry: "src/ui/overview.svelte" }],
  panels: [{ id: "checklist", label: "Checklist", icon: "list-checks", entry: "src/ui/checklist.svelte" }],
}
```

A project is always open: user extensions contribute to every project, project extensions to their own. A frame has no network; fetch remote data through a backend method with `host.call`.

## Previews

`match.extensions` are lower-case with the dot (at most 32). `edit` chooses editing:

| `edit`                        | Edit mode                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `"source"` (default for text) | Nerve's source editor; the preview re-renders from the saved file.                                                                                                 |
| `"custom"`                    | The frame edits and writes with `host.file.write`; follow the `mode` store. Shown to the user as broad access, so use it only when the format needs a real editor. |
| `"none"`                      | No edit toggle (default for binary files).                                                                                                                         |

Read with `host.file.text()` or `host.file.bytes()` (chunked) and reload on `host.onFileChange`. Keep reading on demand for large files with `host.file.read({ offset, length })`. In custom edit mode, write the whole new content and let the host own saving and the dirty state.

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

## Bridge API

Every request is validated against the contribution that owns the frame. The names below are the bridge methods.

| Bridge method                    | `host` API                                                                      | Frames                         |
| -------------------------------- | ------------------------------------------------------------------------------- | ------------------------------ |
| `file.info`                      | `host.file.info()`                                                              | previews                       |
| `file.read`                      | `host.file.read({ offset?, length? })`, `host.file.bytes()`, `host.file.text()` | previews                       |
| `file.write`                     | `host.file.write(content)`                                                      | previews with `edit: "custom"` |
| `mode.get`                       | `host.mode.get()`, `mode` store                                                 | previews with `edit: "custom"` |
| `call`                           | `host.call("<namespace>.<method>", args)`                                       | all                            |
| `settings.get`                   | `host.settings.get()` (non-secret values)                                       | all                            |
| `viewState.get`, `viewState.set` | `host.viewState.get()`, `host.viewState.set(json)`                              | all                            |
| `ui.confirm`                     | `host.ui.confirm({ title, message?, destructive? })`                            | all                            |
| `ui.showMenu`                    | `host.ui.showMenu(items, position?)`                                            | all                            |
| `ui.notify`                      | `host.ui.notify(message, level?)`                                               | all                            |
| `openFile`                       | `host.openFile(path)`                                                           | all                            |
| `openPage`                       | `host.openPage(id, params?)`                                                    | all                            |
| `project.info`                   | `host.project.info()`                                                           | all                            |
| `composer.insert`                | `host.composer.insert(text)`                                                    | all                            |

Events: `host.onThemeChange` (tokens are already applied), `host.onFileChange` and `host.onModeChange` (previews). `host.pageParams` holds the `params` a page was opened with. Failures throw `BridgeError` with a `code`: `invalid_request`, `not_allowed`, `unknown_method`, `not_found`, `too_large`, `cancelled`, `backend_error`, `failed`.

Limits: message 8 MiB, one `file.read` chunk 1 MiB (256 KiB default), one `file.write` 5 MiB, `viewState` 64 KiB, `call` args 1 MiB, page `params` 4 KiB, menu 32 items, text 20,000 characters. Bytes travel as base64, so prefer text methods and range reads. A frame must save state with `viewState` (hidden tabs and panels unload their frame).

## Components and look and feel

Import components from `@nervekit/extension-sdk/ui`: `Button`, `buttonVariants`, `Badge`, `badgeVariants`, `Input`, `Textarea`, `Label`, `Checkbox`, `Switch`, `Skeleton`, `Spinner`, `Kbd`, `Separator`, `Progress`, `ScrollArea`, `Tabs`, `Select`, `Tooltip`, `Collapsible`, `Empty`, `RadioGroup`, `ToggleGroup`, `Resizable`, `Callout`, `GroupLabel`, `IconAction`, `SearchInput`, `StatusDot`, `ProgressRing`, `ScrollRegion`, plus `cn`. Icons: `@lucide/svelte`.

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

`createFakeBridge` from `@nervekit/extension-sdk/testing` answers `host` like Nerve, with the same checks (a panel calling `host.file.info()` fails with `not_allowed`):

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

Options: `kind`, `id`, `edit`, `mode`, `themeKind`, `file`, `settings`, `viewState`, `project`, `call`, `confirm`, `menu`, `pageParams`. Assert on `bridge.requests`, `notifications`, `opened`, `composerText`. Mount components with Svelte's `mount` in the Vitest DOM environment (see `examples/csv-preview/test/table.spec.ts`).
