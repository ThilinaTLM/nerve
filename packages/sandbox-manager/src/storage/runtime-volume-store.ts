import type { VolumeRef } from "@nervekit/shared";
import type { PostgresPool } from "../db/postgres.js";
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
      `insert into runtime_volumes
        (sandbox_id, workspace_ref, state_ref, secrets_ref, config_ref, backend, updated_at)
       values ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6, now())
       on conflict (sandbox_id) do update set
        workspace_ref = excluded.workspace_ref,
        state_ref = excluded.state_ref,
        secrets_ref = excluded.secrets_ref,
        config_ref = excluded.config_ref,
        backend = excluded.backend,
        updated_at = now()`,
      [
        sandboxId,
        JSON.stringify(refs.workspace),
        JSON.stringify(refs.state),
        JSON.stringify(refs.secrets),
        refs.config ? JSON.stringify(refs.config) : null,
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
      backend: string;
    }>("select * from runtime_volumes where sandbox_id = $1", [sandboxId]);
    const row = result.rows[0];
    return row
      ? {
          workspace: row.workspace_ref,
          state: row.state_ref,
          secrets: row.secrets_ref,
          config: row.config_ref ?? undefined,
          backend: row.backend,
        }
      : undefined;
  }
}
