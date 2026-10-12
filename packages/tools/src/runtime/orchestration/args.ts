import { ToolValidationError } from "../types.js";

export type TodoItem = { todo: string; done: boolean };

export function parseTodos(args: Record<string, unknown>): TodoItem[] {
  if (!Array.isArray(args.todos)) {
    throw new ToolValidationError("todos_set requires a todos array.");
  }
  return args.todos.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new ToolValidationError(`Todo ${index + 1} must be an object.`);
    }
    const record = item as Record<string, unknown>;
    if (typeof record.todo !== "string" || !record.todo.trim()) {
      throw new ToolValidationError(
        `Todo ${index + 1} requires non-empty text.`,
      );
    }
    if (typeof record.done !== "boolean") {
      throw new ToolValidationError(
        `Todo ${index + 1} requires a done boolean.`,
      );
    }
    return { todo: record.todo.trim(), done: record.done };
  });
}

export function parseQuestion(args: Record<string, unknown>) {
  const question = requiredString(args.question, "question");
  return {
    question,
    context: optionalString(args.context),
    recommendation: optionalString(args.recommendation),
  };
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
