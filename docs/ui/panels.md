# Panel views

Panel content (Conversations, Git, Context, Notes, Tasks, extension panels) is built from `@nervekit/ui-kit` primitives, not hand-rolled markup. Import each from `@nervekit/ui-kit/components/composites/<name>`.

| Primitive                                                         | Module             | Use for                                                                                                                           |
| ----------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `PanelView`, `PanelHeader`, `PanelToolbarButton`                  | `panel`            | Panel root, the pinned title line (title, optional count, icon actions), and its icon buttons.                                    |
| `PanelFilterBar`                                                  | `panel-filter-bar` | Search field and/or scope chips (`All 6 / Changed 0`) directly under the `PanelHeader`.                                           |
| `PanelSection`                                                    | `panel-section`    | Collapsible section: chevron toggle with label/count/meta, trailing actions, body.                                                |
| `PanelSplit`                                                      | `panel-split`      | Collapsible areas sharing the panel height with draggable dividers (Git's list, branch, changes).                                 |
| `PanelSectionHeader`                                              | `panel`            | Static, always-expanded group heading.                                                                                            |
| `PanelList`, `PanelRow`, `PanelRowCard`, `PanelCard`, `PanelTree` | `panel`            | Lists, rows, cards, and trees of items.                                                                                           |
| `PanelEmpty`, `Callout layout="strip"`                            | `panel`, `callout` | Empty states and inline banners.                                                                                                  |
| `ItemSurface`                                                     | `item-surface`     | The shared card/row surface behind rows and cards.                                                                                |
| `ItemMenu`, `setItemMenuRenderer`                                 | `item-menu`        | Context menu for an item. Rows, trees, cards, and surfaces use it via `menuItems`; never wrap them in `ContextMenuList` directly. |

- A panel view's root is `PanelView`. It owns the height, the sticky toolbar, and the banner slot; its content owns the one scroll region (a `ScrollArea`, `VirtualScroller`, `PanelTree virtualized`, or the areas of a `PanelSplit`). Views must not manage their own `h-full`/`overflow`/padding frame or add a second scroll container.
- Views are movable between the left, right, and bottom docks, so a view may not assume its width, orientation, or which dock hosts it. Use the container width (not the dock id) when adapting layout.
- Every panel starts with one static `PanelHeader`, rendered in `PanelView`'s pinned `banner` slot.
- A panel may add one `PanelFilterBar` below its header when its items are searchable or have a few mutually exclusive scopes. Use it instead of a bespoke `SearchInput` + `ToggleGroup` block; no sub-tab toolbars.
- A panel may use collapsible `PanelSection`s when the content has independent regions that users want to fold away (Git's branch and changes). Otherwise group with static `PanelSectionHeader`s. Keep the header line visible when collapsed, and keep trailing actions outside the toggle.
- Sections are flat: no bordered cards, no radius, no nested panels.
- Item menus go through `ItemMenu` only, so they work where bits-ui menus cannot render (extension frames, which register their own renderer with `setItemMenuRenderer`).
