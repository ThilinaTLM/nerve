import type { ToolCallRecord } from "@nervekit/contracts/tools";

export type TodoItem = { todo: string; done: boolean };

export class TodoStateService {
  private readonly todoLists = new Map<string, TodoItem[]>();
  private readonly hydratedVersions = new Map<string, string>();

  resetToolCallHydration(): void {
    this.todoLists.clear();
    this.hydratedVersions.clear();
  }

  hydrateFromToolCall(toolCall: ToolCallRecord): void {
    if (toolCall.toolName !== "todos_set" || toolCall.status !== "completed") {
      return;
    }
    const version = `${toolCall.updatedAt}:${toolCall.id}`;
    if ((this.hydratedVersions.get(toolCall.agentId) ?? "") >= version) return;
    const resultRecord = recordFromUnknown(toolCall.result);
    const details = recordFromUnknown(resultRecord.details);
    const items =
      parseTodoItems(details.todos) ??
      parseTodoItems(recordFromUnknown(toolCall.args).todos);
    if (!items) return;
    this.set(toolCall.agentId, items);
    this.hydratedVersions.set(toolCall.agentId, version);
  }

  hydrateFromToolCalls(toolCalls: ToolCallRecord[]): void {
    this.resetToolCallHydration();
    for (const toolCall of toolCalls) this.hydrateFromToolCall(toolCall);
  }

  set(agentId: string, items: TodoItem[]): void {
    this.todoLists.set(agentId, cloneTodos(items));
  }

  get(agentId: string): TodoItem[] {
    return cloneTodos(this.todoLists.get(agentId) ?? []);
  }

  delete(agentId: string): void {
    this.todoLists.delete(agentId);
    this.hydratedVersions.delete(agentId);
  }
}

export function todoItemsArg(args: Record<string, unknown>): TodoItem[] {
  const items = parseTodoItems(args.todos);
  if (!items) {
    throw new Error("Tool argument 'todos' must be an array of todo items.");
  }
  return items;
}

export function todosResult(items: TodoItem[]): {
  contentBlocks: Array<{ type: "text"; text: string }>;
  details: { todos: TodoItem[] };
} {
  const snapshot = cloneTodos(items);
  return {
    contentBlocks: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }],
    details: { todos: snapshot },
  };
}

function parseTodoItems(value: unknown): TodoItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: TodoItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return undefined;
    const record = item as Record<string, unknown>;
    if (typeof record.todo !== "string" || typeof record.done !== "boolean") {
      return undefined;
    }
    items.push({ todo: record.todo, done: record.done });
  }
  return items;
}

function cloneTodos(items: TodoItem[]): TodoItem[] {
  return items.map((item) => ({ ...item }));
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
