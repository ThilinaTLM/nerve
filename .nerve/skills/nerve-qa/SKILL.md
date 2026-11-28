---
name: nerve-qa
description: Use when verifying, smoke-testing, reproducing, or screenshotting Nerve changes in a real dev desktop instance (`desktop:dev --slot N`) driven by agent-browser.
---

# QA on a development instance

Verify a change the way a user would: build and launch a dev desktop slot with CDP enabled, drive it with agent-browser, and report observed evidence.

`H="python3 .nerve/skills/nerve-qa/scripts/qa_slot.py"` (run from the repo root). Every subcommand takes `--slot N` (default 1).

## Rules

- **Never QA on the slot hosting you.** If `$NERVE_HOME` is `data/storage-N`, use another slot. Production (`~/.nerve`, port 3747) is never a QA target.
- **Dev servers run through launch definitions, not `async_bash` or `Bash`.** Start, stop, restart and read logs with quick_script `launches.*` so the user can see and own the process. Never `pkill`/`killall` or kill by port: every daemon runs the same `main.js`.
- **Stop the slot before touching its files.** The helper refuses to edit config or secrets while the slot's ports are in use.
- Never print or read secret contents. `copy-secrets` decrypts only inside the helper and prints names, never values.

## 1. Choose a slot

Slot `N` uses `data/storage-N` (home), HTTP `43967 + 2*(N-1)`, HTTPS the next port, and CDP `9230 + N` (slot 1 uses 9231). The CDP ports deliberately avoid 9222, which a regular Chrome often holds.

```bash
$H status --slot N   # home, ports, running state, default model, launch definition
```

Prefer slot 1 unless it hosts you or the user names another. For DB schema/migration testing, never use slot 1: create a fresh slot from a release snapshot (section 3a).

## 2. Ensure the launch definition

```bash
$H ensure-launch --slot N
```

This adds or updates `desktop-dev-slot-N` in `.nerve/launches/definitions.json` with command `NERVE_ELECTRON_REMOTE_DEBUGGING_PORT=<cdp> pnpm run desktop:dev --slot N`. The daemon rereads the file, so the definition is usable immediately. Edit that file by hand for other dev servers (keep `version: 2`, a unique `launchdef_<ULID>` id, `scope: {"kind": "project"}`, `runPolicy: "single"`); never add workaround env such as `ELECTRON_OVERRIDE_DIST_PATH`.

## 3. Prepare the slot (stopped)

If the slot is running, stop it with `launches.stop("desktop-dev-slot-N")`. Then:

```bash
$H set-model --slot N                  # Haiku 5.5 (anthropic/claude-haiku-5-5); idempotent
$H set-model --slot N --model sonnet   # Sonnet 5.5 (anthropic/claude-sonnet-5-5)
```

Use Haiku 5.5 for routine checks and Sonnet 5.5 when the scenario needs stronger tool use or reasoning (delegation, plans, multi-step edits). Never use another Haiku version or a bare "Haiku". Do this once per slot; it persists in `data/storage-N/config/agent.json`. A brand-new slot has no config until its first launch: start it once, stop it, then run `set-model`.

`copy-secrets` (`scripts/copy-secrets.ts`, run through `$H`) is the only way to give a slot credentials; never copy `secrets/` by hand. Run it when a slot lacks credentials, or when provider authentication fails (401/403, "expired", "sign in", or a token-refresh error):

```bash
$H copy-secrets --slot N   # slot must be stopped; backs up data/storage-N/secrets first
```

What it does:

- Copies provider API keys from `~/.nerve`, read-only, re-encrypted with the slot's own `master.key`, and copies `config/providers.json`.
- Copies accounts into the slot's `account` table: each is opened with the source key and sealed again under the slot's key. Production's win by id; accounts only the slot has (such as the `Nerve Test` test-site account) are kept. Typed-in secrets (API keys) are kept. Provider state such as OAuth2 tokens is not copied, so those accounts show `needs_sign_in` in the slot; sign in again there. Project-level accounts are copied only when the slot has that project. A production home from before migration 0006 (`config/accounts.json` plus `provider:account:*` secrets) is converted with the migrations' own code. Fails when the slot still has `config/accounts.json`: start it once, stop it, then rerun.
- Copies subscription (OAuth) sessions as the access token and expiry only. **Refresh tokens are never copied**: refresh rotates the token and would log production out. The slot cannot refresh, so once the access token expires, requests fail with a token-refresh error.
- Prints each OAuth provider's expiry (local time, minutes left). `WARNING ... within 15 minutes` means production may refresh soon; make a production request with that provider first, or rerun later.

