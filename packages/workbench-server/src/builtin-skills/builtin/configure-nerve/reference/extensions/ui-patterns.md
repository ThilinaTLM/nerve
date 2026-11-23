# UI patterns

Build frames from the patterns of Nerve's own panels, settings pages and viewers. Users then already know how an extension works, and it follows every theme and density. Exact props, with a doc comment on each: `reference/extensions/api/extension-sdk/components/components.d.ts` (index; each export points at the file that types its props). Icons: lucide, from the same entry, never a separate `@lucide/svelte` install (`import { Plus } from "@nervekit/extension-sdk/ui"`; `Badge` is the component, its icon is `BadgeIcon`).

Compose these components instead of styling raw `<button>`, `<input>`, `<select>`, lists or headers. Raw elements look close but drift from Nerve's spacing, focus rings and states. Add Tailwind classes only for layout (flex, gap, width), with theme tokens (`bg-background`, `bg-card`, `bg-panel`, `text-foreground`, `text-muted-foreground`, `border-border`, `text-destructive`, `text-success`, `text-ui`), never fixed colors.

## Panel (a dock panel, like Git, Files and Launches)

The frame draws the whole panel, header included; the host adds nothing around it.

```svelte
<PanelView>
  {#snippet banner()}
    <PanelHeader title="Deployments" count={items.length}>
      {#snippet trailing()}
        <PanelToolbarButton
          icon={RefreshCw}
          label="Refresh"
          loading={busy}
          onclick={refresh}
        />
      {/snippet}
    </PanelHeader>
    <PanelFilterBar
      bind:query
      bind:scope
      placeholder="Filter deployments"
      ariaLabel="Filter deployments"
      scopes={[
        { value: "all", label: "All", count: items.length },
        { value: "failed", label: "Failed", count: failed.length },
      ]}
    />
  {/snippet}
  {#if shown.length === 0}
    <PanelEmpty
      title="No deployments"
      description="Deploy a service to see it here."
    />
  {:else}
    <ScrollArea class="min-h-0 flex-1">
      <PanelList ariaLabel="Deployments">
        {#each shown as item (item.id)}
          <PanelRow
            label={item.name}
            description={item.env}
            selected={item.id === selectedId}
            onclick={() => select(item)}
            menuItems={menuFor(item)}
          >
            {#snippet leading()}<StatusDot
                tone={item.ok ? "success" : "destructive"}
              />{/snippet}
            {#snippet actions()}<PanelToolbarButton
                dense
                icon={Play}
                label="Redeploy"
                onclick={() => redeploy(item)}
              />{/snippet}
          </PanelRow>
        {/each}
      </PanelList>
    </ScrollArea>
  {/if}
</PanelView>
```

