export type { CoreToolCard } from "./transcript-types";
export type { ContextUsage, ModelInfo } from "@nervekit/contracts/models";
export type { TaskLogEvent, TaskRecord } from "@nervekit/contracts/tasks";
export type UserQuestion = {
  toolCallId: string;
  question: string;
  context?: string;
  recommendation?: string;
  answer?: string;
  status: "pending" | "answered" | "dismissed";
  dismissedReason?: string;
};
