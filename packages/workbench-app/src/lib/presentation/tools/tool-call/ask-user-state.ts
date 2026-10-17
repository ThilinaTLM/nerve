import { SvelteMap } from "svelte/reactivity";
import {
  normalizeUserInputRequest,
  type UserInputAnswer,
} from "@nervekit/contracts/core";
import { askUserResultSchema } from "@nervekit/contracts/tools";
import type { ToolArgumentSource } from "../lifecycle/argument-source";
import type {
  AskUserViewOption,
  AskUserViewQuestion,
} from "../views/tool-view-types";
import type {
  ToolCallTranscriptRecord,
  UserQuestionRecord,
} from "$lib/presentation/view-models/conversation";

/** Host-owned reactive drafts; presentation does not know about browser storage. */
export interface AskUserDraftStore {
  get(toolCallId: string): Record<string, AskUserAnswerDraft>;
  update(
    toolCallId: string,
    questionId: string,
    patch: Partial<AskUserAnswerDraft>,
  ): void;
  clear(toolCallId: string): void;
}

/** Non-persistent host for isolated previews and tests. */
export function createInMemoryAskUserDraftStore(): AskUserDraftStore {
  const drafts = new SvelteMap<string, Record<string, AskUserAnswerDraft>>();
  return {
    get: (toolCallId) => drafts.get(toolCallId) ?? {},
    update(toolCallId, questionId, patch) {
      const questions = drafts.get(toolCallId) ?? {};
      drafts.set(toolCallId, {
        ...questions,
        [questionId]: { ...questions[questionId], ...patch },
      });
    },
    clear: (toolCallId) => {
      drafts.delete(toolCallId);
    },
  };
}

type AskUserToolCall = Pick<
  ToolCallTranscriptRecord,
  | "id"
  | "agentId"
  | "conversationId"
  | "projectId"
  | "toolName"
  | "status"
  | "interaction"
>;

/**
 * Resolves the pending question owned by an ask_user card.
 *
 * Transcript tool calls and workspace interaction projections update through
 * separate stores. Deriving from the durable interaction keeps the card usable
 * during the brief handoff before the external projection arrives.
 */
