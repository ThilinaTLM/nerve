import type { UserInputAnswer } from "@nervekit/contracts/core";
import type {
  VoiceInputCapability,
  VoiceInputTargetRef,
} from "../../context.svelte";
import type { UserQuestionRecord } from "../../state/tool-types";
import type { ToolCallDisplayRecord } from "../views/tool-result-view";
import type { AskUserViewQuestion } from "../views/tool-view-types";
import {
  askUserQuestionPhase,
  projectAskUserAnswers,
  type AskUserAnswerDraft,
  type AskUserPhase,
} from "./ask-user-state";

export type AskUserControllerInput = {
  toolCall: ToolCallDisplayRecord;
  /** Questions and recorded answers parsed from the call. */
  questions: AskUserViewQuestion[];
  dismissed: boolean;
  questionRecord?: UserQuestionRecord;
  voice?: VoiceInputCapability;
  onAnswer?: (
    toolCallId: string,
    answers: Record<string, UserInputAnswer>,
  ) => void | Promise<void>;
  onDismiss?: (toolCallId: string) => void | Promise<void>;
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

/**
 * State of one ask_user card: typed answers, the in-flight resolution, and
 * voice. The question sections and the card footer's Send/Dismiss both read it,
 * so they stay in sync while living in different parts of the card.
 */
export class AskUserController {
  drafts = $state<Record<string, AskUserAnswerDraft>>({});
  submitting = $state<"answer" | "dismiss" | undefined>();
  transcribingForSend = $state(false);
  error = $state<string | undefined>();
  authDialogOpen = $state(false);
  // The locally submitted resolution bridges the gap between a successful RPC
  // and the authoritative tool result arriving through durable events.
  resolution = $state<
    | { kind: "answered"; answers: Record<string, UserInputAnswer> }
    | { kind: "dismissed" }
    | undefined
  >();
  readonly #input: () => AskUserControllerInput;

  constructor(input: () => AskUserControllerInput) {
    this.#input = input;
  }

  get toolCallId(): string {
    return this.#input().toolCall.id;
  }

  get pending(): boolean {
    const { toolCall, questionRecord } = this.#input();
    return (
      toolCall.status === "waiting" &&
      questionRecord?.status === "pending" &&
      !this.resolution
    );
  }

  get questions(): AskUserViewQuestion[] {
    const { questionRecord, questions } = this.#input();
    return this.pending && questionRecord
      ? questionRecord.questions.map((question) => ({
          ...question,
          options: question.options ?? [],
        }))
      : questions;
  }

  get dismissed(): boolean {
    const { toolCall, dismissed, questionRecord } = this.#input();
    return (
      dismissed ||
      questionRecord?.status === "dismissed" ||
      this.resolution?.kind === "dismissed" ||
      toolCall.status === "failed" ||
      toolCall.status === "denied" ||
      toolCall.status === "cancelled"
    );
  }

  get answers(): Record<string, UserInputAnswer> {
    return projectAskUserAnswers(this.questions, this.drafts);
  }

  get answeredCount(): number {
    return Object.keys(this.answers).length;
  }

  answerFor(question: AskUserViewQuestion): UserInputAnswer | undefined {
    const local =
      this.resolution?.kind === "answered"
        ? this.resolution.answers[question.id]
        : undefined;
    return question.answer ?? local;
  }

  phaseFor(question: AskUserViewQuestion): AskUserPhase {
    const { toolCall } = this.#input();
    return askUserQuestionPhase({
      pending: this.pending,
      settled:
        toolCall.status !== "committed" &&
        toolCall.status !== "running" &&
        toolCall.status !== "waiting"
          ? true
          : this.resolution !== undefined,
      dismissed: this.dismissed,
      answer: this.answerFor(question),
    });
  }

  voiceTarget(question: { id: string }): VoiceInputTargetRef {
    return { kind: "ask-user", id: `${this.toolCallId}:${question.id}` };
  }

  /** The question being recorded right now, if any. */
  get recordingTarget(): VoiceInputTargetRef | undefined {
    const { voice } = this.#input();
    if (!voice || !this.pending) return undefined;
    return this.questions
      .map((question) => this.voiceTarget(question))
      .find(
        (target) =>
          voice.session.isTargetActive(target) && voice.session.recording,
      );
  }

  get voiceActive(): boolean {
    const { voice } = this.#input();
    if (!voice || !this.pending) return false;
    return this.questions.some(
      (question) =>
        voice.session.isTargetActive(this.voiceTarget(question)) &&
        (voice.session.recording || voice.session.transcribing),
    );
  }

  update(id: string, patch: Partial<AskUserAnswerDraft>): void {
    this.drafts[id] = { ...this.drafts[id], ...patch };
  }

  /** Like the prompt composer: Send while recording = stop, transcribe, send. */
  async send(): Promise<void> {
    const { voice, onAnswer } = this.#input();
    if (!this.pending || this.submitting || !onAnswer) return;
    this.submitting = "answer";
    this.error = undefined;
    try {
      const target = this.recordingTarget;
      if (voice && target) {
        this.transcribingForSend = true;
        await voice.session.stop(target);
        this.transcribingForSend = false;
      }
      const answers = this.answers;
      if (Object.keys(answers).length === 0) return;
      await onAnswer(this.toolCallId, answers);
      this.resolution = { kind: "answered", answers };
    } catch (error) {
      this.error = errorMessage(error, "Could not send the answers.");
    } finally {
      this.transcribingForSend = false;
      this.submitting = undefined;
    }
  }

  async dismiss(): Promise<void> {
    const { onDismiss } = this.#input();
    if (!this.pending || this.submitting || !onDismiss) return;
    this.submitting = "dismiss";
    this.error = undefined;
    try {
      await onDismiss(this.toolCallId);
      this.resolution = { kind: "dismissed" };
    } catch (error) {
      this.error = errorMessage(error, "Could not dismiss the question.");
    } finally {
      this.submitting = undefined;
    }
  }
}
