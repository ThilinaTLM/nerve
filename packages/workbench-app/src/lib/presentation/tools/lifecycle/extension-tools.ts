import { SvelteMap } from "svelte/reactivity";
import type { ExtensionToolView } from "@nervekit/contracts/extensions";

/** The view of a tool that declares none: the first argument as header, the output as text. */
const DEFAULT_VIEW: ExtensionToolView = {
  sections: [{ id: "result", type: "text" }],
};

/**
 * The direct tools extensions contribute, with the view each declares, from
 * the host's tool list (`ToolDescriptor.extension` and `view`). The app sets
 * them when the list loads; presentation reads them to treat these tools as
 * known and to render their cards.
 */
const tools = new SvelteMap<string, ExtensionToolView>();

export function setExtensionTools(
  next: Iterable<{ name: string; view?: ExtensionToolView }>,
): void {
  const wanted = new Map(
    [...next].map((tool) => [tool.name, tool.view ?? DEFAULT_VIEW]),
  );
  for (const name of [...tools.keys()])
    if (!wanted.has(name)) tools.delete(name);
  for (const [name, view] of wanted)
    if (JSON.stringify(tools.get(name)) !== JSON.stringify(view))
      tools.set(name, view);
}

/** Extension tools from a tool list: those with an `extension`. */
export function extensionToolsOf(
  list: readonly {
    name: string;
    extension?: string;
    view?: ExtensionToolView;
  }[],
): { name: string; view?: ExtensionToolView }[] {
  return list.filter((tool) => tool.extension);
}

export function isExtensionToolName(name: string): boolean {
  return tools.has(name);
}

/** The view an extension tool declares; undefined for other tools. */
export function extensionToolView(name: string): ExtensionToolView | undefined {
  return tools.get(name);
}
