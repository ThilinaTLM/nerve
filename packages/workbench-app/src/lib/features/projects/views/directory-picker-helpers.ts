import GitBranch from "@lucide/svelte/icons/git-branch";
import PackageIcon from "@lucide/svelte/icons/package";
import Terminal from "@lucide/svelte/icons/terminal";
import type { FilesystemSignal } from "$lib/api";
import type { SignalMetaByKind } from "./directory-picker-types";

export const signalMeta: SignalMetaByKind = {
  git: {
    label: "Git",
    title: "Git repository",
    tone: "accent",
    icon: GitBranch,
  },
  package: { label: "Pkg", title: "JavaScript package", icon: PackageIcon },
  workspace: {
    label: "Workspace",
    title: "Workspace marker",
    tone: "accent",
    icon: PackageIcon,
  },
  python: { label: "Py", title: "Python project", icon: Terminal },
  rust: { label: "Rust", title: "Rust project", icon: Terminal },
  go: { label: "Go", title: "Go module", icon: Terminal },
};

export function uniqueSignals(
  signals: FilesystemSignal[] | undefined,
): FilesystemSignal[] {
  return [...new Set(signals ?? [])];
}

export function expandHome(value: string, homeDir?: string): string {
  const v = value.trim();
  if (!homeDir) return v;
  if (v === "~") return homeDir;
  if (v.startsWith("~/") || v.startsWith("~\\")) {
    const sep = homeDir.includes("\\") ? "\\" : "/";
    return `${homeDir.replace(/[\\/]+$/, "")}${sep}${v.slice(2)}`;
  }
  return v;
}
