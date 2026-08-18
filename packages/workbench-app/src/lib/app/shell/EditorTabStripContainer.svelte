<script lang="ts">
import BookOpenText from "@lucide/svelte/icons/book-open-text";
import Code2 from "@lucide/svelte/icons/code-2";
import Copy from "@lucide/svelte/icons/copy";
import FileDiff from "@lucide/svelte/icons/file-diff";
import FileText from "@lucide/svelte/icons/file-text";
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
import CloudCog from "@lucide/svelte/icons/cloud-cog";
import Logs from "@lucide/svelte/icons/logs";
import MoveLeft from "@lucide/svelte/icons/move-left";
import MoveRight from "@lucide/svelte/icons/move-right";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import Settings from "@lucide/svelte/icons/settings";
import TextAlignStart from "@lucide/svelte/icons/text-align-start";
import Terminal from "@lucide/svelte/icons/terminal";
import Workflow from "@lucide/svelte/icons/workflow";
import X from "@lucide/svelte/icons/x";
import { EditorTabStrip } from "$lib/presentation/shell";
import type {
  WorkbenchTabIdentity,
  WorkbenchTabModel,
} from "$lib/presentation/shell";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/ui/context-menu-list";
import { writeClipboardText } from "$lib/core/clipboard";
import type {
  CenterTabIdentity,
  CenterTabModel,
} from "$lib/features/workspace";
import { notify } from "$lib/features/notifications/notify.svelte";
import {
  getShortcutAriaLabel,
  getShortcutLabel,
} from "$lib/core/shortcuts/registry";
import {
  fileToggleLabel,
  fileWrapLabel,
  statusLabel,
  tabIdentity,
  tabIndex,
  tabLabel,
  tabTitle,
} from "./editor-tab-helpers";

type Props = {
  tabs?: CenterTabModel[];
  homeDir?: string;
  onSelect?: (tab: CenterTabIdentity) => void;
  onClose?: (tab: CenterTabIdentity) => void;
  onRefresh?: (tab: CenterTabIdentity) => void;
  onCloseOther?: (tab: CenterTabIdentity) => void;
  onCloseRight?: (tab: CenterTabIdentity) => void;
  onCloseLeft?: (tab: CenterTabIdentity) => void;
  onToggleFileDisplayMode?: (id: string) => void;
  onToggleFileLineWrap?: (id: string) => void;
  onNew?: () => void;
  onReorder?: (tab: CenterTabIdentity, targetIndex: number) => void;
};

let {
  tabs = [],
  homeDir,
  onSelect,
  onClose,
  onRefresh,
  onCloseOther,
  onCloseRight,
  onCloseLeft,
  onToggleFileDisplayMode,
  onToggleFileLineWrap,
  onNew,
  onReorder,
}: Props = $props();

const refreshShortcut = getShortcutLabel("pane.refresh");
const closeShortcut = getShortcutLabel("pane.close");
const closeOthersShortcut = getShortcutLabel("pane.closeOthers");
const newShortcut = getShortcutLabel("conversation.new");
const newShortcutAria = getShortcutAriaLabel("conversation.new");

const workbenchTabs = $derived(tabs.map(toWorkbenchTab));

function castIdentity(tab: WorkbenchTabIdentity): CenterTabIdentity {
  return tab as CenterTabIdentity;
}

function originalTab(tab: WorkbenchTabModel): CenterTabModel | undefined {
  return tabs.find((candidate) => {
    const identity = tabIdentity(candidate);
    return identity.kind === tab.kind && identity.id === tab.id;
  });
}

function toWorkbenchTab(tab: CenterTabModel): WorkbenchTabModel {
  const identity = tabIdentity(tab);
  const model: WorkbenchTabModel = {
    ...identity,
    label: tabLabel(tab),
    title: tabTitle(tab, homeDir),
    active: tab.active,
    running: tab.sending,
    error: tab.error,
    closeable: true,
    wide:
      tab.kind === "task" ||
      tab.kind === "file" ||
      tab.kind === "mermaid" ||
      tab.kind === "diff",
    draft:
      (tab.kind === "conversation" || tab.kind === "pending-conversation") &&
      tab.hasDraft,
  };

  if (tab.kind === "conversation" || tab.kind === "pending-conversation") {
    model.status = {
      tone: tab.activity.tone,
      pulse: tab.activity.pulse,
      label: statusLabel(tab),
    };
  } else if (tab.kind === "task") {
    model.status = { label: statusLabel(tab) };
    model.selectIcon = Terminal;
  } else if (tab.kind === "file") {
    if (tab.renderKind) {
      model.toggle = {
        label: fileToggleLabel(tab),
        icon: tab.displayMode === "rendered" ? BookOpenText : Code2,
        disabled: !onToggleFileDisplayMode,
        onClick: () => onToggleFileDisplayMode?.(tab.id),
      };
    } else {
      model.icon = FileText;
    }
  } else if (tab.kind === "mermaid") model.icon = Workflow;
  else if (tab.kind === "pr") model.icon = GitPullRequest;
  else if (tab.kind === "diff") model.icon = FileDiff;
  else if (tab.kind === "settings") model.icon = Settings;
  else if (tab.kind === "auth") model.icon = CloudCog;
  else if (tab.kind === "logs") model.icon = Logs;

  return model;
}

