import type { ToolExecutionResult } from "../../types.js";

export function contentResult(
  content: string,
  details?: unknown,
): ToolExecutionResult {
  return { content, details };
}

export function boundedSummary(text: string, maxChars = 24_000): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 80))}\n\n[Output truncated; inspect the durable host record for full details.]`;
}

export function formatTodoSummary(
  todos: readonly { todo: string; done: boolean }[],
): string {
  if (todos.length === 0) return "No todos are set.";
  const completed = todos.filter((todo) => todo.done).length;
  return [
    `Todos: ${completed}/${todos.length} complete.`,
    ...todos.map((todo) => `- [${todo.done ? "x" : " "}] ${todo.todo}`),
  ].join("\n");
}
