import type { DatabaseSync } from "node:sqlite";
import type { TimelineDomainDocumentWrite } from "./timeline-command-contracts.js";
import { encode } from "./payload-codecs.js";

export function persistTimelineDomainDocument(
  database: DatabaseSync,
  document: TimelineDomainDocumentWrite,
  nowMs: number,
): boolean {
  const existing = database
    .prepare(
      `SELECT revision, created_at_ms FROM domain_documents
       WHERE namespace = ? AND scope_id = ? AND document_id = ?`,
    )
    .get(document.namespace, document.scopeId, document.documentId) as
    | { revision: number; created_at_ms: number }
    | undefined;
  if ((existing?.revision ?? 0) !== document.expectedRevision) return false;
  database
    .prepare(
      `INSERT INTO domain_documents (
         namespace, scope_id, document_id, revision, payload_version, data,
         created_at_ms, updated_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(namespace, scope_id, document_id) DO UPDATE SET
         revision = excluded.revision,
         payload_version = excluded.payload_version,
         data = excluded.data,
         updated_at_ms = excluded.updated_at_ms`,
    )
    .run(
      document.namespace,
      document.scopeId,
      document.documentId,
      document.expectedRevision + 1,
      document.payloadVersion,
      encode(document.data),
      existing?.created_at_ms ?? nowMs,
      nowMs,
    );
  return true;
}
