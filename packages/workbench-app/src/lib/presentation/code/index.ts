export { default as CodeDiffView } from "./CodeDiffView.svelte";
export { default as CodeView } from "./CodeView.svelte";
export {
  codeLanguageId,
  codeLanguageLabel,
  codeMirrorTheme,
  codeSurfaceExtensions,
  loadCodeLanguage,
  loadedCodeLanguage,
  localLineNumber,
} from "./code-mirror-config.js";
export type { DiffLayout } from "./code-diff.js";
