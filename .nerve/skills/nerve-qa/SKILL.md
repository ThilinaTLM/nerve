---
name: nerve-qa
description: Use when verifying, smoke-testing, reproducing, or screenshotting Nerve changes in a real dev desktop instance (`desktop:dev --slot N`) driven by agent-browser.
---

# QA on a development instance

Verify a change the way a user would: build and launch a dev desktop slot with CDP enabled, drive it with agent-browser, and report observed evidence.

`H="python3 .nerve/skills/nerve-qa/scripts/qa_slot.py"` (run from the repo root). Every subcommand takes `--slot N` (default 1).

## Rules

- **Never QA on the slot hosting you.** If `$NERVE_HOME` is `data/storage-N`, use another slot. Production (`~/.nerve`, port 3747) is never a QA target.
- **Dev servers run through launch definitions, not `async_bash` or `Bash`.** Start, stop, restart and read logs with the `launch` tool so the user can see and own the process. Never `pkill`/`killall` or kill by port: every daemon runs the same `main.js`.
- **Stop the slot before touching its files.** The helper refuses to edit config or secrets while the slot's ports are in use.
- Never print or read secret contents. `copy-secrets` decrypts only inside the helper and prints names, never values.

## 1. Choose a slot

Slot `N` uses `data/storage-N` (home), HTTP `43967 + 2*(N-1)`, HTTPS the next port, and CDP `9230 + N` (slot 1 uses 9231). The CDP ports deliberately avoid 9222, which a regular Chrome often holds.

```bash
$H status --slot N   # home, ports, running state, default model, launch definition
```

Prefer slot 1 unless it hosts you or the user names another. For DB schema/migration testing, use a copied slot (`pnpm storage:copy --slot N`), not slot 1.

## 2. Ensure the launch definition

```bash
$H ensure-launch --slot N
```

This adds or updates `desktop-dev-slot-N` in `.nerve/launches/definitions.json` with command `NERVE_ELECTRON_REMOTE_DEBUGGING_PORT=<cdp> pnpm run desktop:dev --slot N`. The daemon rereads the file, so the definition is usable immediately. Edit that file by hand for other dev servers (keep `version: 2`, a unique `launchdef_<ULID>` id, `scope: {"kind": "project"}`, `runPolicy: "single"`); never add workaround env such as `ELECTRON_OVERRIDE_DIST_PATH`.

## 3. Prepare the slot (stopped)

If the slot is running, stop it with `launch` → `stop` → `desktop-dev-slot-N`. Then:

```bash
$H set-model --slot N   # default model anthropic/claude-haiku-5-5 (Haiku 5.5); idempotent
```

Do this once per slot; it persists in `data/storage-N/config/agent.json`. A brand-new slot has no config until its first launch: start it once, stop it, then run `set-model`.

`copy-secrets` is the only way to give a slot credentials. Run it when a slot lacks credentials, or when provider authentication fails (401/403, "expired", "sign in", or a token-refresh error):

```bash
$H copy-secrets --slot N   # slot must be stopped; backs up data/storage-N/secrets first
```

What it does:

- Copies API keys (Atlassian, Tavily, provider keys) from `~/.nerve`, read-only, re-encrypted with the slot's own `master.key`. It also copies `config/providers.json` and the account config (`accounts.json` or `integrations.json`, whichever the slot uses) so credential ids match.
- Copies subscription (OAuth) sessions as the access token and expiry only. **Refresh tokens are never copied**: refresh rotates the token and would log production out. The slot cannot refresh, so once the access token expires, requests fail with a token-refresh error.
- Prints each OAuth provider's expiry (local time, minutes left). `WARNING ... within 15 minutes` means production may refresh soon; make a production request with that provider first, or rerun later.

When an access token expires, stop the slot and rerun `copy-secrets --slot N`. `$H status --slot N` shows `oauth` expiry per provider (`minutesLeft`) so you know when.

`--full` restores the old whole-folder copy, including refresh tokens. Use it only if the user asks.

## 4. Launch and connect

1. `launch` → `start` → `desktop-dev-slot-N`. The first run builds native, runtime and desktop packages and can take minutes. Read `launch` logs until `HTTP <port>` appears and no error follows. Fix build/launch errors before continuing.
2. Confirm CDP with `$H status --slot N` → `cdpOwner: "electron"` (retry briefly while Electron starts). `"other"` means a different process holds the port: Electron could not bind it, and connecting would drive the wrong browser. Stop and report the conflict.
3. Load the agent-browser guides once per conversation and follow them:

   ```bash
   agent-browser skills get core --full
   agent-browser skills get electron --full
   ```

4. `agent-browser connect <cdp>`, then `agent-browser tab` to pick the Nerve window (skip DevTools or splash targets).

After code changes, `launch` → `restart` rebuilds and relaunches. Renderer-only changes may only need a reload of the window.

## 5. Test

- **Project:** use `Random` (`/home/tlm/Projects/Random`). If it is missing from the slot, add it through the UI's add-project flow; never insert database rows.
- **Model:** confirm the composer shows Haiku 5.5 before sending prompts. Switch it in the UI if a conversation overrides it.
- Exercise the changed behavior and its nearby edges. Take a fresh snapshot after every action, and take screenshots of key states as evidence.
- Use `nerve-debug` (read-only) against `data/storage-N` when the UI and stored state disagree.

## 6. Report and clean up

Report the slot, steps performed, expected versus observed results, and screenshot paths. State clearly what was not verified. Leave the instance running unless the user asks to stop it; when stopping, use only the `launch` tool.