- Start every panel with one `PanelHeader`: title, count, then at most three icon actions. Put further actions behind a `PanelToolbarButton` (`Ellipsis` icon) whose click opens `host.ui.menu(entries, { anchor: event.currentTarget })`.
- Filtering: one `PanelFilterBar` under the header (search, scope chips with counts, or both). The panel filters its own rows.
- Rows: `PanelRow` in a `PanelList`, nested data in `PanelTree` (`buildPanelTree` for paths, `buildPanelItemTree` for parent keys), multi-row items in `PanelRowCard`. Row actions show on hover; secondary ones go in `menuItems`, which the host draws on right click.
- Groups: `PanelSectionHeader` for static headings, `PanelSection` when the user collapses groups, `PanelSplit` when several collapsible areas share the height with draggable dividers (Git's repository list, branch, changes). Persist `open` and the split `layout` with `host.tabState`; start `layout` from `emptyPanelSplitLayout()` or the saved value, never `undefined`:

  ```svelte
  <PanelSplit
    areas={[
      { id: "jobs", minPx: 64, headerPx: 32 },
      { id: "logs", minPx: 96, headerPx: 32 },
    ]}
    bind:layout
  >
    {#snippet area({ area, open, toggle, measure, overflows })}
      <PanelSection
        title={area.id === "jobs" ? "Jobs" : "Logs"}
        {open}
        onOpenChange={toggle}
        keepMounted
        class="h-full min-h-0"
        bodyClass={overflows
          ? "min-h-0 flex-1 overflow-y-auto"
          : "min-h-0 flex-1 overflow-hidden"}
      >
        <div {@attach measure}><!-- rows --></div>
      </PanelSection>
    {/snippet}
  </PanelSplit>
  ```

- One scroll region: a `ScrollArea`, `PanelTree virtualized` or the areas of a `PanelSplit`; never scroll the `PanelView` itself.
- Panels can sit in any dock and at any width; adapt to the frame width, not to a dock.
- Loading, empty and error states: `PanelEmpty`, or a `Callout layout="strip"` in the banner for a problem above existing rows.

## Page (a tab: settings, dashboards, overviews)

```svelte
<PageView>
  <PageHeader title="Deployments" description="Services of this project.">
    {#snippet actions()}<Button size="sm" onclick={deployAll}>Deploy all</Button
      >{/snippet}
  </PageHeader>
  <PageSection title="Defaults" divided>
    <FieldRow
      label="Region"
      description="Where new services start."
      htmlFor="region"
    >
      {#snippet control()}<SelectField
          id="region"
          items={regions}
          bind:value={region}
        />{/snippet}
    </FieldRow>
    <ToggleRow label="Deploy on push" bind:checked={onPush} />
  </PageSection>
  <PageSection title="Services" surface={false}>
    <PageList ariaLabel="Services">
      {#each services as service (service.id)}
        <PageItem
          title={service.name}
          summary={service.url}
          onOpen={() => open(service)}
        />
      {/each}
    </PageList>
  </PageSection>
</PageView>
```

- `PageView` is the root: it owns the scroll region and centres the column (`width="wide"` or `"full"` for tables and boards).
- Settings and forms: a `PageSection divided` of `FieldRow`s (control: `Input`, `SelectField`, `Button`) and `ToggleRow`s. Choices: `SelectField` (the host draws its list, searchable above 8 items), `RadioGroupField` when each needs a description, `host.ui.pick` for several choices or a list that does not belong to a field, `CommandList` inline.
- Collections: a `PageList` of `PageItem`s in a `PageSection surface={false}`; `onOpen` leads to a detail view whose `PageHeader` has `parent={{ label, onBack }}`.
- Facts: `PageStatGrid`. Empty states: `PageEmptyState`.
- Views within a page: `Tabs` in the `below` snippet of `PageHeader`.
- Canvas-like pages (a board, a diagram) and previews have no `PageView`; they fill the frame and use floating toolbars.

## Floating toolbars (previews and canvas-like pages)

Viewer actions, readouts, find fields and pane notices float over the content in a `FloatingLayer`, like Nerve's image, Mermaid and document viewers.

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
            items={[
              { id: "fit", label: "Fit to view", icon: "maximize-2" },
              { type: "separator" },
              { id: "reset", label: "Reset board", destructive: true },
            ]}
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
          <SearchInput placeholder="Find" bind:value={query} />
        </FloatingPanel>
      {/if}
    {/snippet}
  </FloatingLayer>
</div>
```

- Anchors by meaning: `topStart` what the view shows (view choice, size readout); `topEnd` actions on the content, with a `FloatingPanel` stacked under its bar; `bottomEnd` zoom and fit as an icon-only `orientation="vertical"` bar, with a changing zoom level in a separate one-button bar beside it; `bottomStart` `FloatingNotice`s.
- Every bar button is a `FloatingToolbarButton` with a `label` (its tooltip); toggles use `pressed`; readouts use `FloatingToolbarText`; groups draw the dividers.
- Keep 4–8 controls per bar and put the rest in `FloatingToolbarMenu`.
- Fields (`SearchInput`, `Input`, `SelectField`, `CommandList`) go only in a `FloatingPanel`.
- Enter, exit and resize motion is built in; add none.

## Which component

| Need                                 | Use                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Icon-only action                     | `PanelToolbarButton` (panels), `FloatingToolbarButton` (floating bars), `IconAction` (elsewhere) |
| Text action                          | `Button` (`variant`: `default` primary, `outline`, `ghost`, `destructive`; `size="sm"` in rows)  |
| Search or filter field               | `SearchInput`; in a panel `PanelFilterBar`                                                       |
| Picker with search (command palette) | `CommandList` inline or in a `FloatingPanel`                                                     |
| Few choices                          | `SelectField`, `RadioGroupField`, `ToggleGroup` (segmented)                                      |
| On/off                               | `ToggleRow` in a page, `SwitchField` elsewhere, `Checkbox` for list selection                    |
| Menu, overflow, right click          | `host.ui.menu` (`FloatingToolbarMenu`, `menuItems` of rows)                                      |
| Long or multiple-choice list         | `host.ui.pick` (`mode: "single"` or `"multiple"`)                                                |
| Confirmation                         | `host.ui.confirm` (from a click or key handler)                                                  |
| Result of an action                  | `host.ui.notify`                                                                                 |
| Status                               | `StatusDot`, `Badge`, `ProgressRing`, `Progress`, `Spinner`, `Skeleton`                          |
| Message in the content               | `Callout` (`layout="strip"` in panels)                                                           |
| Long list                            | `VirtualScroller`, `PanelTree virtualized`                                                       |
| Side-by-side panes                   | `Resizable`                                                                                      |

Use mono type only for code, paths and ids. Keep heavy libraries behind dynamic `import()`.
