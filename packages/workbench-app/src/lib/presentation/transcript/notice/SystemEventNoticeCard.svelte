<script lang="ts">
import type { SystemEventNotice } from "../../state/transcript-types";
import Markdown from "@nervekit/ui-kit/renderers/markdown/Markdown.svelte";
import NoticeCard from "./NoticeCard.svelte";
import { systemEventNoticeModel } from "./system-event-notice";

let { notice }: { notice: SystemEventNotice } = $props();
const model = $derived(systemEventNoticeModel(notice));
const body = $derived((notice.summary ?? notice.text).trim());
</script>

<NoticeCard notice={model} bodyVisible={Boolean(body)}>
  {#if body}
    <div
      class="max-h-72 overflow-auto rounded-sm bg-well px-2.5 py-2 text-sm leading-6"
    >
      <Markdown text={body} />
    </div>
  {/if}
</NoticeCard>
