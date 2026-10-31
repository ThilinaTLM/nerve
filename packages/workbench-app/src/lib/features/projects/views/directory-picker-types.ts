import type { StatusTone } from "@nervekit/ui-kit/display/status";
import type { Component } from "svelte";
import type { FilesystemSignal } from "$lib/api";

export type SignalMeta = {
  label: string;
  title: string;
  tone?: StatusTone;
  icon: Component;
};

export type SignalMetaByKind = Record<FilesystemSignal, SignalMeta>;
