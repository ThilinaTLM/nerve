import type { PostgresPool } from "../db/postgres.js";
import { dbTables } from "../db/tables.js";
import type { SecretPolicy } from "./secret-policy.js";

export interface SecretPolicyStore {
  put(policy: SecretPolicy): Promise<void>;
  get(sandboxId: string): Promise<SecretPolicy | undefined>;
}

export class PostgresSecretPolicyStore implements SecretPolicyStore {
  constructor(private readonly pool: PostgresPool) {}

  async put(policy: SecretPolicy): Promise<void> {
    if (!policy.sandboxId) throw new Error("secret policy requires sandboxId");
    await this.pool.query(
      `insert into ${dbTables.secretPolicies} (sandbox_id, policy, updated_at)
       values ($1, $2::jsonb, now())
       on conflict (sandbox_id) do update set
         policy = excluded.policy,
         updated_at = now()`,
      [policy.sandboxId, JSON.stringify(policy)],
    );
  }

  async get(sandboxId: string): Promise<SecretPolicy | undefined> {
    const result = await this.pool.query<{ policy: unknown }>(
      `select policy from ${dbTables.secretPolicies} where sandbox_id = $1`,
      [sandboxId],
    );
    return result.rows[0]?.policy as SecretPolicy | undefined;
  }
}
