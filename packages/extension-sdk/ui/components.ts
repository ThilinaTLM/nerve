// The UI kit components that work inside a frame. Dialogs, sheets, context and dropdown menus and
// toasts do not (a frame cannot draw outside its rectangle); `nerve-ext build` rejects them and
// points at `host.ui.confirm`, `host.ui.showMenu` and `host.ui.notify`.
import { setItemMenuRenderer } from "@nervekit/ui-kit/components/composites/item-menu";
import ItemMenu from "./item-menu.svelte";

// Context menus of panel rows, trees and cards open through the host.
setItemMenuRenderer(ItemMenu);

export { cn } from "@nervekit/ui-kit";

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
export * as Select from "@nervekit/ui-kit/components/ui/select";
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
export { default as SelectField } from "@nervekit/ui-kit/components/composites/select-field";
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
// outside a frame, so it opens `host.ui.showMenu` instead.
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
