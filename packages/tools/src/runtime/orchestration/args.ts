import {
  normalizeUserInputRequest,
  type UserInputRequest,
} from "@nervekit/contracts/core";
import { ToolValidationError } from "../types.js";

/** ask_user request; accepts `questions[]` and the legacy flat shape. */
export function parseQuestion(args: Record<string, unknown>): UserInputRequest {
  let request: UserInputRequest;
  try {
    request = normalizeUserInputRequest(args);
  } catch {
    throw new ToolValidationError(
      "ask_user requires 1-5 questions, each with a non-empty question.",
    );
  }
  const questions = request.questions.map((entry) => ({
    ...entry,
    question: entry.question.trim(),
  }));
  if (questions.some((entry) => !entry.question)) {
    throw new ToolValidationError("Each ask_user question must be non-empty.");
  }
  return { questions };
}

export function parsePlanRequest(args: Record<string, unknown>) {
  return {
    filePath: requiredString(args.file_path, "file_path"),
  };
}

export function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ToolValidationError(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
