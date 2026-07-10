import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type TodoItem = { todo: string; done: boolean };

export class TodoStore {
  constructor(private readonly stateDir: string) {}

  async set(
    scope: { conversationId?: string; agentId?: string; runId?: string },
    todos: TodoItem[],
  ): Promise<TodoItem[]> {
    const bounded = todos.slice(0, 200).map((todo) => ({
      todo: String(todo.todo ?? "").slice(0, 2_000),
      done: Boolean(todo.done),
    }));
    const file = this.fileFor(scope);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      JSON.stringify(
        { todos: bounded, updatedAt: new Date().toISOString() },
        null,
        2,
      ),
    );
    return bounded;
  }

  async get(scope: {
    conversationId?: string;
    agentId?: string;
    runId?: string;
  }): Promise<TodoItem[]> {
    try {
      const parsed = JSON.parse(
        await readFile(this.fileFor(scope), "utf8"),
      ) as { todos?: TodoItem[] };
      return Array.isArray(parsed.todos) ? parsed.todos : [];
    } catch (error) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        (error as { code?: unknown }).code === "ENOENT"
      )
        return [];
      throw error;
    }
  }

  private fileFor(scope: {
    conversationId?: string;
    agentId?: string;
    runId?: string;
  }): string {
    return path.join(
      this.stateDir,
      "conversations",
      safe(scope.conversationId ?? "conv_unknown"),
      "agents",
      safe(scope.agentId ?? "agent_main"),
      "runs",
      safe(scope.runId ?? "run_unknown"),
      "todos.json",
    );
  }
}

function safe(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}
