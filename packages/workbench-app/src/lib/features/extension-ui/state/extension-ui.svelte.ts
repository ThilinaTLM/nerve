import type {
  ExtensionUiContributions,
  ExtensionUiTheme,
} from "@nervekit/contracts/extensions";
import {
  getExtensionUiContributions,
  getExtensionUiThemes,
} from "../api/extension-ui.api";
import { setLoadedExtensionThemes } from "$lib/platform/appearance/extension-themes.svelte";

export type ExtensionPage = ExtensionUiContributions["pages"][number];
export type ExtensionPanel = ExtensionUiContributions["panels"][number];

/** UI contributions of enabled, consented extensions, per project. */
export const extensionUiState = $state({
  byProject: {} as Record<string, ExtensionUiContributions | undefined>,
  /** Bumped when contributions reload, so frames of a changed extension can reload. */
  revision: 0,
});

const generations: Record<string, number> = {};

export async function loadExtensionContributions(
  projectId: string,
): Promise<void> {
  const generation = (generations[projectId] ?? 0) + 1;
  generations[projectId] = generation;
  try {
    const contributions = await getExtensionUiContributions(projectId);
    if (generations[projectId] !== generation) return;
    extensionUiState.byProject[projectId] = contributions;
    extensionUiState.revision += 1;
  } catch {
    // A project without answers has no contributions; the next change retries.
    if (generations[projectId] === generation)
      extensionUiState.byProject[projectId] = undefined;
  }
}

let themeGeneration = 0;

export async function loadExtensionUiThemes(): Promise<void> {
  const generation = ++themeGeneration;
  try {
    const { themes } = await getExtensionUiThemes();
    if (generation === themeGeneration)
      setLoadedExtensionThemes(themes as ExtensionUiTheme[]);
  } catch {
    // Keep what is applied; the next change retries.
  }
}

export function contributionsOf(
  projectId: string | undefined,
): ExtensionUiContributions | undefined {
  return projectId ? extensionUiState.byProject[projectId] : undefined;
}

export function findExtensionPage(
  projectId: string | undefined,
  extensionId: string,
  pageId: string,
): ExtensionPage | undefined {
  return contributionsOf(projectId)?.pages.find(
    (page) => page.extensionId === extensionId && page.id === pageId,
  );
}

/** A page by id from any loaded project, for tab labels outside a project context. */
export function findLoadedExtensionPage(
  extensionId: string,
  pageId: string,
): ExtensionPage | undefined {
  for (const contributions of Object.values(extensionUiState.byProject)) {
    const page = contributions?.pages.find(
      (candidate) =>
        candidate.extensionId === extensionId && candidate.id === pageId,
    );
    if (page) return page;
  }
  return undefined;
}
