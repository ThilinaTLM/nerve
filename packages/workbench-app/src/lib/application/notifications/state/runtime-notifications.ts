import type {
  ConversationRecord,
  EventEnvelope,
  ProjectRecord,
} from "$lib/api";
import type { DesktopNotificationPayload } from "$lib/platform/desktop/desktop-bridge.svelte";
import type { NotificationSoundEvent } from "$lib/application/notifications/notify.svelte";

type RuntimeNotificationKind = "success" | "error" | "message";

export type RuntimeNotification = {
  payload: DesktopNotificationPayload;
  backgroundOnly: boolean;
  kind?: RuntimeNotificationKind;
  soundEvent: NotificationSoundEvent;
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
    case "toolCall.updated":
      return toolInteractionNotification(event, context);
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

function toolInteractionNotification(
  event: EventEnvelope<Record<string, unknown>>,
  context: RuntimeNotificationContext,
): RuntimeNotification | undefined {
  const toolCall = recordValue(event.data.toolCall);
  const interactions = Array.isArray(toolCall?.interactions)
    ? toolCall.interactions
    : [];
  const interaction = interactions
    .map(recordValue)
    .find((candidate) => candidate?.status === "pending");
  if (!interaction) return undefined;
  const request = recordValue(interaction.request);
  const kind = stringValue(interaction.kind);
  const toolName = stringValue(toolCall?.toolName);
  const ordinal =
    typeof interaction.ordinal === "number" ? interaction.ordinal : 0;
  const toolCallId = stringValue(toolCall?.id);
  const location = locationText(event, context);
  if (kind === "approval") {
    return {
      backgroundOnly: false,
      kind: "error",
      soundEvent: "approval",
      tag: tagFrom(
        "approval",
        toolCallId ? `${toolCallId}:${ordinal}` : undefined,
      ),
      payload: {
        title: toolName ? `Approval needed: ${toolName}` : "Approval needed",
        body: bodyText([
          stringValue(request?.reason) ??
            "An agent is waiting for tool approval.",
          location,
        ]),
        urgency: "attention",
      },
    };
  }
  if (kind === "user_input") {
    return {
      backgroundOnly: false,
      kind: "message",
      soundEvent: "question",
      tag: tagFrom(
        "question",
        toolCallId ? `${toolCallId}:${ordinal}` : undefined,
      ),
      payload: {
        title: "Agent needs input",
        body: bodyText([
          stringValue(request?.question) ??
            "An agent is waiting for your reply.",
          location,
        ]),
        urgency: "attention",
      },
    };
  }
  if (kind === "plan_review") {
    return {
      backgroundOnly: false,
      kind: "message",
      soundEvent: "planReview",
      tag: tagFrom(
        "plan-review",
        toolCallId ? `${toolCallId}:${ordinal}` : undefined,
      ),
      payload: {
        title: stringValue(request?.title) ?? "Plan ready for review",
        body: bodyText([
          stringValue(request?.summary) ?? "Review the proposed plan.",
          location,
        ]),
        urgency: "attention",
      },
    };
  }
  return undefined;
}

function runCompletedNotification(
  event: EventEnvelope<Record<string, unknown>>,
  context: RuntimeNotificationContext,
): RuntimeNotification {
  return {
    backgroundOnly: true,
    kind: "success",
    soundEvent: "completed",
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
      soundEvent: "failed",
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
    soundEvent: "failed",
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
