import type {
  ConversationRecord,
  EventEnvelope,
  ProjectRecord,
} from "$lib/api";
import type { DesktopNotificationPayload } from "$lib/features/desktop/state/desktop-bridge.svelte";

type RuntimeNotificationKind = "success" | "error" | "message";

export type RuntimeNotification = {
  payload: DesktopNotificationPayload;
  backgroundOnly: boolean;
  kind?: RuntimeNotificationKind;
  tag?: string;
};

export type RuntimeNotificationContext = {
  projects: Pick<ProjectRecord, "id" | "name" | "dir">[];
  conversations: Pick<ConversationRecord, "id" | "title">[];
};

export function notificationForRuntimeEvent(
  event: EventEnvelope<Record<string, unknown>>,
  context: RuntimeNotificationContext,
): RuntimeNotification | undefined {
  switch (event.type) {
    case "approval.requested":
      return approvalNotification(event, context);
    case "userQuestion.requested":
      return userQuestionNotification(event, context);
    case "planReview.requested":
      return planReviewNotification(event, context);
    case "run.completed":
      return runCompletedNotification(event, context);
    case "run.failed":
      return runFailedNotification(event, context);
    case "run.suspended":
      return undefined;
    default:
      return undefined;
  }
}

function approvalNotification(
  event: EventEnvelope<Record<string, unknown>>,
  context: RuntimeNotificationContext,
): RuntimeNotification {
  const approval = recordValue(event.data?.approval);
  const toolCall = recordValue(event.data?.toolCall);
  const toolName = stringValue(toolCall?.toolName);
  const risk = stringValue(approval?.risk) ?? stringValue(toolCall?.risk);
  const reason = stringValue(approval?.reason);
  return {
    backgroundOnly: false,
    kind: "error",
    tag: tagFrom("approval", stringValue(approval?.id)),
    payload: {
      title: toolName ? `Approval needed: ${toolName}` : "Approval needed",
      body: bodyText([
        risk ? `Risk: ${risk}` : undefined,
        reason ?? "An agent is waiting for tool approval.",
        locationText(event, context),
      ]),
      urgency: "attention",
    },
  };
}

function userQuestionNotification(
  event: EventEnvelope<Record<string, unknown>>,
  context: RuntimeNotificationContext,
): RuntimeNotification {
  const question = recordValue(event.data?.question);
  const questionText = stringValue(question?.question);
  const questionContext = stringValue(question?.context);
  const recommendation = stringValue(question?.recommendation);
  return {
    backgroundOnly: false,
    kind: "error",
    tag: tagFrom("question", stringValue(question?.id)),
    payload: {
      title: "Nerve needs your answer",
      body: bodyText([
        questionText ?? "An agent asked a question.",
        questionContext ? `Context: ${questionContext}` : undefined,
        recommendation ? `Recommendation: ${recommendation}` : undefined,
        locationText(event, context),
      ]),
      urgency: "attention",
    },
  };
}

function planReviewNotification(
  event: EventEnvelope<Record<string, unknown>>,
  context: RuntimeNotificationContext,
): RuntimeNotification {
  const review = recordValue(event.data?.planReview);
  const title = stringValue(review?.title);
  const summary = stringValue(review?.summary);
  const planPath = stringValue(review?.planPath);
  return {
    backgroundOnly: false,
    kind: "error",
    tag: tagFrom("plan-review", stringValue(review?.id)),
    payload: {
      title: title ? `Plan ready: ${title}` : "Plan ready for review",
      body: bodyText([
        title,
        summary ?? "An agent submitted a plan for review.",
        planPath ? `Plan: ${planPath}` : undefined,
        locationText(event, context),
      ]),
      urgency: "attention",
    },
  };
}

function runCompletedNotification(
  event: EventEnvelope<Record<string, unknown>>,
  context: RuntimeNotificationContext,
): RuntimeNotification {
  return {
    backgroundOnly: true,
    kind: "success",
    tag: tagFrom("run-completed", stringValue(event.data?.runId)),
    payload: {
      title: "Agent run completed",
      body: bodyText([locationText(event, context)]) ?? "Nerve finished a run.",
      urgency: "normal",
    },
  };
}

function runFailedNotification(
  event: EventEnvelope<Record<string, unknown>>,
  context: RuntimeNotificationContext,
): RuntimeNotification | undefined {
  if (event.data?.aborted === true) return undefined;

  const retryExhausted = recordValue(event.data?.retryExhausted);
  if (retryExhausted) {
    const maxRetries = numberValue(retryExhausted.maxRetries);
    const message =
      stringValue(retryExhausted.errorMessage) ??
      stringValue(event.data?.message);
    return {
      backgroundOnly: false,
      kind: "error",
      tag: tagFrom("run-retry-exhausted", stringValue(event.data?.runId)),
      payload: {
        title: "Model request needs retry",
        body: bodyText([
          maxRetries === undefined
            ? "Model request failed after retries. Open Nerve and click Continue."
            : `Model request failed after ${maxRetries} ${maxRetries === 1 ? "retry" : "retries"}. Open Nerve and click Continue.`,
          message,
          locationText(event, context),
        ]),
        urgency: "attention",
      },
    };
  }

  return {
    backgroundOnly: true,
    kind: "error",
    tag: tagFrom("run-failed", stringValue(event.data?.runId)),
    payload: {
      title: "Agent run failed",
      body: bodyText([
        stringValue(event.data?.message) ?? "Nerve hit an agent error.",
        locationText(event, context),
      ]),
      urgency: "attention",
    },
  };
}

function locationText(
  event: EventEnvelope<Record<string, unknown>>,
  context: RuntimeNotificationContext,
): string | undefined {
  return bodyText([
    conversationLabel(event, context),
    projectLabel(event, context),
  ]);
}

function conversationLabel(
  event: EventEnvelope<Record<string, unknown>>,
  context: RuntimeNotificationContext,
): string | undefined {
  const conversationId = eventField(event, "conversationId");
  if (!conversationId) return undefined;
  const title = context.conversations.find(
    (conversation) => conversation.id === conversationId,
  )?.title;
  return title ? `Chat: ${title}` : undefined;
}

function projectLabel(
  event: EventEnvelope<Record<string, unknown>>,
  context: RuntimeNotificationContext,
): string | undefined {
  const projectId = eventField(event, "projectId");
  if (!projectId) return undefined;
  const project = context.projects.find(
    (candidate) => candidate.id === projectId,
  );
  if (!project) return undefined;
  return `Project: ${project.name || project.dir}`;
}

function eventField(
  event: EventEnvelope<Record<string, unknown>>,
  field: string,
): string | undefined {
  const direct = stringValue(event.data?.[field]);
  if (direct) return direct;
  for (const key of ["approval", "question", "planReview", "toolCall"]) {
    const nested = stringValue(recordValue(event.data?.[key])?.[field]);
    if (nested) return nested;
  }
  return undefined;
}

function bodyText(parts: Array<string | undefined>): string | undefined {
  const text = parts.filter(Boolean).join(" · ");
  return text ? shortNotificationText(text) : undefined;
}

function shortNotificationText(value: string): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length <= 220 ? singleLine : `${singleLine.slice(0, 219)}…`;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function tagFrom(prefix: string, id: string | undefined): string | undefined {
  return id ? `nerve:${prefix}:${id}` : undefined;
}
