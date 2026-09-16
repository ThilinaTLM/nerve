export interface ReceiptRow {
  fingerprint_hash: string;
  outcome_json: Uint8Array;
}

export interface HeadRow {
  revision: number;
  selection_epoch: number;
  deletion_state: string;
}
