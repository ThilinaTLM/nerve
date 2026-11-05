import { foldAll, foldCode, unfoldAll, unfoldCode } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import Copy from "@lucide/svelte/icons/copy";
import FoldVertical from "@lucide/svelte/icons/fold-vertical";
import ListOrdered from "@lucide/svelte/icons/list-ordered";
import Replace from "@lucide/svelte/icons/replace";
import Save from "@lucide/svelte/icons/save";
import ScanText from "@lucide/svelte/icons/scan-text";
import Search from "@lucide/svelte/icons/search";
import TextSelect from "@lucide/svelte/icons/text-select";
import UnfoldVertical from "@lucide/svelte/icons/unfold-vertical";
import WrapText from "@lucide/svelte/icons/wrap-text";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import {
  canFoldAt,
  canUnfoldAt,
  selectedSearchText,
  viewerShortcut,
} from "./code-viewer-helpers";

export type CodeSurfaceMenuInput = {
  view: EditorView;
  position: number;
  editable: boolean;
  wrap: boolean;
  highlightSelectionMatches: boolean;
  onSave?: () => void;
  onCopySelection: () => void;
  onSelectAll: () => void;
  onFind: (options: { seed: boolean; replace?: boolean }) => void;
  onGoToLine: () => void;
  onToggleWrap?: () => void;
  onToggleSelectionMatches?: () => void;
  run: (command: (view: EditorView) => boolean) => void;
};

export function codeSurfaceMenuItems(
  input: CodeSurfaceMenuInput,
): ContextMenuItem[] {
  const { view } = input;
  const position = Math.min(input.position, view.state.doc.length);
  const selected = selectedSearchText(view.state, position);
  const hasSelection = view.state.selection.ranges.some(
    (range) => !range.empty,
  );
  const canUnfold = canUnfoldAt(view.state, position);
  const canFold = !canUnfold && canFoldAt(view.state, position);
  const save: ContextMenuItem[] =
    input.editable && input.onSave
      ? [
          {
            label: "Save",
            icon: Save,
            shortcut: viewerShortcut("s"),
            onSelect: input.onSave,
          },
          { type: "separator" },
        ]
      : [];
  const replace: ContextMenuItem[] = input.editable
    ? [
        {
          label: "Replace",
          icon: Replace,
          shortcut: replaceShortcut(),
          onSelect: () => input.onFind({ seed: true, replace: true }),
        },
      ]
    : [];
  return [
    ...save,
    {
      label: "Copy selection",
      icon: Copy,
      shortcut: viewerShortcut("c"),
      disabled: !hasSelection,
      onSelect: input.onCopySelection,
    },
    {
      label: "Select all",
      icon: TextSelect,
      shortcut: viewerShortcut("a"),
      onSelect: input.onSelectAll,
    },
    { type: "separator" },
    {
      label: "Find",
      icon: Search,
      shortcut: viewerShortcut("f"),
      onSelect: () => input.onFind({ seed: false }),
    },
    {
      label: "Find selection",
      icon: Search,
      disabled: !selected,
      onSelect: () => input.onFind({ seed: true }),
    },
    ...replace,
    {
      label: "Go to line",
      icon: ListOrdered,
      shortcut: isMacPlatform() ? "⌃G" : "Ctrl+G",
      onSelect: input.onGoToLine,
    },
    { type: "separator" },
    {
      label: "Wrap long lines",
      icon: input.wrap ? CircleCheck : WrapText,
      disabled: !input.onToggleWrap,
      onSelect: input.onToggleWrap,
    },
    {
      label: "Highlight occurrences",
      icon: input.highlightSelectionMatches ? CircleCheck : ScanText,
      disabled: !input.onToggleSelectionMatches,
      onSelect: input.onToggleSelectionMatches,
    },
    { type: "separator" },
    {
      label: "Fold block",
      icon: FoldVertical,
      disabled: !canFold,
      onSelect: () => input.run(foldCode),
    },
    {
      label: "Unfold block",
      icon: UnfoldVertical,
      disabled: !canUnfold,
      onSelect: () => input.run(unfoldCode),
    },
    {
      label: "Fold all",
      icon: FoldVertical,
      shortcut: viewerShortcut("[", { alt: true }),
      onSelect: () => input.run(foldAll),
    },
    {
      label: "Unfold all",
      icon: UnfoldVertical,
      shortcut: viewerShortcut("]", { alt: true }),
      onSelect: () => input.run(unfoldAll),
    },
  ];
}

export function isMacPlatform(): boolean {
  return (
    typeof navigator !== "undefined" &&
    (navigator.platform.toLowerCase().includes("mac") ||
      navigator.userAgent.includes("Mac OS X"))
  );
}

function replaceShortcut(): string {
  return isMacPlatform() ? "⌥⌘F" : "Ctrl+H";
}