async function copyToClipboard(text: string | undefined, label: string) {
  if (!text) return;
  try {
    await writeClipboardText(text);
    notify.success(`Copied ${label}`);
  } catch {
    notify.error("Could not copy to clipboard");
  }
}

function tabMenu(tab: WorkbenchTabModel): ContextMenuItem[] {
  const source = originalTab(tab);
  if (!source) return [];
  const identity = tabIdentity(source);
  const index = tabIndex(tabs, source);
  const hasLeft = index > 0;
  const hasRight = index !== -1 && index < tabs.length - 1;
  const items: ContextMenuItem[] = [];

  if (source.kind === "file" || source.kind === "mermaid") {
    const absolutePath =
      source.kind === "file" ? (source.file?.path ?? source.path) : source.path;
    const relativePath =
      source.kind === "file"
        ? (source.relativePath ?? source.file?.relativePath)
        : source.relativePath;
    items.push(
      {
        label: "Copy path",
        icon: Copy,
        disabled: !absolutePath,
        onSelect: () => void copyToClipboard(absolutePath, "path"),
      },
      {
        label: "Copy relative path",
        icon: Copy,
        disabled: !relativePath,
        onSelect: () => void copyToClipboard(relativePath, "relative path"),
      },
      { type: "separator" },
    );
    if (source.kind === "file") {
      items.push({
        label: fileWrapLabel(source),
        icon: TextAlignStart,
        disabled: !onToggleFileLineWrap,
        onSelect: () => onToggleFileLineWrap?.(source.id),
      });
    }
  }

  items.push({
    label: "Refresh",
    icon: RefreshCw,
    shortcut: refreshShortcut,
    disabled: !onRefresh,
    onSelect: () => onRefresh?.(identity),
  });

  if (onReorder) {
    items.push(
      { type: "separator" },
      {
        label: "Move left",
        icon: MoveLeft,
        disabled: !hasLeft,
        onSelect: () => onReorder(identity, index - 1),
      },
      {
        label: "Move right",
        icon: MoveRight,
        disabled: !hasRight,
        onSelect: () => onReorder(identity, index + 1),
      },
    );
  }

  items.push(
    { type: "separator" },
    {
      label: "Close pane",
      icon: X,
      shortcut: closeShortcut,
      onSelect: () => onClose?.(identity),
    },
    {
      label: "Close others",
      icon: X,
      shortcut: closeOthersShortcut,
      disabled: tabs.length <= 1 || !onCloseOther,
      onSelect: () => onCloseOther?.(identity),
    },
    {
      label: "Close to the right",
      icon: X,
      disabled: !hasRight || !onCloseRight,
      onSelect: () => onCloseRight?.(identity),
    },
    {
      label: "Close to the left",
      icon: X,
      disabled: !hasLeft || !onCloseLeft,
      onSelect: () => onCloseLeft?.(identity),
    },
  );

  return items;
}
</script>

<EditorTabStrip
  tabs={workbenchTabs}
  {refreshShortcut}
  {closeShortcut}
  {closeOthersShortcut}
  newLabel="New chat"
  {newShortcut}
  {newShortcutAria}
  buildMenuItems={({ tab }) => tabMenu(tab)}
  onSelect={(tab) => onSelect?.(castIdentity(tab))}
  onClose={(tab) => onClose?.(castIdentity(tab))}
  onRefresh={(tab) => onRefresh?.(castIdentity(tab))}
  onCloseOther={(tab) => onCloseOther?.(castIdentity(tab))}
  onCloseRight={(tab) => onCloseRight?.(castIdentity(tab))}
  onCloseLeft={(tab) => onCloseLeft?.(castIdentity(tab))}
  {onNew}
  onReorder={(tab, targetIndex) => onReorder?.(castIdentity(tab), targetIndex)}
/>
