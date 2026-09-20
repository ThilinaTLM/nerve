import type { StatusTone } from "@nervekit/ui-kit/display/status";
import type { ConversationRecord } from "@nervekit/contracts/conversations";
import type { PlanReviewRecord } from "@nervekit/contracts/plans";
import type {
  ApprovalRecord,
  ToolCallTranscriptRecord,
  UserQuestionRecord,
} from "@nervekit/contracts/tools";

/**
 * Away-from-desk triage model for the phone shell: everything that wants a
 * human, then everything still moving, joined onto the conversation it belongs
 * to so a single tap lands in the right transcript.
 */
export type MobileInboxKind =
  | "approval"
  | "question"
  | "plan"
  | "error"
  | "running";

export type MobileInboxItem = {
  id: string;
  kind: MobileInboxKind;
  conversationId: string;
  title: string;
  /** What is being asked for, e.g. "Approval" or "Plan review". */
  kindLabel: string;
  detail: string;
  projectLabel?: string;
  tone: StatusTone;
  pulse: boolean;
  at?: string;
};

type ApprovalWithToolCall = ApprovalRecord & {
  toolCall?: ToolCallTranscriptRecord;
};

/** Risks that deserve the red tint in a list read at arm's length. */
const HIGH_RISK = new Set<ApprovalRecord["risk"]>([
  "destructive",
  "secret",
  "deployment",
]);

type ActivityLike = {
  indicator: "idle" | "running" | "needs-user" | "error" | "completed";
  tone: StatusTone;
  label?: string;
  busy: boolean;
};

export type MobileInboxInput = {
  approvals: readonly ApprovalWithToolCall[];
  userQuestions: readonly UserQuestionRecord[];
  planReviews: readonly PlanReviewRecord[];
  conversations: readonly ConversationRecord[];
  projectNameById?: Readonly<Record<string, string>>;
  activityById?: Readonly<Record<string, ActivityLike>>;
};

export type MobileInboxModel = {
  needsYou: MobileInboxItem[];
  running: MobileInboxItem[];
};

export function buildMobileInbox(input: MobileInboxInput): MobileInboxModel {
  const conversationsById = new Map(
    input.conversations.map((conversation) => [conversation.id, conversation]),
  );
  const claimed = new Set<string>();
  const needsYou: MobileInboxItem[] = [];

  const describe = (conversationId: string) => {
    const conversation = conversationsById.get(conversationId);
    return {
      title: conversation?.title ?? "Untitled conversation",
      projectLabel: conversation
        ? input.projectNameById?.[conversation.projectId]
        : undefined,
    };
  };

  for (const approval of input.approvals) {
    if (approval.status !== "pending") continue;
    claimed.add(approval.conversationId);
    const { title, projectLabel } = describe(approval.conversationId);
    needsYou.push({
      id: `approval:${approval.id}`,
      kind: "approval",
      kindLabel: "Approval",
      conversationId: approval.conversationId,
      title,
      projectLabel,
      detail: approvalDetail(approval),
      tone: HIGH_RISK.has(approval.risk) ? "destructive" : "warning",
      pulse: false,
      at: approval.requestedAt,
    });
  }

  for (const question of input.userQuestions) {
    if (question.status !== "pending") continue;
    claimed.add(question.conversationId);
    const { title, projectLabel } = describe(question.conversationId);
    needsYou.push({
      id: `question:${question.id}`,
      kind: "question",
      kindLabel: "Question",
      conversationId: question.conversationId,
      title,
      projectLabel,
      detail: firstLine(question.question) || "Question for you",
      tone: "warning",
      pulse: false,
      at: question.requestedAt,
    });
  }

  for (const plan of input.planReviews) {
    if (plan.status !== "pending") continue;
    claimed.add(plan.conversationId);
    const { title, projectLabel } = describe(plan.conversationId);
    needsYou.push({
      id: `plan:${plan.id}`,
      kind: "plan",
      kindLabel: "Plan review",
      conversationId: plan.conversationId,
      title,
      projectLabel,
      detail:
        firstLine(plan.title ?? plan.summary ?? readableSlug(plan.slug)) ||
        "Plan ready for review",
      tone: "info",
      pulse: false,
      at: plan.requestedAt,
    });
  }

  const running: MobileInboxItem[] = [];
  for (const conversation of input.conversations) {
    const activity = input.activityById?.[conversation.id];
    if (!activity) continue;
    const projectLabel = input.projectNameById?.[conversation.projectId];
    if (activity.indicator === "error" && !claimed.has(conversation.id)) {
      claimed.add(conversation.id);
      needsYou.push({
        id: `error:${conversation.id}`,
        kind: "error",
        kindLabel: "Error",
        conversationId: conversation.id,
        title: conversation.title,
        projectLabel,
        detail: activity.label ?? "Needs attention",
        tone: activity.tone,
        pulse: false,
        at: conversation.updatedAt,
      });
      continue;
    }
    if (!activity.busy || claimed.has(conversation.id)) continue;
    running.push({
      id: `running:${conversation.id}`,
      kind: "running",
      kindLabel: "Running",
      conversationId: conversation.id,
      title: conversation.title,
      projectLabel,
      detail: activity.label ?? "Agent running",
      tone: activity.tone,
      pulse: true,
      at: conversation.updatedAt,
    });
  }

  needsYou.sort(byRecency);
  running.sort(byRecency);
  return { needsYou, running };
}

function byRecency(left: MobileInboxItem, right: MobileInboxItem): number {
  return (right.at ?? "").localeCompare(left.at ?? "");
}

function approvalDetail(approval: ApprovalWithToolCall): string {
  const tool = approval.toolCall?.toolName;
  const reason = firstLine(approval.reason ?? "");
  if (tool && reason) return `${tool} · ${reason}`;
  return tool ? `Approve ${tool}` : reason || "Approval requested";
}

/** `mobile-shell-layout.md` reads as a path; "Mobile shell layout" reads. */
function readableSlug(slug: string): string {
  const name = slug
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  if (!name) return slug;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function firstLine(value: string): string {
  const line = value.split("\n").find((entry) => entry.trim().length > 0);
  return line?.trim() ?? "";
}
