import type { ToolHandlerRegistry } from "../types.js";
import { parseTodos, type TodoItem } from "./args.js";
import { contentResult, formatTodoSummary } from "./results.js";

export type TodoPort = {
  get(scope: unknown): Promise<TodoItem[]>;
  set(scope: unknown, todos: TodoItem[]): Promise<TodoItem[]>;
};

export function createTodoHandlers(port: TodoPort): ToolHandlerRegistry {
  return {
    todos_get: async (_args, context) => {
      const todos = await port.get(context.identity);
      return contentResult(formatTodoSummary(todos), { todos });
    },
    todos_set: async (args, context) => {
      const todos = await port.set(context.identity, parseTodos(args));
      return contentResult(formatTodoSummary(todos), { todos });
    },
  };
}
