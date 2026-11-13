#!/usr/bin/env python3
"""Read-only inspector for a Nerve home (conversation-core SQLite + managed files + logs).

Never writes to the inspected home. Message text, tool arguments, payloads and log
context are shown as lengths unless --preview N is given; titles, reasons, error and
log messages are always shown truncated and redacted. Global options (--home, --db,
--preview) may come before or after the subcommand.

Usage (from anywhere):
  nerve_debug.py --home PATH snapshot
  nerve_debug.py --home PATH|--db SNAPSHOT find [TEXT]
  nerve_debug.py ... overview CONV_ID
  nerve_debug.py ... timeline CONV_ID [--limit N] [--before-seq N] [--after-seq N]
  nerve_debug.py ... tool TOOL_CALL_ID
  nerve_debug.py ... check [CONV_ID]
  nerve_debug.py --home PATH logs [ID] [--since ISO] [--until ISO] [--level warn,error] [--limit N]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sqlite3
import sys
import tempfile
from pathlib import Path

OPEN_EXECUTION = {"started", "waiting", "retrying"}
WAITING_STATES = {"awaiting_approval", "awaiting_input"}
SECRET_RE = re.compile(
    r"(?i)(bearer\s+[a-z0-9._\-]+|sk-[a-z0-9_\-]{8,}|gh[pousr]_[a-z0-9]{16,}"
    r"|(api[_-]?key|token|secret|password|authorization)[\"']?\s*[:=]\s*[\"']?[^\s\"',}]+)"
)


def redact(text: str, limit: int) -> str:
    text = SECRET_RE.sub("[REDACTED]", text.replace("\n", "\\n"))
    return text if len(text) <= limit else text[:limit] + "…"


def preview(value, limit: int) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        value = json.dumps(value, ensure_ascii=False)
    if limit <= 0:
        return f"<{len(value)} chars>"
    return redact(value, limit)


def loads(raw):
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return {"$invalid_json": True}


def table(rows: list[dict], columns: list[str] | None = None) -> None:
    if not rows:
        print("  (none)")
        return
    columns = columns or list(rows[0].keys())
    cells = [[("" if r.get(c) is None else str(r.get(c))) for c in columns] for r in rows]
    widths = [min(60, max(len(c), *(len(row[i]) for row in cells))) for i, c in enumerate(columns)]
    print("  " + "  ".join(c.ljust(w) for c, w in zip(columns, widths)))
    for row in cells:
        print("  " + "  ".join(v[:w].ljust(w) for v, w in zip(row, widths)))


class Home:
    def __init__(self, home: str | None, db: str | None):
        self.home = Path(home).expanduser().resolve() if home else None
        if db:
            self.db_path = Path(db).expanduser().resolve()
        elif self.home:
            self.db_path = self.home / "data" / "nerve.sqlite"
        else:
            sys.exit("error: pass --home PATH (a Nerve home) or --db PATH (a snapshot)")
        if not self.db_path.is_file():
            sys.exit(f"error: database not found: {self.db_path}")
        self._conn: sqlite3.Connection | None = None

    @property
    def conn(self) -> sqlite3.Connection:
        if self._conn is None:
            uri = Path(self.db_path).resolve().as_uri() + "?mode=ro"
            self._conn = sqlite3.connect(uri, uri=True)
            self._conn.row_factory = sqlite3.Row
            self._conn.execute("PRAGMA query_only=ON")
        return self._conn

    def q(self, sql: str, *params) -> list[dict]:
        return [dict(r) for r in self.conn.execute(sql, params)]

    def one(self, sql: str, *params) -> dict | None:
        rows = self.q(sql, *params)
        return rows[0] if rows else None

    def asset_file(self, logical_path: str) -> Path | None:
        return self.home / "data" / logical_path if self.home else None


# ---------------------------------------------------------------- commands


def cmd_snapshot(h: Home, _args) -> None:
    out_dir = Path(tempfile.mkdtemp(prefix="nerve-debug."))
    os.chmod(out_dir, 0o700)
    target = out_dir / "nerve.sqlite"
    dst = sqlite3.connect(target)
    with dst:
        h.conn.backup(dst)
    dst.close()
    os.chmod(target, 0o600)
    observed = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    print(f"snapshot: {target}")
    print(f"observed_utc: {observed}")
    print(f"source: {h.db_path}")
    print("Use: --db <snapshot> for SQL, keep --home <source> for files/logs. Delete the dir when done.")


def cmd_find(h: Home, args) -> None:
    like = f"%{args.text}%" if args.text else "%"
    rows = h.q(
        """SELECT c.id, c.status, c.paused, c.parent_conversation_id AS parent, c.updated_at,
                  p.name AS project, c.title
           FROM conversation c JOIN project p ON p.id = c.project_id
           WHERE c.id LIKE ? OR c.title LIKE ? OR p.name LIKE ?
           ORDER BY c.updated_at DESC LIMIT ?""",
        like, like, like, args.limit,
    )
    for r in rows:
        r["title"] = preview(r["title"], 50)
    table(rows)


def latest_execution(h: Home, conv: str) -> dict | None:
    return h.one(
        """SELECT id, sequence, created_at, json_extract(payload,'$.transition') AS transition,
                  json_extract(payload,'$.executionId') AS execution_id
           FROM conversation_event
           WHERE conversation_id = ? AND event_type = 'system_event'
             AND json_extract(payload,'$.subtype') = 'execution_state'
           ORDER BY sequence DESC LIMIT 1""",
        conv,
    )


def derived_status(h: Home, conv: dict) -> str:
    """Mirror of StatusService.refreshStatus, minus the in-memory `processing` flag."""
    rows = h.q("SELECT state FROM tool_call WHERE conversation_id = ?", conv["id"])
    if any(r["state"] in WAITING_STATES for r in rows):
        return "waiting"
    last = latest_execution(h, conv["id"])
    if (last and last["transition"] in OPEN_EXECUTION) or rows:
        return "running"
    if last and last["transition"] in ("failed", "interrupted"):
        cleared = conv["status_cleared_at"]
        if not cleared or last["created_at"] > cleared:
            return last["transition"]
    return "idle"


def cmd_overview(h: Home, args) -> None:
    conv = h.one("SELECT * FROM conversation WHERE id = ?", args.conversation)
    if not conv:
        sys.exit(f"conversation not found: {args.conversation}")
    project = h.one("SELECT id, name, directory FROM project WHERE id = ?", conv["project_id"])
    last_seq = h.one(
        "SELECT COALESCE(MAX(sequence),0) AS s, COUNT(*) AS n FROM conversation_event WHERE conversation_id = ?",
        conv["id"],
    )
    head = h.one("SELECT sequence, event_type FROM conversation_event WHERE id = ?", conv["head_event_id"]) if conv["head_event_id"] else None
    last = latest_execution(h, conv["id"])
    derived = derived_status(h, conv)

    print(f"conversation {conv['id']}  title={preview(conv['title'], 60)!s}")
    print(f"  project: {project['name'] if project else '?'} ({conv['project_id']})")
    print(f"  stored status={conv['status']} (at event seq {conv['status_event_sequence']})  derived-from-db={derived}"
          + ("   <-- MISMATCH (may be in-memory input processing; re-check)" if derived != conv["status"] else ""))
    print(f"  paused={conv['paused']}  status_cleared_at={conv['status_cleared_at']}  completed_at={conv['completed_at']}")
    print(f"  events={last_seq['n']} last_seq={last_seq['s']}  head={conv['head_event_id']} "
          f"(seq {head['sequence'] if head else '-'}, {head['event_type'] if head else '-'})"
          + ("  [head is not newest event: older branch selected or newer events off-branch]" if head and head["sequence"] != last_seq["s"] else ""))
    if last:
        open_flag = "OPEN" if last["transition"] in OPEN_EXECUTION else "closed"
        exec_id = last["id"] if last["transition"] == "started" else last["execution_id"]
        print(f"  latest execution_state: {last['transition']} seq={last['sequence']} at {last['created_at']} execution={exec_id} [{open_flag}]")
    print(f"  created={conv['created_at']} updated={conv['updated_at']} last_user_message_at={conv['last_user_message_at']}")
    if h.home:
        cfg = h.home / "data" / "conversations" / conv["id"] / "config"
        print(f"  config dir: {cfg} ({', '.join(sorted(p.name for p in cfg.glob('*.json'))) if cfg.is_dir() else 'missing'})")

    chain, cur = [], conv
    while cur and cur["parent_conversation_id"]:
        cur = h.one("SELECT id, title, status, parent_conversation_id, parent_tool_call_id FROM conversation WHERE id = ?", cur["parent_conversation_id"])
        if cur:
            chain.append(cur)
    if conv["parent_conversation_id"]:
        print(f"\nparents (nearest first); this conversation was created by tool call {conv['parent_tool_call_id']}:")
        table([{"id": c["id"], "status": c["status"], "title": preview(c["title"], 40)} for c in chain])

    children = h.q(
        """SELECT id, status, paused, parent_tool_call_id, updated_at, title FROM conversation
           WHERE parent_conversation_id = ? ORDER BY created_at DESC LIMIT 30""",
        conv["id"],
    )
    print(f"\nchildren (sub-agents; title = name), newest first:")
    for c in children:
        c["title"] = preview(c["title"], 30)
    table(children)

    print("\nopen tool_call rows (unfinished work; settled calls have no row):")
    tools = h.q(
        """SELECT id, turn_id, tool_name, state, origin, json_extract(supervision,'$.decision') AS supervision,
                  json_extract(interaction,'$.kind') AS interaction,
                  CASE WHEN json_extract(interaction,'$.resolution') IS NULL THEN 0 ELSE 1 END AS resolved,
                  CASE WHEN execution_claim IS NULL THEN 0 ELSE 1 END AS claimed, updated_at
           FROM tool_call WHERE conversation_id = ? ORDER BY updated_at""",
        conv["id"],
    )
    table(tools)

    print("\ninput_queue (accepted, not yet delivered):")
    inputs = h.q(
        """SELECT input_id, acceptance_sequence AS acc, source, sender_conversation_id AS sender,
                  delivery_target AS target, target_execution_id AS target_exec, wake_when_idle AS wake,
                  CASE WHEN json_type(content)='object' THEN json_extract(content,'$.subtype') ELSE 'text' END AS kind,
                  accepted_at
           FROM input_queue WHERE conversation_id = ? ORDER BY acceptance_sequence""",
        conv["id"],
    )
    table(inputs)

    print("\nasync_bash (latest 15):")
    table(h.q(
        """SELECT id, tool_call_id, status, exit_code, CASE WHEN process_ref IS NULL THEN 0 ELSE 1 END AS has_ref,
                  started_at, finished_at FROM async_bash WHERE conversation_id = ?
           ORDER BY started_at DESC LIMIT 15""",
        conv["id"],
    ))


def describe_event(e: dict, n: int) -> str:
    p = loads(e["payload"]) or {}
    t = e["event_type"]
    if t == "system_event":
        sub = p.get("subtype")
        if sub == "execution_state":
            bits = [f"execution {p.get('transition')}"]
            if p.get("executionId"):
                bits.append(f"exec={p['executionId']}")
            if p.get("waiting"):
                bits.append(f"waiting={p['waiting']}")
            if p.get("retry"):
                r = p["retry"]
                bits.append(f"retry {r.get('attempt')}/{r.get('maxAttempts')}{' exhausted' if r.get('exhausted') else ''}")
            if p.get("failure"):
                bits.append(f"failure[{p['failure'].get('category')}]={preview(p['failure'].get('message'), max(n, 120))}")
            return " ".join(bits)
        extra = {k: p[k] for k in ("producer", "outcome") if p.get(k) is not None}
        if isinstance(p.get("task"), dict):
            extra["task"] = p["task"]
        return f"notice {sub} {json.dumps(extra)} text={preview(p.get('text'), n)}"
    if t == "assistant_message":
        calls = [f"{c.get('name')}:{c.get('id')}" for c in p.get("content", []) if c.get("type") == "toolCall"]
        text = "".join(c.get("text", "") for c in p.get("content", []) if c.get("type") == "text")
        s = f"stop={p.get('stopReason')} model={p.get('provider')}/{p.get('model')}"
        if p.get("errorMessage"):
            s += f" error={preview(p['errorMessage'], max(n, 160))}"
        if calls:
            s += f" calls=[{', '.join(calls)}]"
        return s + f" text={preview(text, n)}"
    if t == "tool_call_response":
        sup = (p.get("supervision") or {}).get("decision")
        res = p.get("interactionResolution") or {}
        s = f"{p.get('toolName')} tool={p.get('toolCallId')} outcome={p.get('outcome')} origin={p.get('origin')} supervision={sup}"
        if res:
            s += f" resolution={res.get('kind')}:{res.get('decision') or ('dismissed' if res.get('dismissed') else 'answered')}"
        return s + f" assets={len(p.get('assetIds') or [])}"
    if t == "user_message":
        return f"source={p.get('source')} sender={p.get('senderConversationId')} text={preview(p.get('text'), n)}"
    if t == "compaction":
        return f"firstKept={p.get('firstKeptEventId')} tokensBefore={p.get('tokensBefore')} summary={preview(p.get('summary'), n)}"
    return ""


def selected_branch(h: Home, conv: str, head: str | None, cap: int = 200000) -> set[str]:
    if not head:
        return set()
    rows = h.q(
        """WITH RECURSIVE path(id, prev, depth) AS (
             SELECT id, previous_event_id, 0 FROM conversation_event WHERE conversation_id = ? AND id = ?
             UNION ALL
             SELECT e.id, e.previous_event_id, path.depth + 1 FROM conversation_event e
             JOIN path ON e.conversation_id = ? AND e.id = path.prev WHERE path.depth < ?)
           SELECT id FROM path""",
        conv, head, conv, cap,
    )
    return {r["id"] for r in rows}


def cmd_timeline(h: Home, args) -> None:
    conv = h.one("SELECT id, head_event_id FROM conversation WHERE id = ?", args.conversation)
    if not conv:
        sys.exit(f"conversation not found: {args.conversation}")
    where, params = ["conversation_id = ?"], [conv["id"]]
    if args.before_seq is not None:
        where.append("sequence < ?"); params.append(args.before_seq)
    if args.after_seq is not None:
        where.append("sequence > ?"); params.append(args.after_seq)
    order = "ASC" if args.after_seq is not None and args.before_seq is None else "DESC"
    rows = h.q(
        f"""SELECT id, sequence, previous_event_id, event_type, llm_representation, turn_id, input_id, created_at, payload
            FROM conversation_event WHERE {' AND '.join(where)} ORDER BY sequence {order} LIMIT ?""",
        *params, args.limit,
    )
    rows.sort(key=lambda r: r["sequence"])
    branch = selected_branch(h, conv["id"], conv["head_event_id"])
    print("legend: * = on selected branch (head path); H = head; replay order = sequence")
    prev_seq_id = None
    for r in rows:
        mark = ("H" if r["id"] == conv["head_event_id"] else "*" if r["id"] in branch else " ")
        fork = "" if prev_seq_id is None or r["previous_event_id"] == prev_seq_id else f" (prev={r['previous_event_id']})"
        prev_seq_id = r["id"]
        print(f"{mark} {r['sequence']:>6} {r['created_at']} {r['event_type']:<18} {r['id']} turn={r['turn_id'] or '-'}{fork}")
        print(f"         {describe_event(r, args.preview)}")


def cmd_tool(h: Home, args) -> None:
    tid = args.tool_call
    row = h.one("SELECT * FROM tool_call WHERE id = ?", tid)
    resp = h.one(
        """SELECT id, conversation_id, sequence, created_at, payload FROM conversation_event
           WHERE event_type = 'tool_call_response' AND json_extract(payload,'$.toolCallId') = ?""",
        tid,
    )
    if row:
        print(f"OPEN tool_call {tid} in {row['conversation_id']}")
        inter = loads(row["interaction"]) or {}
        sup = loads(row["supervision"]) or {}
        print(f"  tool={row['tool_name']} state={row['state']} origin={row['origin']} turn={row['turn_id']} updated={row['updated_at']}")
        print(f"  assistant_event={row['assistant_event_id']} content_index={row['content_index']} provider_call={row['provider_call_id']}")
        print(f"  execution_claim={'set' if row['execution_claim'] else 'none'}")
        print(f"  supervision: decision={sup.get('decision')} risk={sup.get('effectiveRisk')} approval_bound={'approval' in sup} reason={preview(sup.get('reason'), max(args.preview, 120))}")
        if inter:
            res = inter.get("resolution")
            print(f"  interaction: kind={inter.get('kind')} resolved={bool(res)} resolutionRequestId={inter.get('resolutionRequestId')}")
            print(f"    request keys={sorted((inter.get('request') or {}).keys())}")
            if res:
                print(f"    resolution={json.dumps({k: v for k, v in res.items() if k != 'answers'})}{' (+answers)' if 'answers' in res else ''}")
        print(f"  arguments={preview(row['arguments'], args.preview)}")
    if resp:
        p = loads(resp["payload"]) or {}
        print(f"SETTLED tool_call {tid}: response event {resp['id']} seq={resp['sequence']} at {resp['created_at']} in {resp['conversation_id']}")
        print(f"  {describe_event({'event_type': 'tool_call_response', 'payload': resp['payload']}, args.preview)}")
        print(f"  startedAt={p.get('startedAt')} resolutionRequestId={p.get('resolutionRequestId')} arguments={preview(p.get('arguments'), args.preview)}")
        up = p.get("userProjection") or {}
        if up.get("resultPreview") is not None:
            print(f"  userProjection.resultPreview={preview(up.get('resultPreview'), args.preview)}")
    if not row and not resp:
        print(f"no open row and no response event for {tid}")
        asst = h.one(
            """SELECT e.id, e.conversation_id, e.sequence FROM conversation_event e, json_each(e.payload,'$.content') c
               WHERE e.event_type='assistant_message' AND json_extract(c.value,'$.id') = ? LIMIT 1""",
            tid,
        )
        if asst:
            print(f"  NOTE: provider call id appears in assistant event {asst['id']} (seq {asst['sequence']}); core tool ids differ from provider ids")
    assets = h.q(
        "SELECT id, category, logical_path, byte_length, created_at FROM asset WHERE tool_call_id = ? ORDER BY created_at",
        tid,
    )
    if assets:
        print("  assets:")
        for a in assets:
            f = h.asset_file(a["logical_path"])
            if f is None:
                state = "unknown (no --home)"
            elif not f.exists():
                state = "MISSING"
            else:
                size = f.stat().st_size
                state = "ok" if size == a["byte_length"] else f"SIZE MISMATCH ({size})"
            print(f"    {a['category']:<12} {a['byte_length']:>9}B {state:<10} {a['logical_path']}")
    kids = h.q("SELECT id, status, title FROM conversation WHERE parent_tool_call_id = ?", tid)
    if kids:
        print("  child conversations created by this call:")
        table([{"id": k["id"], "status": k["status"], "name": preview(k["title"], 30)} for k in kids])
    bash = h.q("SELECT id, status, exit_code, started_at, finished_at FROM async_bash WHERE tool_call_id = ?", tid)
    if bash:
        print("  async_bash:")
        table(bash)


def cmd_check(h: Home, args) -> None:
    scope = "WHERE c.id = ?" if args.conversation else ""
    params = [args.conversation] if args.conversation else []
    convs = h.q(f"SELECT c.* FROM conversation c {scope}", *params)
    findings: list[tuple[str, str, str]] = []
    for c in convs:
        cid = c["id"]
        d = derived_status(h, c)
        if d != c["status"]:
            findings.append((cid, "status", f"stored={c['status']} derived={d} (transient if input is being processed)"))
        last = latest_execution(h, cid)
        tools = h.q("SELECT id, state, interaction, tool_name FROM tool_call WHERE conversation_id = ?", cid)
        if last and last["transition"] in OPEN_EXECUTION and not tools and c["status"] != "running":
            findings.append((cid, "execution", f"open execution ({last['transition']} seq {last['sequence']}) but status={c['status']}"))
        if tools and not (last and last["transition"] in OPEN_EXECUTION):
            findings.append((cid, "tool_call", f"{len(tools)} open tool rows but no open execution (user-origin call or interrupted turn?)"))
        for t in tools:
            inter = loads(t["interaction"])
            if t["state"] in WAITING_STATES and not inter:
                findings.append((cid, "tool_call", f"{t['id']} {t['tool_name']} {t['state']} without interaction"))
            if inter and inter.get("resolution") and t["state"] in WAITING_STATES:
                findings.append((cid, "tool_call", f"{t['id']} {t['tool_name']} resolved {inter.get('kind')} still {t['state']} (resolution not applied)"))
        if c["head_event_id"] is None and h.one("SELECT 1 AS x FROM conversation_event WHERE conversation_id = ? LIMIT 1", cid):
            findings.append((cid, "head", "events exist but head_event_id is NULL"))
        queued = h.q("SELECT input_id, wake_when_idle, accepted_at FROM input_queue WHERE conversation_id = ?", cid)
        if queued and c["status"] == "idle" and not c["paused"] and any(q["wake_when_idle"] for q in queued) and not tools:
            findings.append((cid, "input_queue", f"{len(queued)} queued wake input(s) on idle unpaused conversation (oldest {min(q['accepted_at'] for q in queued)})"))
        if queued and c["paused"]:
            findings.append((cid, "input_queue", f"{len(queued)} queued input(s) held by pause"))
        for b in h.q("SELECT id, started_at FROM async_bash WHERE conversation_id = ? AND status = 'running'", cid):
            findings.append((cid, "async_bash", f"{b['id']} running since {b['started_at']} (verify the daemon still owns it)"))
        if c["parent_conversation_id"]:
            parent = h.one("SELECT status, paused FROM conversation WHERE id = ?", c["parent_conversation_id"])
            if parent and c["status"] in ("running", "waiting") and parent["paused"]:
                findings.append((cid, "delegation", f"child {c['status']} under paused parent {c['parent_conversation_id']}"))
    if args.conversation and h.home:
        for a in h.q("SELECT logical_path, byte_length FROM asset WHERE conversation_id = ?", args.conversation):
            f = h.asset_file(a["logical_path"])
            if not f.exists():
                findings.append((args.conversation, "asset", f"missing file {a['logical_path']}"))
    print(f"checked {len(convs)} conversation(s); {len(findings)} lead(s). Leads are not conclusions.")
    for cid, kind, msg in findings[: args.limit]:
        print(f"  {cid}  [{kind}] {msg}")
    if len(findings) > args.limit:
        print(f"  … {len(findings) - args.limit} more (raise --limit)")


def cmd_logs(h: Home, args) -> None:
    if not h.home:
        sys.exit("error: logs need --home")
    if not args.id and not args.since:
        sys.exit("error: logs need an ID or --since (bounded window)")
    files = sorted((h.home / "logs").glob("application-*.jsonl")) + sorted((h.home / "logs").glob("desktop-*.jsonl"))
    shown = 0
    for f in files:
        day = f.stem.split("-", 1)[1]
        if args.since and day < args.since[:10]:
            continue
        if args.until and day > args.until[:10]:
            continue
        with f.open(encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if args.id and args.id not in line:
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                ts = rec.get("ts", "")
                if (args.since and ts < args.since) or (args.until and ts > args.until):
                    continue
                if args.level and rec.get("level") not in args.level.split(","):
                    continue
                ids = {k: rec[k] for k in ("conversationId", "toolCallId", "requestId") if rec.get(k)}
                ctx = sorted((rec.get("context") or {}).keys())
                err = rec.get("error")
                err_s = ""
                if err:
                    err_s = " error=" + redact(err.get("message", "") if isinstance(err, dict) else str(err), 200)
                print(f"{ts} {rec.get('level','?'):<5} {rec.get('source','')}/{rec.get('component','')} {redact(rec.get('message',''), 200)}{err_s}")
                print(f"    ids={ids} context_keys={ctx}  [{f.name}]")
                shown += 1
                if shown >= args.limit:
                    print(f"(limit {args.limit} reached; narrow --since/--until or raise --limit)")
                    return
    print(f"{shown} matching record(s) in {len(files)} file(s). Logs are retention-limited and removed with deleted conversations.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    # Global options are accepted before or after the subcommand. Subparser copies use
    # SUPPRESS so an omitted flag does not overwrite a value given before the subcommand.
    common = argparse.ArgumentParser(add_help=False)
    for parser, default in ((ap, None), (common, argparse.SUPPRESS)):
        parser.add_argument("--home", default=default, help="Nerve home (e.g. data/storage-1 or ~/.nerve); used for files and logs")
        parser.add_argument("--db", default=default, help="SQLite file to query instead of <home>/data/nerve.sqlite (e.g. a snapshot)")
        parser.add_argument("--preview", type=int, default=0 if default is None else default,
                            help="show up to N redacted chars of text/arguments (default: lengths only)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def command(name: str) -> argparse.ArgumentParser:
        return sub.add_parser(name, parents=[common])

    command("snapshot")
    p = command("find"); p.add_argument("text", nargs="?"); p.add_argument("--limit", type=int, default=20)
    p = command("overview"); p.add_argument("conversation")
    p = command("timeline"); p.add_argument("conversation"); p.add_argument("--limit", type=int, default=40)
    p.add_argument("--before-seq", type=int); p.add_argument("--after-seq", type=int)
    p = command("tool"); p.add_argument("tool_call")
    p = command("check"); p.add_argument("conversation", nargs="?"); p.add_argument("--limit", type=int, default=50)
    p = command("logs"); p.add_argument("id", nargs="?", help="any ID substring (conv_, tool_, evt_, bash id…)"); p.add_argument("--since"); p.add_argument("--until")
    p.add_argument("--level", help="comma list, e.g. warn,error"); p.add_argument("--limit", type=int, default=50)
    args = ap.parse_args()
    h = Home(args.home, args.db)
    {"snapshot": cmd_snapshot, "find": cmd_find, "overview": cmd_overview, "timeline": cmd_timeline,
     "tool": cmd_tool, "check": cmd_check, "logs": cmd_logs}[args.cmd](h, args)


if __name__ == "__main__":
    main()
