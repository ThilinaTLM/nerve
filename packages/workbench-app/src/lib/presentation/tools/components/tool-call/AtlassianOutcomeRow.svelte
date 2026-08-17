<script lang="ts">
import ArrowRight from "@lucide/svelte/icons/arrow-right";
import CircleDashed from "@lucide/svelte/icons/circle-dashed";
import Download from "@lucide/svelte/icons/download";
import FileDown from "@lucide/svelte/icons/file-down";
import FileUp from "@lucide/svelte/icons/file-up";
import Info from "@lucide/svelte/icons/info";
import Link2 from "@lucide/svelte/icons/link-2";
import ListChecks from "@lucide/svelte/icons/list-checks";
import MessageSquare from "@lucide/svelte/icons/message-square";
import Pencil from "@lucide/svelte/icons/pencil";
import Plus from "@lucide/svelte/icons/plus";
import Shield from "@lucide/svelte/icons/shield";
import Tag from "@lucide/svelte/icons/tag";
import Timer from "@lucide/svelte/icons/timer";
import Trash2 from "@lucide/svelte/icons/trash-2";
import Upload from "@lucide/svelte/icons/upload";
import Workflow from "@lucide/svelte/icons/workflow";

type Tone = "default" | "success" | "info" | "warning" | "destructive";
type OutcomeIcon =
  | "add"
  | "arrow"
  | "download"
  | "edit"
  | "file-download"
  | "file-upload"
  | "info"
  | "link"
  | "list"
  | "comment"
  | "shield"
  | "tag"
  | "timer"
  | "trash"
  | "upload"
  | "workflow";
type Props = {
  title: string;
  detail?: string;
  tone?: Tone;
  icon?: OutcomeIcon;
};

let { title, detail, tone = "default", icon }: Props = $props();

const iconMap = {
  add: Plus,
  arrow: ArrowRight,
  download: Download,
  edit: Pencil,
  "file-download": FileDown,
  "file-upload": FileUp,
  info: Info,
  link: Link2,
  list: ListChecks,
  comment: MessageSquare,
  shield: Shield,
  tag: Tag,
  timer: Timer,
  trash: Trash2,
  upload: Upload,
  workflow: Workflow,
} as const;
const Icon = $derived(
  icon
    ? iconMap[icon]
    : tone === "destructive"
      ? Trash2
      : tone === "success"
        ? CircleDashed
        : tone === "info" || tone === "warning"
          ? Info
          : CircleDashed,
);
const toneClass = $derived(
  tone === "destructive"
    ? "text-destructive"
    : tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "info"
          ? "text-info"
          : "text-muted-foreground",
);
</script>

<div class="flex min-w-0 gap-2 px-2.5 py-2">
  <Icon size={14} strokeWidth={2} class={`mt-0.5 shrink-0 ${toneClass}`} />
  <div class="min-w-0">
    <p class={`m-0 text-xs font-medium leading-snug ${toneClass}`}>{title}</p>
    {#if detail}
      <p
        class="m-0 mt-0.5 whitespace-pre-wrap text-xs leading-snug text-muted-foreground [overflow-wrap:anywhere]"
      >
        {detail}
      </p>
    {/if}
  </div>
</div>
