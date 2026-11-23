// The UI kit components that work inside a frame; their declarations are generated from the sources
// below (`scripts/components-dts.mjs`). A frame cannot draw outside its rectangle, so what needs to
// is not exported: `frameForbidden` in `src/ui-build.ts` lists those imports (`nerve-ext build`
// rejects them and names `host.ui.confirm`, `host.ui.menu`, `host.ui.pick` or `host.ui.notify`).
import { setItemMenuRenderer } from "@nervekit/ui-kit/components/composites/item-menu";
import ItemMenu from "./item-menu.svelte";

// Context menus of panel rows, trees and cards open through the host.
setItemMenuRenderer(ItemMenu);

export { cn } from "@nervekit/ui-kit";

// Types of component props, from the module that defines them.
export type { SelectItem } from "@nervekit/ui-kit/components/composites/select-field";
export type { RadioItem } from "@nervekit/ui-kit/components/composites/radio-group-field";
export type { CommandItem } from "@nervekit/ui-kit/components/composites/popover-panel";
export type {
  ContextMenuItem,
  PanelTreeNode,
} from "@nervekit/ui-kit/components/composites/panel";
export type { PanelFilterScope } from "@nervekit/ui-kit/components/composites/panel-filter-bar";
export type {
  PanelSplitArea,
  PanelSplitLayout,
} from "@nervekit/ui-kit/components/composites/panel-split";
export type { PageStat } from "@nervekit/ui-kit/components/composites/page";

export { Button, buttonVariants } from "@nervekit/ui-kit/components/ui/button";
export { Badge, badgeVariants } from "@nervekit/ui-kit/components/ui/badge";
export { Input } from "@nervekit/ui-kit/components/ui/input";
export { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
export { Label } from "@nervekit/ui-kit/components/ui/label";
export { Checkbox } from "@nervekit/ui-kit/components/ui/checkbox";
export { Switch } from "@nervekit/ui-kit/components/ui/switch";
export { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
export { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
export { Kbd } from "@nervekit/ui-kit/components/ui/kbd";
export { Separator } from "@nervekit/ui-kit/components/ui/separator";
export { Progress } from "@nervekit/ui-kit/components/ui/progress";
export { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
// Multi-part components: `<Tabs.Root><Tabs.List>…`.
export * as Tabs from "@nervekit/ui-kit/components/ui/tabs";
export * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
export * as Collapsible from "@nervekit/ui-kit/components/ui/collapsible";
export * as Empty from "@nervekit/ui-kit/components/ui/empty";
export * as RadioGroup from "@nervekit/ui-kit/components/ui/radio-group";
export * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
export * as Resizable from "@nervekit/ui-kit/components/ui/resizable";
// Composites.
export { Callout } from "@nervekit/ui-kit/components/composites/callout";
export { GroupLabel } from "@nervekit/ui-kit/components/composites/group-label";
export { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
export { SearchInput } from "@nervekit/ui-kit/components/composites/search-input";
export { StatusDot } from "@nervekit/ui-kit/components/composites/status-dot";
export { ProgressRing } from "@nervekit/ui-kit/components/composites/progress-ring";
export { ScrollRegion } from "@nervekit/ui-kit/components/composites/scroll-region";
// Opens the host's picker (`host.ui.pick`): the UI kit's own list would be clipped to the frame.
export { default as SelectField } from "./select-field.svelte";
export { default as SwitchField } from "@nervekit/ui-kit/components/composites/switch-field";
export { default as RadioGroupField } from "@nervekit/ui-kit/components/composites/radio-group-field";
export { VirtualScroller } from "@nervekit/ui-kit/components/composites/virtual-list";
export { PopoverCommandList as CommandList } from "@nervekit/ui-kit/components/composites/popover-panel";
// Panels: the dock-panel patterns of Nerve's own panels (Git, Files, Launches).
export {
  PanelView,
  PanelHeader,
  PanelToolbarButton,
  PanelSectionHeader,
  PanelList,
  PanelRow,
  PanelRowCard,
  PanelCard,
  PanelTree,
  PanelEmpty,
  buildPanelTree,
  buildPanelItemTree,
} from "@nervekit/ui-kit/components/composites/panel";
export { PanelFilterBar } from "@nervekit/ui-kit/components/composites/panel-filter-bar";
export { PanelSection } from "@nervekit/ui-kit/components/composites/panel-section";
export {
  PanelSplit,
  emptyPanelSplitLayout,
} from "@nervekit/ui-kit/components/composites/panel-split";
// Pages: the layout of Nerve's settings and overview pages.
export {
  PageView,
  PageHeader,
  PageSection,
  FieldRow,
  ToggleRow,
  PageList,
  PageItem,
  PageEmptyState,
  PageStatGrid,
} from "@nervekit/ui-kit/components/composites/page";
// Floating toolbars. `FloatingToolbarMenu` is the SDK's own: the UI kit's dropdown menu cannot draw
// outside a frame, so it opens `host.ui.menu` instead.
export {
  FloatingLayer,
  FloatingToolbar,
  FloatingToolbarGroup,
  FloatingToolbarButton,
  FloatingToolbarText,
  FloatingPanel,
  FloatingNotice,
} from "@nervekit/ui-kit/components/composites/floating-toolbar";
export { default as FloatingToolbarMenu } from "./floating-toolbar-menu.svelte";
