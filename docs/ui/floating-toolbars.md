# Floating toolbars

Page-level actions of a tab page or pane (image, SVG and Mermaid viewers, code find and replace, logs, launch and command output) float over the content. Build them only from the `@nervekit/ui-kit/components/composites/floating-toolbar` primitives; extension frames get the same set from `@nervekit/extension-sdk/ui`.

| Component               | Use                                                                                                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FloatingLayer`         | Placed inside the pane's `relative` box; anchors `topStart`, `topEnd`, `bottomStart`, `bottomEnd` (snippets). Each anchor stacks its items away from the edge; `class` adjusts insets (`pr-5` clears a scrollbar lane). |
| `FloatingToolbar`       | A bar: `label`, `orientation`, `reveal` (`hover` dims it until a `group/pane` ancestor is hovered).                                                                                                                     |
| `FloatingToolbarGroup`  | Related controls; draws the divider before itself. `collapse` hides it below 28rem.                                                                                                                                     |
| `FloatingToolbarButton` | Every button of a bar or panel: `label` (tooltip and name), `icon` or short `text`, `shortcut`, `pressed`, `busy`, `tone`.                                                                                              |
| `FloatingToolbarText`   | Readouts: dimensions, elapsed time, match counts.                                                                                                                                                                       |
| `FloatingToolbarMenu`   | Secondary actions (`floating-toolbar-menu`, `DropdownMenu` items). Not in frames: the SDK's version opens `host.ui.menu` with the full entries (separators, icons, checks, submenus).                                   |
| `FloatingPanel`         | Fields (find, replace, go to line): `size` `sm`/`md`/`lg`, `onClose` on Escape; rows that open use `in:rowIn out:rowOut`.                                                                                               |
| `FloatingNotice`        | Lasting pane status (unsaved changes, truncated source): `tone` `info`/`warning`, `onDismiss`.                                                                                                                          |

## Anchors

- **Top start**: what the pane shows (view choice, format and size readout).
- **Top end**: actions on the content (find, copy, download, full screen, more). A panel opened from this bar stacks under it.
- **Bottom end**: spatial navigation as an icon-only vertical bar (zoom, fit). A changing value such as the zoom level goes in its own small bar beside it, never inside the vertical bar.
- **Bottom start**: `FloatingNotice`s.

## Rules

- No custom absolutely positioned bars, hand-drawn separators or `title` tooltips on bar buttons.
- Keep 4–8 visible controls per bar; put the rest in `FloatingToolbarMenu`. `collapse` only readouts and actions that the menu also offers.
- Toggles use `pressed`; fields only inside `FloatingPanel`.
- Motion is built in (enter and exit from the anchor edge, smooth resizing, item fades) and follows the `--motion-*` tokens and reduced motion; add none of your own.
