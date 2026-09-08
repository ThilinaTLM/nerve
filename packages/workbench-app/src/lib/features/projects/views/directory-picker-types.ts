import type { StatusTone } from "@nervekit/ui-kit/display/status";
import type { Component } from "svelte";
import type { FilesystemDirectoryResponse, FilesystemSignal } from "$lib/api";

export type SignalMeta = {
  label: string;
  title: string;
  tone?: StatusTone;
  icon: Component;
};

export type FilesystemEntry = FilesystemDirectoryResponse["entries"][number];
export type NavItem = {
  kind: "folder";
  id: string;
  path: string;
  entry: FilesystemEntry;
};

export type SignalMetaByKind = Record<FilesystemSignal, SignalMeta>;
