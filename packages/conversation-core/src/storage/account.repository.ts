import type { SQLOutputValue } from "node:sqlite";
import type { CoreDatabase } from "./database.js";

export type AccountStatus = "ready" | "needs_sign_in" | "failed";

/** An account row without its credential: only the credential vault reads that. */
export type AccountRow = {
  id: string;
  kind: string;
  /** NULL: a user-level account. */
  projectId: string | null;
  name: string;
  /** Non-secret field values. */
  fields: Record<string, unknown>;
  hasCredential: boolean;
  status: AccountStatus;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NewAccount = Omit<
  AccountRow,
  "hasCredential" | "lastUsedAt" | "expiresAt" | "status"
> &
  Partial<Pick<AccountRow, "lastUsedAt" | "expiresAt" | "status">> & {
    credential?: Uint8Array | null;
  };

const COLUMNS =
  "id, kind, project_id, name, fields, credential IS NOT NULL AS has_credential, status, expires_at, last_used_at, created_at, updated_at";

/** The `account` table. Levels: `project_id` NULL is user-level, otherwise project-level. */
export class AccountRepository {
  constructor(private readonly db: CoreDatabase) {}

  get(id: string): AccountRow | null {
    const row = this.db.sqlite
      .prepare(`SELECT ${COLUMNS} FROM account WHERE id = ?`)
      .get(id);
    return row ? mapAccount(row) : null;
  }

  /** Every account of every level, for the Accounts page. */
  list(): AccountRow[] {
    return this.db.sqlite
      .prepare(`SELECT ${COLUMNS} FROM account ORDER BY kind, name, id`)
      .all()
      .map(mapAccount);
  }

  /**
   * The accounts a project sees: user-level ones and its own. Without a project, only the
   * user-level ones.
   */
  listVisible(projectId: string | null, kind?: string): AccountRow[] {
    return this.db.sqlite
      .prepare(
        `SELECT ${COLUMNS} FROM account WHERE (project_id IS NULL OR project_id = ?) AND (? IS NULL OR kind = ?) ORDER BY kind, name, id`,
      )
      .all(projectId, kind ?? null, kind ?? null)
      .map(mapAccount);
  }

  insert(input: NewAccount): void {
    this.db.sqlite
      .prepare(
        "INSERT INTO account (id, kind, project_id, name, fields, credential, status, expires_at, last_used_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        input.id,
        input.kind,
        input.projectId,
        input.name,
        JSON.stringify(input.fields),
        input.credential ?? null,
        input.status ?? (input.credential ? "ready" : "needs_sign_in"),
        input.expiresAt ?? null,
        input.lastUsedAt ?? null,
        input.createdAt,
        input.updatedAt,
      );
  }

  /** The name and non-secret fields; the credential and level are untouched. */
  updateDetails(
    id: string,
    patch: { name: string; fields: Record<string, unknown>; updatedAt: string },
  ): void {
    this.db.sqlite
      .prepare(
        "UPDATE account SET name = ?, fields = ?, updated_at = ? WHERE id = ?",
      )
      .run(patch.name, JSON.stringify(patch.fields), patch.updatedAt, id);
  }

  /** Changes the level: a project id, or NULL for user-level. */
  move(id: string, projectId: string | null, updatedAt: string): void {
    this.db.sqlite
      .prepare("UPDATE account SET project_id = ?, updated_at = ? WHERE id = ?")
      .run(projectId, updatedAt, id);
  }

  /** The encrypted credential, for the vault. */
  readCredential(id: string): Uint8Array | null {
    const row = this.db.sqlite
      .prepare("SELECT credential FROM account WHERE id = ?")
      .get(id);
    return row?.credential instanceof Uint8Array ? row.credential : null;
  }

  /** Credential, status and expiry change together (a refresh writes them in one statement). */
  writeCredential(
    id: string,
    value: {
      credential: Uint8Array | null;
      status: AccountStatus;
      expiresAt: string | null;
      updatedAt: string;
    },
  ): void {
    this.db.sqlite
      .prepare(
        "UPDATE account SET credential = ?, status = ?, expires_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        value.credential,
        value.status,
        value.expiresAt,
        value.updatedAt,
        id,
      );
  }

  touch(id: string, at: string): void {
    this.db.sqlite
      .prepare("UPDATE account SET last_used_at = ? WHERE id = ?")
      .run(at, id);
  }

  delete(id: string): void {
    this.db.sqlite.prepare("DELETE FROM account WHERE id = ?").run(id);
  }

  /**
   * Accounts the refresh sweep looks at: ready, expiring before `expiresBefore` and used after
   * `usedAfter` (ISO timestamps). Whether a refresh token exists is in the credential.
   */
  refreshCandidates(input: {
    expiresBefore: string;
    usedAfter: string;
  }): AccountRow[] {
    return this.db.sqlite
      .prepare(
        `SELECT ${COLUMNS} FROM account WHERE expires_at IS NOT NULL AND expires_at < ? AND last_used_at > ? AND status = 'ready' ORDER BY expires_at, id`,
      )
      .all(input.expiresBefore, input.usedAfter)
      .map(mapAccount);
  }
}

function mapAccount(row: Record<string, SQLOutputValue>): AccountRow {
  return {
    id: row.id as string,
    kind: row.kind as string,
    projectId: (row.project_id as string | null) ?? null,
    name: row.name as string,
    fields: JSON.parse(row.fields as string) as Record<string, unknown>,
    hasCredential: Number(row.has_credential) === 1,
    status: row.status as AccountStatus,
    expiresAt: (row.expires_at as string | null) ?? null,
    lastUsedAt: (row.last_used_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
