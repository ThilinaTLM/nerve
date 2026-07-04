import {
  type SandboxManagerCredentialProfile,
  type SandboxManagerCredentialProfileKind,
  sandboxManagerCredentialProfileSchema,
} from "@nervekit/shared";
import type { PostgresPool } from "../db/postgres.js";

export interface CredentialProfileStore {
  list(
    kind?: SandboxManagerCredentialProfileKind,
  ): Promise<SandboxManagerCredentialProfile[]>;
  get(profileId: string): Promise<SandboxManagerCredentialProfile | undefined>;
  put(profile: SandboxManagerCredentialProfile): Promise<void>;
  delete(profileId: string): Promise<void>;
}

export class PostgresCredentialProfileStore implements CredentialProfileStore {
  constructor(private readonly pool: PostgresPool) {}

  async list(
    kind?: SandboxManagerCredentialProfileKind,
  ): Promise<SandboxManagerCredentialProfile[]> {
    const result = kind
      ? await this.pool.query<{ profile: unknown }>(
          "select profile from credential_profiles where kind = $1 order by display_name, profile_id",
          [kind],
        )
      : await this.pool.query<{ profile: unknown }>(
          "select profile from credential_profiles order by kind, display_name, profile_id",
        );
    return result.rows.map((row) =>
      sandboxManagerCredentialProfileSchema.parse(row.profile),
    );
  }

  async get(
    profileId: string,
  ): Promise<SandboxManagerCredentialProfile | undefined> {
    const result = await this.pool.query<{ profile: unknown }>(
      "select profile from credential_profiles where profile_id = $1",
      [profileId],
    );
    const row = result.rows[0];
    return row
      ? sandboxManagerCredentialProfileSchema.parse(row.profile)
      : undefined;
  }

  async put(profile: SandboxManagerCredentialProfile): Promise<void> {
    const parsed = sandboxManagerCredentialProfileSchema.parse(profile);
    await this.pool.query(
      `insert into credential_profiles
        (profile_id, kind, display_name, profile, created_at, updated_at)
       values ($1, $2, $3, $4::jsonb, $5, $6)
       on conflict (profile_id) do update set
         kind = excluded.kind,
         display_name = excluded.display_name,
         profile = excluded.profile,
         updated_at = excluded.updated_at`,
      [
        parsed.profileId,
        parsed.kind,
        parsed.displayName,
        JSON.stringify(parsed),
        parsed.createdAt,
        parsed.updatedAt,
      ],
    );
  }

  async delete(profileId: string): Promise<void> {
    await this.pool.query(
      "delete from credential_profiles where profile_id = $1",
      [profileId],
    );
  }
}
