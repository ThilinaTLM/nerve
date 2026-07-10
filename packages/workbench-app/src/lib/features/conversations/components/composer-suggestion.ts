import type { Component } from "svelte";

export type ComposerSuggestion = {
  id: string;
  label: string;
  prompt: string;
  icon?: Component;
};
