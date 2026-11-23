import type { ExtensionIconComponent } from "./extension-icons";

let loaded: Promise<Record<string, ExtensionIconComponent>> | undefined;

/**
 * Resolves the lucide icons a frame named in a menu or picker, loading the icon set on first use.
 * A name outside the set is absent from the result: the entry is drawn without an icon.
 */
export async function resolveMenuIcons(
  names: Iterable<string>,
): Promise<Map<string, ExtensionIconComponent>> {
  const wanted = new Set(names);
  const resolved = new Map<string, ExtensionIconComponent>();
  if (wanted.size === 0) return resolved;
  loaded ??= import("./menu-icons").then((module) => module.menuIcons);
  const icons = await loaded;
  for (const name of wanted) {
    const icon = Object.hasOwn(icons, name) ? icons[name] : undefined;
    if (icon) resolved.set(name, icon);
  }
  return resolved;
}
