import {
  createId,
  taskDefinitionSchema,
  type CreateTaskDefinitionRequest,
  type TaskDefinition,
  type UpdateTaskDefinitionRequest,
} from "@nervekit/contracts";
import type { PostgresPool } from "../db/postgres.js";
import { dbTables } from "../db/tables.js";

export class SandboxTaskDefinitionStore {
  constructor(private readonly pool: PostgresPool) {}

  async list(sandboxId: string): Promise<TaskDefinition[]> {
    const result = await this.pool.query<{ record: unknown }>(
      `select record from ${dbTables.sandboxTaskDefinitions}
       where sandbox_id = $1 order by updated_at desc`,
      [sandboxId],
    );
    return result.rows.map((row) => taskDefinitionSchema.parse(row.record));
  }

  async create(
    sandboxId: string,
    request: CreateTaskDefinitionRequest,
  ): Promise<TaskDefinition> {
    const now = new Date().toISOString();
    const definition = taskDefinitionSchema.parse({
      id: createId("taskdef"),
      scope: { kind: "sandbox", sandboxId },
      label: request.label,
      command: request.command,
      cwd: request.cwd,
      runPolicy: request.runPolicy,
      createdAt: now,
      updatedAt: now,
    });
    await this.pool.query(
      `insert into ${dbTables.sandboxTaskDefinitions}
        (sandbox_id, definition_id, record, created_at, updated_at)
       values ($1, $2, $3::jsonb, now(), now())`,
      [sandboxId, definition.id, JSON.stringify(definition)],
    );
    return definition;
  }

  async update(
    sandboxId: string,
    definitionId: string,
    request: UpdateTaskDefinitionRequest,
  ): Promise<TaskDefinition> {
    const existing = await this.get(sandboxId, definitionId);
    if (!existing) throw new Error("Task definition not found.");
    const updated = taskDefinitionSchema.parse({
      ...existing,
      label: request.label,
      command: request.command,
      cwd: request.cwd,
      runPolicy: request.runPolicy,
      updatedAt: new Date().toISOString(),
    });
    await this.pool.query(
      `update ${dbTables.sandboxTaskDefinitions}
       set record = $3::jsonb, updated_at = now()
       where sandbox_id = $1 and definition_id = $2`,
      [sandboxId, definitionId, JSON.stringify(updated)],
    );
    return updated;
  }

  async delete(sandboxId: string, definitionId: string): Promise<void> {
    const result = await this.pool.query(
      `delete from ${dbTables.sandboxTaskDefinitions}
       where sandbox_id = $1 and definition_id = $2`,
      [sandboxId, definitionId],
    );
    if (result.rowCount === 0) throw new Error("Task definition not found.");
  }

  private async get(
    sandboxId: string,
    definitionId: string,
  ): Promise<TaskDefinition | undefined> {
    const result = await this.pool.query<{ record: unknown }>(
      `select record from ${dbTables.sandboxTaskDefinitions}
       where sandbox_id = $1 and definition_id = $2`,
      [sandboxId, definitionId],
    );
    const row = result.rows[0];
    return row ? taskDefinitionSchema.parse(row.record) : undefined;
  }
}