export function resolveAskUserQuestion(
  toolCall: AskUserToolCall | undefined,
  projected: UserQuestionRecord | undefined,
): UserQuestionRecord | undefined {
  if (toolCall?.toolName !== "ask_user" || toolCall.status !== "waiting") {
    return undefined;
  }
  const interaction = toolCall.interaction;
  if (interaction?.kind !== "user_input" || interaction.status !== "pending")
    return undefined;

  if (projected?.toolCallId === toolCall.id && projected.status === "pending") {
    return projected;
  }

  return {
    toolCallId: toolCall.id,
    agentId: toolCall.agentId,
    conversationId: toolCall.conversationId,
    projectId: toolCall.projectId,
    questions: interaction.request.questions,
    status: "pending",
    requestedAt: interaction.requestedAt,
    updatedAt: interaction.updatedAt,
  };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Lenient fallback for arguments the strict contract rejects. */
function lenientQuestions(value: unknown): AskUserViewQuestion[] {
  const request = record(value);
  const list = Array.isArray(request.questions)
    ? request.questions
    : text(request.question)
      ? [{ ...request, id: "answer" }]
      : [];
  return list.map((entry, index) => {
    const item = record(entry);
    const options: AskUserViewOption[] = Array.isArray(item.options)
      ? item.options.flatMap((option) => {
          const parsed = record(option);
          const label = text(parsed.label);
          return label
            ? [
                {
                  label,
                  description: text(parsed.description),
                  recommended: parsed.recommended === true || undefined,
                },
              ]
            : [];
        })
      : [];
    return {
      id: text(item.id) ?? `q${index + 1}`,
      question: text(item.question),
      context: text(item.context),
      recommendation: text(item.recommendation),
      options,
    };
  });
}

/**
 * Questions of an ask_user call from its arguments. Accepts the current shape,
 * missing ids, and the legacy flat `{question, context?, recommendation?}`.
 */
export function askUserQuestionsFromArgs(args: unknown): AskUserViewQuestion[] {
  try {
    return normalizeUserInputRequest(args).questions.map((question) => ({
      id: question.id,
      question: question.question,
      context: question.context,
      recommendation: question.recommendation,
      options: question.options ?? [],
    }));
  } catch {
    return lenientQuestions(args);
  }
}

type ResultQuestion = {
  id: string;
  question?: string;
  answer?: UserInputAnswer;
  skipped?: boolean;
};

/**
 * Parses an ask_user result: the current `{questions, dismissed}` shape or the
 * legacy flat `{question, response?, dismissed?}` kept for old transcripts.
 */
export function parseAskUserResult(
  raw: unknown,
): { questions: ResultQuestion[]; dismissed: boolean } | undefined {
  const parsed = askUserResultSchema.safeParse(raw);
  if (parsed.success) {
    return {
      questions: parsed.data.questions,
      dismissed: Boolean(parsed.data.dismissed),
    };
  }
  const legacy = record(raw);
  if (!text(legacy.question) && !text(legacy.response) && !legacy.dismissed) {
    return undefined;
  }
  const response = text(legacy.response);
  return {
    questions: [
      {
        id: "answer",
        question: text(legacy.question),
        answer: response ? { text: response } : undefined,
      },
    ],
    dismissed: Boolean(legacy.dismissed),
  };
}

/** Merges the recorded result into the argument questions; ids are identity. */
export function askUserViewFromCall(
  args: unknown,
  rawResult: unknown,
): { questions: AskUserViewQuestion[]; dismissed: boolean } {
  const questions = askUserQuestionsFromArgs(args);
  const result = parseAskUserResult(rawResult);
  if (!result) return { questions, dismissed: false };
  const merged = questions.map((question) => {
    const recorded = result.questions.find((item) => item.id === question.id);
    return recorded
      ? { ...question, answer: recorded.answer, skipped: recorded.skipped }
      : question;
  });
  for (const recorded of result.questions) {
    if (questions.some((question) => question.id === recorded.id)) continue;
    merged.push({
      id: recorded.id,
      question: recorded.question,
      options: [],
      answer: recorded.answer,
      skipped: recorded.skipped,
    });
  }
  return { questions: merged, dismissed: result.dismissed };
}

/** Streaming arguments → question sections; open objects have missing fields. */
export function askUserDraftQuestions(
  source: ToolArgumentSource,
): AskUserViewQuestion[] {
  const sources = source.objectArraySources("questions", 5);
  if (sources.length === 0) {
    const legacy = source.string("question");
    return legacy === undefined
      ? []
      : [
          {
            id: "answer",
            question: legacy,
            context: source.string("context"),
            recommendation: source.string("recommendation"),
            options: [],
          },
        ];
  }
  return sources.map((entry, index) => ({
    id: entry.string("id") ?? `q${index + 1}`,
    question: entry.string("question"),
    context: entry.string("context"),
    recommendation: entry.string("recommendation"),
    options: entry.objectArraySources("options", 6).map((option) => ({
      label: option.string("label"),
      description: option.string("description"),
      recommended: option.boolean("recommended"),
    })),
  }));
}

export type AskUserAnswerDraft = { option?: string; text?: string };

/** Answers to submit: trimmed, and questions with nothing entered are omitted. */
export function projectAskUserAnswers(
  questions: ReadonlyArray<{ id: string }>,
  drafts: Readonly<Record<string, AskUserAnswerDraft | undefined>>,
): Record<string, UserInputAnswer> {
  const answers: Record<string, UserInputAnswer> = {};
  for (const { id } of questions) {
    const draft = drafts[id];
    const option = draft?.option;
    const answerText = draft?.text?.trim();
    if (!option && !answerText) continue;
    answers[id] = {
      ...(option ? { option } : {}),
      ...(answerText ? { text: answerText } : {}),
    };
  }
  return answers;
}

/** `idle`: not yet askable (streaming or about to be asked) or not yet recorded. */
export type AskUserPhase =
  | "idle"
  | "waiting"
  | "answered"
  | "skipped"
  | "dismissed";

/** Phase of one question section given the call-level state. */
export function askUserQuestionPhase(input: {
  pending: boolean;
  /** The call reached a terminal state, so the recorded result is final. */
  settled: boolean;
  dismissed: boolean;
  answer: UserInputAnswer | undefined;
}): AskUserPhase {
  if (input.pending) return "waiting";
  if (!input.settled) return "idle";
  if (input.answer?.option || input.answer?.text) return "answered";
  return input.dismissed ? "dismissed" : "skipped";
}
