import Provider from "./sidebar-provider.svelte";
import Group from "./sidebar-group.svelte";
import GroupLabel from "./sidebar-group-label.svelte";
import GroupContent from "./sidebar-group-content.svelte";
import GroupAction from "./sidebar-group-action.svelte";
import Menu from "./sidebar-menu.svelte";
import MenuItem from "./sidebar-menu-item.svelte";
import MenuButton from "./sidebar-menu-button.svelte";
import MenuAction from "./sidebar-menu-action.svelte";
import MenuBadge from "./sidebar-menu-badge.svelte";
import MenuSub from "./sidebar-menu-sub.svelte";
import MenuSubItem from "./sidebar-menu-sub-item.svelte";
import MenuSubButton from "./sidebar-menu-sub-button.svelte";
import Separator from "./sidebar-separator.svelte";

export { useSidebar, setSidebar, type SidebarContext } from "./context.svelte.js";

export {
  Provider,
  Group,
  GroupLabel,
  GroupContent,
  GroupAction,
  Menu,
  MenuItem,
  MenuButton,
  MenuAction,
  MenuBadge,
  MenuSub,
  MenuSubItem,
  MenuSubButton,
  Separator,
  //
  Provider as SidebarProvider,
  Group as SidebarGroup,
  GroupLabel as SidebarGroupLabel,
  GroupContent as SidebarGroupContent,
  GroupAction as SidebarGroupAction,
  Menu as SidebarMenu,
  MenuItem as SidebarMenuItem,
  MenuButton as SidebarMenuButton,
  MenuAction as SidebarMenuAction,
  MenuBadge as SidebarMenuBadge,
  MenuSub as SidebarMenuSub,
  MenuSubItem as SidebarMenuSubItem,
  MenuSubButton as SidebarMenuSubButton,
  Separator as SidebarSeparator,
};
