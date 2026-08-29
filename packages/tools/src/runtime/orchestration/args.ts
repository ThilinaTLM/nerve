import { ToolValidationError } from "../types.js";
import {
  EXPLORE_MAX_CHILDREN_PER_RUN,
  EXPLORE_MAX_TASKS_PER_CALL,
} from "@nervekit/contracts/agents";

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

export function parseExploreRequest(args: Record<string, unknown>) {
  if (!Array.isArray(args.tasks)) {
    throw new ToolValidationError("explore requires a tasks array.");
  }
  if (args.tasks.length < 1) {
    throw new ToolValidationError("explore requires at least 1 task.");
  }
  if (args.tasks.length > EXPLORE_MAX_TASKS_PER_CALL) {
    throw new ToolValidationError(
      `explore received ${args.tasks.length} tasks, but one call accepts at most ${EXPLORE_MAX_TASKS_PER_CALL}. Split independent work into multiple explore calls; all calls share ${EXPLORE_MAX_CHILDREN_PER_RUN} child launches per parent run.`,
    );
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

export function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ToolValidationError(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
