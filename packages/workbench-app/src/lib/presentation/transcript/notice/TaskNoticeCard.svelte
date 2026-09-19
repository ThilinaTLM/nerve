<script lang="ts">
import type { TaskEventNotice } from "../../state/transcript-types";
import ResultCodeBlock from "../../tools/tool-call/ResultCodeBlock.svelte";
import NoticeCard from "./NoticeCard.svelte";
import { taskEventNoticeModel } from "./task-event-notice";

type Props = {
  notice: TaskEventNotice;
  onOpenTask?: (taskId: string) => void;
};

let { notice, onOpenTask }: Props = $props();

const model = $derived(taskEventNoticeModel(notice, { onOpenTask }));
const command = $derived(notice.commandPreview?.trim() ?? "");
const layoutRevision = $derived(
  `${notice.event ?? "unknown"}:${notice.status ?? "none"}:${command ? "command" : "bare"}`,
);
</script>

<NoticeCard notice={model} {layoutRevision} bodyVisible={Boolean(command)}>
  <ResultCodeBlock code={command} language="bash" wrap overflow="hidden" />
</NoticeCard>
