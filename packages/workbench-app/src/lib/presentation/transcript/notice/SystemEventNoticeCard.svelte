<script lang="ts">
import type { SystemEventNotice } from "../../state/transcript-types";
import ToolOutputBlock from "../../tools/tool-call/ToolOutputBlock.svelte";
import NoticeCard from "./NoticeCard.svelte";
import {
  systemEventNoticeBody,
  systemEventNoticeModel,
} from "./system-event-notice";

let { notice }: { notice: SystemEventNotice } = $props();
const model = $derived(systemEventNoticeModel(notice));
const body = $derived(systemEventNoticeBody(notice));
const details = $derived(
  body
    ? {
        title: `${model.badge} details`,
        description: model.arg,
        text: body,
        language: "markdown",
      }
    : undefined,
);
</script>

<NoticeCard notice={model} bodyVisible={Boolean(body)} {details}>
  {#if body}
    <ToolOutputBlock text={body} language="markdown" overflow="hidden" />
  {/if}
</NoticeCard>