When an access token expires, stop the slot and rerun `copy-secrets --slot N`. `$H status --slot N` shows `oauth` expiry per provider (`minutesLeft`) so you know when.

`--full` restores the old whole-folder copy, including refresh tokens. Use it only if the user asks.

## 3a. Migration testing from a release snapshot

`data/snapshot-x-y-z/` holds frozen, stopped homes from released versions: `snapshot-0-34-1` (oldest supported baseline, pre-0001 legacy layout), `snapshot-0-37-0`, `snapshot-0-38-1`, `snapshot-0-39-0`, `snapshot-0-40-0`, `snapshot-0-40-2`. Pick the oldest one the change affects (usually the latest snapshot plus `0-34-1` for the full chain). `$H status --slot N` shows a slot's applied home steps (`homeMigrations`) and whether `migrations/last-failure.json` exists.

**Snapshots are read-only baselines.** Never start a daemon on one, edit it, or run `storage:migrate` against it; always copy it to a slot first.

1. Pick an unused slot N (≥ 2, `homeExists: false` in `$H status --slot N`). The copy refuses an existing destination; to reuse a slot, ask the user before deleting `data/storage-N`.
2. Copy the snapshot: `pnpm storage:copy --from data/snapshot-0-40-2 --slot N`. Optionally rehearse offline first: `pnpm storage:migrate --home data/storage-N --dry-run`.
3. `$H ensure-launch --slot N`, then start it (section 4). The daemon runs pending home steps before storage opens, then core SQL migrations. Read the launch logs for migration errors; afterwards check `$H status --slot N` (`homeMigrations` lists every registered step, `migrationFailure: false`) and `data/storage-N/migrations/reports/` for set-aside or loss notices.
4. The snapshot's own credentials are old: stop the slot, run `set-model` and `copy-secrets`, then start it again before sending prompts.
5. Verify migrated data in the UI (conversation list, old transcripts, settings, accounts, agent profiles) and with `nerve-debug` against `data/storage-N`.

Snapshot projects point at real directories under `/home/tlm/Projects/`, and project configuration upgrades lazily when the app loads it. Do not open those projects in a migration slot unless that is the test; use TestApp for new conversations. When project files matter, use `pnpm storage:rehearse --from data/snapshot-x-y-z --slot N` instead, which redirects projects to copies under `data/storage-N-projects/`.

## 4. Launch and connect

1. `launches.start("desktop-dev-slot-N")`. The first run builds native, runtime and desktop packages and can take minutes. Read `launches.logs("desktop-dev-slot-N")` until `HTTP <port>` appears and no error follows. Fix build/launch errors before continuing.
2. Confirm CDP with `$H status --slot N` → `cdpOwner: "electron"` (retry briefly while Electron starts). `"other"` means a different process holds the port: Electron could not bind it, and connecting would drive the wrong browser. Stop and report the conflict.
3. Load the agent-browser guides once per conversation and follow them:

   ```bash
   agent-browser skills get core --full
   agent-browser skills get electron --full
   ```

4. `agent-browser connect <cdp>`, then `agent-browser tab` to pick the Nerve window (skip DevTools or splash targets).

After code changes, `launches.restart("desktop-dev-slot-N")` rebuilds and relaunches. Renderer-only changes may only need a reload of the window.

## 5. Test

- **Project:** use `TestApp` (`/home/tlm/Projects/TestApp`). If it is missing from the slot, add it through the UI's add-project flow; never insert database rows. Do not use other projects (including `Random`) for new conversations.
- **Model:** confirm the composer shows Haiku 5.5 or Sonnet 5.5 (the version matters) before sending prompts. Switch it in the UI if a conversation overrides it.
- Exercise the changed behavior and its nearby edges. Take a fresh snapshot after every action, and take screenshots of key states as evidence.
- Use `nerve-debug` (read-only) against `data/storage-N` when the UI and stored state disagree.

## 6. Report and clean up

Report the slot (and source snapshot, if any), steps performed, expected versus observed results, and screenshot paths. State clearly what was not verified. Leave the instance running unless the user asks to stop it; when stopping, use only `launches.stop`.
