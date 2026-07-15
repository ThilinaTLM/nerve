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
  if (!Array.isArray(args.tasks)) {
    throw new ToolValidationError("explore requires a tasks array.");
  }
  if (args.tasks.length < 1 || args.tasks.length > 5) {
    throw new ToolValidationError("explore tasks must contain 1 to 5 items.");
  }
  const tasks = args.tasks.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new ToolValidationError(
        `explore tasks[${index}] must be an object.`,
      );
    }
    const record = item as Record<string, unknown>;
    return {
      task: requiredString(record.task, `tasks[${index}].task`),
      label: optionalString(record.label),
      context: optionalExploreTaskContext(
        record.context,
        `tasks[${index}].context`,
      ),
    };
  });
  return {
    tasks,
    context: requiredString(args.context, "context"),
    split_rationale: optionalString(args.split_rationale),
    depth:
      typeof args.depth === "number" && Number.isFinite(args.depth)
        ? args.depth
        : undefined,
  };
}

function optionalExploreTaskContext(
  value: unknown,
  name: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ToolValidationError(`${name} must be a string when provided.`);
  }
  return optionalString(value);
}

export function parseTaskSelector(
  args: Record<string, unknown>,
  options: {
    required?: boolean;
    allowTaskIds?: boolean;
    maxTaskIds?: number;
  } = {},
) {
  const required = options.required ?? true;
  const taskId = optionalString(args.taskId);
  const groupId = optionalString(args.groupId);
  let taskIds: string[] | undefined;
  if (args.taskIds !== undefined) {
    if (!options.allowTaskIds || !Array.isArray(args.taskIds)) {
      throw new ToolValidationError("taskIds is not supported here.");
    }
    if (args.taskIds.length === 0) {
      throw new ToolValidationError("taskIds must not be empty.");
    }
    const max = options.maxTaskIds ?? 20;
    if (args.taskIds.length > max) {
      throw new ToolValidationError(`taskIds accepts at most ${max} entries.`);
    }
    taskIds = args.taskIds.map((value, index) =>
      requiredString(value, `taskIds[${index}]`),
    );
  }
  const selectorCount = [taskId, taskIds, groupId].filter(Boolean).length;
  if (selectorCount > 1) {
    throw new ToolValidationError(
      "Provide only one of taskId, taskIds, or groupId.",
    );
  }
  if (required && selectorCount === 0) {
    throw new ToolValidationError("A taskId, taskIds, or groupId is required.");
  }
  return { taskId, taskIds, groupId };
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
