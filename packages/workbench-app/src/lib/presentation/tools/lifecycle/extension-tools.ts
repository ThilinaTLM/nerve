import { SvelteSet } from "svelte/reactivity";

/**
 * Names of the direct tools extensions contribute, from the host's tool list
 * (`ToolDescriptor.extension`). The app sets them when the list loads;
 * presentation reads them to treat these tools as known rather than as
 * recorded tools missing from the catalog.
 */
const names = new SvelteSet<string>();

export function setExtensionToolNames(next: Iterable<string>): void {
  const wanted = new Set(next);
  for (const name of [...names]) if (!wanted.has(name)) names.delete(name);
  for (const name of wanted) names.add(name);
}

export function isExtensionToolName(name: string): boolean {
  return names.has(name);
}
