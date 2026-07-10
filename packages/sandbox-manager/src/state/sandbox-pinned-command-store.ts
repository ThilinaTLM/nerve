import {
  type CreatePinnedCommandRequest,
  createId,
  type SandboxPinnedCommand,
  sandboxPinnedCommandSchema,
  type UpdatePinnedCommandRequest,
} from "@nervekit/contracts";
import type { PostgresPool } from "../db/postgres.js";
import { dbTables } from "../db/tables.js";
import { HttpError } from "../http/errors.js";

export class SandboxPinnedCommandStore {
  constructor(private readonly pool: PostgresPool) {}

  async list(sandboxId: string): Promise<SandboxPinnedCommand[]> {
    const result = await this.pool.query<{ record: unknown }>(
      `select record from ${dbTables.sandboxPinnedCommands}
       where sandbox_id = $1 order by updated_at desc, command_id`,
      [sandboxId],
    );
    return result.rows.map((row) =>
      sandboxPinnedCommandSchema.parse(row.record),
    );
  }

  async create(
    sandboxId: string,
    request: CreatePinnedCommandRequest,
  ): Promise<SandboxPinnedCommand> {
    const now = new Date().toISOString();
    const command = sandboxPinnedCommandSchema.parse({
      id: createId("pin"),
      sandboxId,
      label: request.label,
      command: request.command,
      cwd: request.cwd,
      createdAt: now,
      updatedAt: now,
    });
    await this.pool.query(
      `insert into ${dbTables.sandboxPinnedCommands}
        (sandbox_id, command_id, record, created_at, updated_at)
       values ($1, $2, $3::jsonb, now(), now())`,
      [sandboxId, command.id, JSON.stringify(command)],
    );
    return command;
  }

  async update(
    sandboxId: string,
    commandId: string,
    request: UpdatePinnedCommandRequest,
  ): Promise<SandboxPinnedCommand> {
    const existing = await this.get(sandboxId, commandId);
    if (!existing) throw this.notFound();
    const updated = sandboxPinnedCommandSchema.parse({
      ...existing,
      label: request.label,
      command: request.command,
      cwd: request.cwd,
      updatedAt: new Date().toISOString(),
    });
    await this.pool.query(
      `update ${dbTables.sandboxPinnedCommands}
       set record = $3::jsonb, updated_at = now()
       where sandbox_id = $1 and command_id = $2`,
      [sandboxId, commandId, JSON.stringify(updated)],
    );
    return updated;
  }

  async delete(sandboxId: string, commandId: string): Promise<void> {
    const result = await this.pool.query(
      `delete from ${dbTables.sandboxPinnedCommands}
       where sandbox_id = $1 and command_id = $2`,
      [sandboxId, commandId],
    );
    if ((result.rowCount ?? 0) === 0) throw this.notFound();
  }

  private async get(
    sandboxId: string,
    commandId: string,
  ): Promise<SandboxPinnedCommand | undefined> {
    const result = await this.pool.query<{ record: unknown }>(
      `select record from ${dbTables.sandboxPinnedCommands}
       where sandbox_id = $1 and command_id = $2`,
      [sandboxId, commandId],
    );
    const row = result.rows[0];
    return row ? sandboxPinnedCommandSchema.parse(row.record) : undefined;
  }

  private notFound(): HttpError {
    return new HttpError(
      404,
      "PINNED_COMMAND_NOT_FOUND",
      "Pinned command not found.",
    );
  }
}
