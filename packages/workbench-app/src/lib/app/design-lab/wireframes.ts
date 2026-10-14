import type { Component } from "svelte";

export interface WireframeEntry {
  id: string;
  title: string;
  summary: string;
  load: () => Promise<{ default: Component }>;
}

// Local prototypes are gitignored. Glob discovery keeps this tracked runner
// useful in a fresh checkout without requiring a registry edit per experiment.
const prototypes = import.meta.glob<{ default: Component }>(
  "./wireframes/*.svelte",
);

export const WIREFRAMES: readonly WireframeEntry[] = Object.entries(prototypes)
  .flatMap(([path, load]) => {
    const id = path.slice("./wireframes/".length, -".svelte".length);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) return [];
    return [
      {
        id,
        title: id
          .replace(/-/g, " ")
          .replace(/^./, (letter) => letter.toUpperCase()),
        summary: "Local prototype · mock data only",
        load,
      },
    ];
  })
  .sort((left, right) => left.id.localeCompare(right.id));
