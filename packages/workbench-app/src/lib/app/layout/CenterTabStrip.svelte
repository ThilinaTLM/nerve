<script lang="ts">
import BookOpenText from "@lucide/svelte/icons/book-open-text";
import Code2 from "@lucide/svelte/icons/code-2";
import Copy from "@lucide/svelte/icons/copy";
import FileText from "@lucide/svelte/icons/file-text";
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
import KeyRound from "@lucide/svelte/icons/key-round";
import Logs from "@lucide/svelte/icons/logs";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import Settings from "@lucide/svelte/icons/settings";
import Terminal from "@lucide/svelte/icons/terminal";
import X from "@lucide/svelte/icons/x";
import { WorkbenchTabStrip } from "@nervekit/workbench-ui/components/workbench";
import type {
  WorkbenchTabIdentity,
  WorkbenchTabModel,
} from "@nervekit/workbench-ui/components/workbench";
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
} from "./center-tab-helpers";

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
  onNewConversation?: () => void;
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
  onNewConversation,
}: Props = $props();

const newConversationShortcut = getShortcutLabel("conversation.new");
const newConversationShortcutAria = getShortcutAriaLabel("conversation.new");
const refreshShortcut = getShortcutLabel("pane.refresh");
const closeShortcut = getShortcutLabel("pane.close");
const closeOthersShortcut = getShortcutLabel("pane.closeOthers");

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
    wide: tab.kind === "task" || tab.kind === "file",
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
    if (tab.markdown) {
      model.toggle = {
        label: fileToggleLabel(tab),
        icon: tab.displayMode === "rendered" ? BookOpenText : Code2,
        disabled: !onToggleFileDisplayMode,
        onClick: () => onToggleFileDisplayMode?.(tab.id),
      };
    } else {
      model.icon = FileText;
    }
  } else if (tab.kind === "pr") model.icon = GitPullRequest;
  else if (tab.kind === "settings") model.icon = Settings;
  else if (tab.kind === "auth") model.icon = KeyRound;
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

  if (source.kind === "file") {
    const absolutePath = source.file?.path ?? source.path;
    const relativePath = source.relativePath ?? source.file?.relativePath;
    items.push(
      {
        label: "Copy Path",
        icon: Copy,
        disabled: !absolutePath,
        onSelect: () => void copyToClipboard(absolutePath, "path"),
      },
      {
        label: "Copy Relative Path",
        icon: Copy,
        disabled: !relativePath,
        onSelect: () => void copyToClipboard(relativePath, "relative path"),
      },
      { type: "separator" },
      {
        label: fileWrapLabel(source),
        icon: Code2,
        disabled: !onToggleFileLineWrap,
        onSelect: () => onToggleFileLineWrap?.(source.id),
      },
    );
  }

  items.push({
    label: "Refresh",
    icon: RefreshCw,
    shortcut: refreshShortcut,
    disabled: !onRefresh,
    onSelect: () => onRefresh?.(identity),
  });

  items.push(
    { type: "separator" },
    {
      label: "Close Pane",
      icon: X,
      shortcut: closeShortcut,
      onSelect: () => onClose?.(identity),
    },
    {
      label: "Close Other Panes",
      icon: X,
      shortcut: closeOthersShortcut,
      disabled: tabs.length <= 1 || !onCloseOther,
      onSelect: () => onCloseOther?.(identity),
    },
    {
      label: "Close Panes on Right",
      icon: X,
      disabled: !hasRight || !onCloseRight,
      onSelect: () => onCloseRight?.(identity),
    },
    {
      label: "Close Panes on Left",
      icon: X,
      disabled: !hasLeft || !onCloseLeft,
      onSelect: () => onCloseLeft?.(identity),
    },
  );

  return items;
}
</script>

<WorkbenchTabStrip
  tabs={workbenchTabs}
  {refreshShortcut}
  {closeShortcut}
  {closeOthersShortcut}
  newLabel="New chat"
  newShortcut={newConversationShortcut}
  newShortcutAria={newConversationShortcutAria}
  buildMenuItems={({ tab }) => tabMenu(tab)}
  onSelect={(tab) => onSelect?.(castIdentity(tab))}
  onClose={(tab) => onClose?.(castIdentity(tab))}
  onRefresh={(tab) => onRefresh?.(castIdentity(tab))}
  onCloseOther={(tab) => onCloseOther?.(castIdentity(tab))}
  onCloseRight={(tab) => onCloseRight?.(castIdentity(tab))}
  onCloseLeft={(tab) => onCloseLeft?.(castIdentity(tab))}
  onNew={onNewConversation}
/>
