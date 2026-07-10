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
    placeholder: optionalString(args.placeholder),
  };
}

export function parsePlanRequest(args: Record<string, unknown>) {
  return {
    filePath: requiredString(args.file_path, "file_path"),
    title: optionalString(args.title),
    summary: optionalString(args.summary),
  };
}

export function parseExploreRequest(args: Record<string, unknown>) {
  const task = optionalString(args.task);
  const tasks = Array.isArray(args.tasks) ? args.tasks : undefined;
  if ((task ? 1 : 0) + (tasks ? 1 : 0) !== 1) {
    throw new ToolValidationError(
      "explore requires exactly one of task or tasks.",
    );
  }
  if (tasks && (tasks.length < 2 || tasks.length > 5)) {
    throw new ToolValidationError("explore tasks must contain 2 to 5 items.");
  }
  return {
    ...args,
    task,
    tasks,
    context: optionalString(args.context),
    label: optionalString(args.label),
    depth:
      typeof args.depth === "number" && Number.isFinite(args.depth)
        ? args.depth
        : undefined,
  };
}

export function parseTaskSelector(
  args: Record<string, unknown>,
  required = true,
) {
  const taskId = optionalString(args.taskId);
  const groupId = optionalString(args.groupId);
  if (taskId && groupId) {
    throw new ToolValidationError("Provide only one of taskId or groupId.");
  }
  if (required && !taskId && !groupId) {
    throw new ToolValidationError("A taskId or groupId is required.");
  }
  return { taskId, groupId };
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
