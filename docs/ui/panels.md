# Panel views

Dock panel content in `packages/workbench-app` (Conversations, Git, Context, Notes, Tasks) must be built from the `$lib/presentation/panels` primitives — `PanelView`, `PanelHeader`, `PanelToolbarButton`, `PanelSectionHeader`, `PanelList`, `PanelRow`, `PanelTree`, `Callout layout="strip"`, `PanelEmpty`.

- A panel view's root is `PanelView`. It owns the height, the sticky toolbar, and the banner slot; its content owns the one scroll region (a `ScrollArea`, `VirtualScroller`, or `PanelTree virtualized`). Views must not manage their own `h-full`/`overflow`/padding frame or add a second scroll container.
- Views are movable between the left, right, and bottom docks, so a view may not assume its width, orientation, or which dock hosts it. Use the container width (not the dock id) when adapting layout.
- Every panel starts with one static `PanelHeader` (title, optional count, trailing icon actions) rendered in `PanelView`'s pinned `banner` slot.
- Panels stay simple and consistent: no sub-tab toolbars, no panel search inputs, and no collapsible sections. Group content with static `PanelSectionHeader` headings that are always expanded.
- Sections are flat: no bordered cards, no radius, no nested panels.
