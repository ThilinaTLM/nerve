<script lang="ts">
// ask_user while its arguments stream: the same question sections as the live
// card (rendered inside the card sheet), with skeletons for values that have not arrived yet.
import type { AskUserViewQuestion } from "../views/tool-view-types";
import AskUserQuestion from "./AskUserQuestion.svelte";

let { questions }: { questions: AskUserViewQuestion[] } = $props();
</script>

{#each questions as question, index (index)}
  <AskUserQuestion
    toolCallId="draft"
    {question}
    {index}
    total={questions.length}
    phase="idle"
    streaming
  />
{/each}
