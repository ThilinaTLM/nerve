import type { ContextMenuItem } from "../context-menu-list/index.js";

/** One selectable entry of a flattened menu. */
export type FlatMenuItem = {
  label: string;
  disabled: boolean;
  destructive: boolean;
  onSelect?: () => void;
};

/**
 * Flattens menu items for hosts that draw a plain list (an extension frame's
 * `host.ui.showMenu`): submenu entries become `Parent › Child` and inherit a
 * disabled parent; separators and labels are dropped.
 */
export function flattenMenuItems(
  entries: readonly ContextMenuItem[],
): FlatMenuItem[] {
  const flat: FlatMenuItem[] = [];
  const visit = (
    list: readonly ContextMenuItem[],
    prefix: string,
    parentDisabled: boolean,
  ) => {
    for (const entry of list) {
      if (entry.type === "separator" || entry.type === "label") continue;
      if (entry.type === "submenu") {
        visit(
          entry.items,
          `${prefix}${entry.label} › `,
          parentDisabled || entry.disabled === true,
        );
        continue;
      }
      flat.push({
        label: `${prefix}${entry.label}`,
        disabled: parentDisabled || entry.disabled === true,
        destructive: entry.destructive === true,
        ...(entry.onSelect ? { onSelect: entry.onSelect } : {}),
      });
    }
  };
  visit(entries, "", false);
  return flat;
}
