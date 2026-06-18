import type { Component } from "svelte";
import type {
  FilesystemDirectoryResponse,
  FilesystemSignal,
  ProjectRecord,
} from "$lib/api";

export type SignalMeta = {
  label: string;
  title: string;
  tone?: "neutral" | "accent" | "good" | "warn" | "danger" | "running";
  icon: Component;
};

export type FilesystemEntry = FilesystemDirectoryResponse["entries"][number];
export type NavItem =
  | { kind: "recent"; id: string; path: string; project: ProjectRecord }
  | { kind: "folder"; id: string; path: string; entry: FilesystemEntry };

export type SignalMetaByKind = Record<FilesystemSignal, SignalMeta>;
