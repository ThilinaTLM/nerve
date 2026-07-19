export type IdPrefix =
  | "daemon"
  | "evt"
  | "proj"
  | "conv"
  | "agent"
  | "run"
  | "turn"
  | "msg"
  | "ses"
  | "ack"
  | "rpl"
  | "trc"
  | "cli"
  | "orc"
  | "bat"
  | "req"
  | "block"
  | "proc"
  | "task"
  | "taskgrp"
  | "entry"
  | "tool"
  | "approval"
  | "question"
  | "plan_review"
  | "susp"
  | "worker"
  | "authflow"
  | "credkey"
  | "log"
  | "crash"
  | "promptq"
  | "pin"
  | "note"
  | "storageop";

const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(time: number, length: number): string {
  let value = time;
  let output = "";
  for (let i = length - 1; i >= 0; i -= 1) {
    output = crockford[value % 32] + output;
    value = Math.floor(value / 32);
  }
  return output;
}

function encodeRandom(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let output = "";
  for (const byte of bytes) {
    output += crockford[byte % 32];
  }
  return output;
}

export function createId(prefix: IdPrefix): `${IdPrefix}_${string}` {
  return `${prefix}_${encodeTime(Date.now(), 10)}${encodeRandom(16)}`;
}
