<script lang="ts">
import type { SystemEventNotice } from "../../state/transcript-types";
import ResultCodeBlock from "../../tools/tool-call/ResultCodeBlock.svelte";
import NoticeCard from "./NoticeCard.svelte";
import { systemEventNoticeModel } from "./system-event-notice";

let { notice }: { notice: SystemEventNotice } = $props();
const model = $derived(systemEventNoticeModel(notice));
const body = $derived((notice.summary ?? notice.text).trim());
</script>

<NoticeCard notice={model} bodyVisible={Boolean(body)}>
  {#if body}
    <ResultCodeBlock code={body} trim={false} highlight={false} />
  {/if}
</NoticeCard>
