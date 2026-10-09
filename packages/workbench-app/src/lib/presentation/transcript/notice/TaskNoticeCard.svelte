<script lang="ts">
import type { TaskEventNotice } from "../../state/transcript-types";
import ToolOutputBlock from "../../tools/tool-call/ToolOutputBlock.svelte";
import NoticeCard from "./NoticeCard.svelte";
import { taskEventNoticeModel } from "./task-event-notice";

type Props = {
  notice: TaskEventNotice;
  onOpenTask?: (taskId: string) => void;
};

let { notice, onOpenTask }: Props = $props();

const model = $derived(taskEventNoticeModel(notice, { onOpenTask }));
const command = $derived(notice.command?.trim() ? notice.command : "");
const multilineCommand = $derived(command.includes("\n") ? command : "");
const output = $derived(notice.output?.trim() ? notice.output : "");
const bodyVisible = $derived(Boolean(multilineCommand || output));
const layoutRevision = $derived(
  `${notice.event ?? "unknown"}:${notice.status ?? "none"}:${multilineCommand ? "command" : "inline"}:${output ? "output" : "no-output"}`,
);
</script>

<NoticeCard notice={model} {layoutRevision} {bodyVisible}>
  {#if multilineCommand}
    <section class="grid gap-1" aria-label="Task command">
      <ToolOutputBlock text={multilineCommand} language="bash" />
    </section>
  {/if}
  {#if output}
    <section class="grid gap-1" aria-label="Task output">
      <ToolOutputBlock text={output} direction="tail" terminal />
    </section>
  {/if}
</NoticeCard>
