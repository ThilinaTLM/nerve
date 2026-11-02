import type { Component } from "svelte";

export type ComposerSuggestion = {
  id: string;
  label: string;
  prompt: string;
  /** What the suggestion does; shown in the chip tooltip. */
  description?: string;
  /** One-line summary of the state that triggered it. */
  context?: string;
  icon?: Component;
};
