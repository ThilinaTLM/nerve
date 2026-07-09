import type { VolumeRef } from "@nervekit/shared";
import type { PostgresPool } from "../db/postgres.js";
import { dbTables } from "../db/tables.js";
import type { PreparedRuntimeVolumes } from "./volume-provider.js";

export interface RuntimeVolumeStore {
  put(
    sandboxId: string,
    backend: string,
    refs: PreparedRuntimeVolumes,
  ): Promise<void>;
  get(
    sandboxId: string,
  ): Promise<(PreparedRuntimeVolumes & { backend: string }) | undefined>;
}

export class PostgresRuntimeVolumeStore implements RuntimeVolumeStore {
  constructor(private readonly pool: PostgresPool) {}

  async put(
    sandboxId: string,
    backend: string,
    refs: PreparedRuntimeVolumes,
  ): Promise<void> {
    await this.pool.query(
      `insert into ${dbTables.runtimeVolumes}
        (sandbox_id, workspace_ref, state_ref, secrets_ref, config_ref, tmp_ref, backend, updated_at)
       values ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7, now())
       on conflict (sandbox_id) do update set
        workspace_ref = excluded.workspace_ref,
        state_ref = excluded.state_ref,
        secrets_ref = excluded.secrets_ref,
        config_ref = excluded.config_ref,
        tmp_ref = excluded.tmp_ref,
        backend = excluded.backend,
        updated_at = now()`,
      [
        sandboxId,
        JSON.stringify(refs.workspace),
        JSON.stringify(refs.state),
        JSON.stringify(refs.secrets),
        refs.config ? JSON.stringify(refs.config) : null,
        refs.tmp ? JSON.stringify(refs.tmp) : null,
        backend,
      ],
    );
  }

  async get(
    sandboxId: string,
  ): Promise<(PreparedRuntimeVolumes & { backend: string }) | undefined> {
    const result = await this.pool.query<{
      workspace_ref: VolumeRef;
      state_ref: VolumeRef;
      secrets_ref: VolumeRef;
      config_ref: VolumeRef | null;
      tmp_ref: VolumeRef | null;
      backend: string;
    }>(`select * from ${dbTables.runtimeVolumes} where sandbox_id = $1`, [
      sandboxId,
    ]);
    const row = result.rows[0];
    return row
      ? {
          workspace: row.workspace_ref,
          state: row.state_ref,
          secrets: row.secrets_ref,
          config: row.config_ref ?? undefined,
          tmp: row.tmp_ref ?? undefined,
          backend: row.backend,
        }
      : undefined;
  }
}
