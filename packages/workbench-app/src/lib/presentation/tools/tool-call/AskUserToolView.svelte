<script lang="ts">
// ask_user card body: one sheet section per question, kept in every state from
// the first streamed byte to the recorded answer. Options, the composer and
// voice live in AskUserQuestion; the AskUserController owns answers, Send and
// Dismiss. Inside ToolCallCard the controller is shared with the card footer;
// standalone (details dialog) the view builds its own.
import type { UserInputAnswer } from "@nervekit/contracts/core";
import type { UserQuestionRecord } from "../../state/tool-types";
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../views/tool-result-view";
import { getConversationUiCapabilities } from "../../context.svelte";
import CardFooter from "../../cards/CardFooter.svelte";
import CardSheet from "../../cards/CardSheet.svelte";
import CardSheetError from "../../cards/CardSheetError.svelte";
import AskUserActions from "./AskUserActions.svelte";
import { AskUserController } from "./ask-user-controller.svelte";
import AskUserQuestion from "./AskUserQuestion.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "ask_user" }>;
  questionRecord?: UserQuestionRecord;
  /** Shared with the card footer; omitted when rendered standalone. */
  controller?: AskUserController;
  onOpenFile?: (path: string, line?: number) => void;
  onAnswerUserQuestion?: (
    toolCallId: string,
    answers: Record<string, UserInputAnswer>,
  ) => void | Promise<void>;
  onDismissUserQuestion?: (toolCallId: string) => void | Promise<void>;
};
let {
  toolCall,
  view,
  questionRecord,
  controller: shared,
  onOpenFile,
  onAnswerUserQuestion,
  onDismissUserQuestion,
}: Props = $props();

const capabilities = getConversationUiCapabilities();
const voice = capabilities.voice;
const own = new AskUserController(() => ({
  toolCall,
  questions: view.questions,
  dismissed: view.dismissed,
  questionRecord,
  voice,
  draftStore: capabilities.askUserDrafts,
  onAnswer: onAnswerUserQuestion,
  onDismiss: onDismissUserQuestion,
}));
const controller = $derived(shared ?? own);
</script>

{#snippet sections()}
  {#each controller.questions as question, index (`${toolCall.id}:${question.id}`)}
    <AskUserQuestion
      toolCallId={toolCall.id}
      projectId={toolCall.projectId}
      conversationId={toolCall.conversationId}
      {question}
      {index}
      total={controller.questions.length}
      phase={controller.phaseFor(question)}
      streaming={view.streaming}
      draft={controller.drafts[question.id]}
      answer={controller.answerFor(question)}
      busy={Boolean(controller.submitting)}
      autoFocus={index === 0}
      onSelect={(option) => controller.update(question.id, { option })}
      onText={(text) => controller.update(question.id, { text })}
      onSubmit={() => void controller.send()}
      onNeedAuth={() => (controller.authDialogOpen = true)}
      {onOpenFile}
    />
  {/each}
  {#if controller.error}
    <CardSheetError text={controller.error} />
  {/if}
{/snippet}

{#if shared}
  {@render sections()}
{:else}
  <div class="grid select-text gap-2">
    <CardSheet>{@render sections()}</CardSheet>
    {#if controller.pending}
      <CardFooter>
        {#snippet actions()}<AskUserActions {controller} />{/snippet}
      </CardFooter>
    {/if}
  </div>
{/if}
