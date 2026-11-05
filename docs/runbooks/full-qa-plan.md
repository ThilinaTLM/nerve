# Full manual QA plan (Waves 1-4)

Manual verification of everything delivered by the code-quality programme
(Wave 1 = PR #530, Wave 2 = #531, Wave 3 = #532, Wave 4 = branch
`wave-4/auth-pairing-splits-tooling`) plus core regression areas. Designs are described in
`docs/architecture/`; this plan is the executable checklist.

Legend: `[ ]` = to run. Sections marked **(Wave 4)**
were written ahead of implementation; UI labels, endpoint paths and
flags may differ. Adjust the case, don't skip it.

---

## 1. Prerequisites and setup

**Never use `~/.nerve` or `data/storage-1` for destructive testing.** Use a copied slot.

```bash
# stop any desktop app / daemon that uses ~/.nerve first (copy needs a stopped home)
pnpm install && pnpm build            # or let dev scripts build incrementally
pnpm storage:copy --slot 7            # copy of ~/.nerve into data/storage-7
# or from a released snapshot:
pnpm storage:copy --from data/snapshot-0-39-0 --slot 6
pnpm dev --slot 7                     # daemon + UI (HTTP 43967+offset)
pnpm dev:ui --slot 7                  # Vite UI against that slot (separate terminal)
pnpm desktop:dev --slot 7             # desktop shell against the slot
```

Cleanup afterwards: delete `data/storage-N` (and `data/storage-N-projects`).

### Token and pairing

Access API reference (Wave 4): routes under `/api/access/*` — `GET session`, `POST pair`, `POST pairing-codes`, `GET/PATCH/DELETE devices[/:id]`, `POST devices/revoke-all`, `POST logout`, `login/*`, `passkeys[/register/*]`, `GET audit`, `POST local-token/rotate` (local only), `POST reset` (local only). Cookies: `nerve_session` (`__Host-nerve_session` over HTTPS); native clients use `Authorization: Bearer nd_<id>.<secret>` and must store a rotated `x-nerve-credential` header. Audit log: `logs/access-audit.jsonl`; devices: `secrets/devices.json` (0600).

| Need                                       | How                                                                                                                                                                                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local daemon token (Tier 1, loopback only) | `cat data/storage-7/secrets/daemon-token` → `TOKEN`                                                                                                                                                                                 |
| Browser on localhost                       | Open `http://127.0.0.1:$PORT/` → pairing screen. Get a code from the desktop app (Settings → Devices → **Pair a device**) or `node packages/workbench-server/dist/main.js pair`, or open `/#pair=CODE`. Static pages set no cookie. |
| Phone                                      | Desktop app → Settings → Mobile / LAN → QR; phone installs the local CA, opens mobile-setup, then "Open secure Nerve".                                                                                                              |
| Remote desktop                             | Desktop app launched with `--connect https://host --pair-code CODE` (credential stored per origin via safeStorage; `--token` deprecated).                                                                                           |

Placeholders used below: `$HOST` (e.g. `127.0.0.1`), `$PORT` (HTTP port of the slot),
`$TOKEN`, `$LAN_IP`, `$HTTPS_PORT`, `$CODE` (pairing code), `$DEVICE_ID`.

Also have ready: a git repo with a GitHub remote + open PR (for git/PR cases), a
provider API key/model, a second project folder, and a throwaway project with a dev-server script.

## 2. Test environments matrix

| Env                                                            | Code           | Used by                                |
| -------------------------------------------------------------- | -------------- | -------------------------------------- |
| E1 Desktop app (`pnpm desktop:dev --slot N`)                   | local          | all UI sections, desktop IPC           |
| E2 Browser on localhost (`http://localhost:$PORT`)             | loopback       | UI, auth, DNS rebinding                |
| E3 Phone on LAN via mobile HTTPS                               | LAN + local CA | mobile, PWA, plaintext-pairing refusal |
| E4 Remote desktop → remote daemon                              | LAN/remote     | WS auth, pairing, revoke               |
| E5 Reverse proxy (Caddy) → daemon on loopback, `publicUrl` set | public-like    | passkey login, trustProxy, audit       |

Record the env per case in the results template (§19). Minimum pass: E1+E2 for everything; E3/E4/E5 for the cases flagged.

---

## 3. Migration rehearsal (Wave 3: step `0004-task-result-notices`)

### MIG-1 Rehearse on a snapshot copy

- Pre: `data/snapshot-0-39-0` (or any pre-0004 home); slot 6 unused; no daemon running on it.
- Steps:
  1. `pnpm storage:copy --from data/snapshot-0-39-0 --slot 6`
  2. `pnpm storage:migrate --home data/storage-6 --dry-run` then without `--dry-run`
  3. `pnpm exec tsx scripts/storage-migrations/validate-history.ts --home data/storage-6` (daemon for that slot must be stopped)
  4. `pnpm migrations:check`
- Expected: 0003 → 0004 applied (seconds); notices rewritten, 0 set-asides on healthy data; validate-history reports 0 failures; re-running migrate says "up to date".
- [ ] MIG-1

### MIG-2 Daemon on migrated copy

- Steps: `pnpm dev --slot 6`, open old conversations with bash / sub-agent results; send a new message in a resumed conversation.
- Expected: old results render as task cards (bash `lost` → _interrupted_); resumed conversation continues normally; no transcript errors.
- [ ] MIG-2

### MIG-3 Malformed notice

- Steps: in a copy, corrupt one stored `async_bash_event` payload (or use `pnpm storage:rehearse --from <home> --slot 3 --corrupt <PRESET>`), migrate.
- Expected: that notice is set aside/quarantined automatically; migration completes; rerun "up to date".
- [ ] MIG-3

### MIG-4 Fresh home

- Steps: start a daemon on an empty `NERVE_HOME`/new slot.
- Expected: starts; step 0004 recorded without running; no errors in log.
- [ ] MIG-4

### MIG-5 Wave 4 data changes (Wave 4)

- Steps: if Wave 4 adds an unreleased step or files (`devices.json`, audit JSONL), run MIG-1 again from a released snapshot, and check the "single unreleased migration step" rule (`docs/architecture/migrations.md`). No DB schema change is expected.
- Expected: migrate clean; devices/audit files created lazily, mode 0600 where applicable.
- [ ] MIG-5

---

## 4. Security negative tests (Wave 1, + Wave 4 extensions)

Run against E2 (`$HOST:$PORT`) unless noted.

### SEC-1 DNS rebinding / Host allowlist

```bash
curl -i -H "Host: evil.example" -H "Authorization: Bearer $TOKEN" http://$HOST:$PORT/health
curl -i -H "Host: evil.example" -H "Authorization: Bearer $TOKEN" http://$HOST:$PORT/api/...   # any API route
curl -i -H "Host: evil.example" http://$HOST:$PORT/                                          # static
curl -i -H "Host: localhost" -H "Authorization: Bearer $TOKEN" http://$HOST:$PORT/health      # control: 200
```

- Expected: evil host → `421` on /health, API, static, boot page; control OK. With `NERVE_ALLOWED_HOSTS=nerve.lan` restart, `Host: nerve.lan` accepted.
- [ ] SEC-1

### SEC-2 WebSocket Host + Origin

```bash
# need a WS client, e.g. `npx wscat` ; routes are /ws/workbench and /ws/conversations
npx wscat -c ws://$HOST:$PORT/ws/workbench -H "Authorization: Bearer $TOKEN" -H "Origin: http://evil.example"   # 403
npx wscat -c ws://$HOST:$PORT/ws/workbench -H "Authorization: Bearer $TOKEN" -H "Host: evil.example"            # 421
npx wscat -c ws://$HOST:$PORT/ws/workbench -H "Authorization: Bearer $TOKEN" -H "Origin: null"                  # 403
npx wscat -c ws://$HOST:$PORT/ws/workbench -H "Authorization: Bearer $TOKEN"                                    # connects (no Origin, bearer)
```

- Also try same host different port Origin → rejected.
- [ ] SEC-2

### SEC-3 `?token=` on WS rejected

`npx wscat -c "ws://$HOST:$PORT/ws/workbench?token=$TOKEN"` → 401/403, no upgrade. Bearer or cookie works.

- [ ] SEC-3

### SEC-4 Static GET sets no cookie

`curl -si http://$HOST:$PORT/ | grep -i set-cookie` → nothing. Same for `/index.html`, assets, from loopback. `Referrer-Policy: no-referrer` present on UI/static/mobile-setup/CA responses.

- [ ] SEC-4

### SEC-5 Cookie attributes

After a legitimate login/token redirect: cookie `HttpOnly`, `SameSite=Strict`, 30 days (`Max-Age≈2592000`), renewed while in use, `Secure` over HTTPS (E3/E5), absent `Secure` only on plain loopback.

- [ ] SEC-5

### SEC-6 Unauthenticated / wrong token

`curl -i http://$HOST:$PORT/api/...` → 401; wrong bearer → 401 (same timing class; no 500). `/health` behavior unchanged.

- [ ] SEC-6

### SEC-7 Cookie CSRF-style request (Wave 4)

Cookie-authenticated non-GET with foreign/missing `Origin` → rejected; bearer-only exempt.

- [ ] SEC-7

### SEC-8 Plaintext LAN pairing refused (Wave 4)

From another machine/phone: `curl -i http://$LAN_IP:$PORT/api/access/pair -H 'content-type: application/json' -d '{"code":"'$CODE'","deviceName":"qa","kind":"browser","delivery":"bearer"}'` → 403 `TLS_REQUIRED` (non-loopback, no TLS). Same over `https://$LAN_IP:$HTTPS_PORT` (with local CA) → accepted.

- [ ] SEC-8

### SEC-9 Expired / revoked device rejected (Wave 4)

1. Pair a device (curl or phone), note its bearer/cookie. 2. Revoke in Settings → Devices. 3. Replay a request with the old credential → 401; its open WebSocket is closed immediately. 4. Edit `devices.json` expiry to the past (on a copy slot) or wait → 401.

- [ ] SEC-9

### SEC-10 Rate limits (Wave 4)

Send wrong pairing codes quickly: 5 wrong guesses kill that code (`PAIRING_CODE_INVALID` afterwards even for the right code); >10 failures per IP in 10 min → 429 `RATE_LIMITED` with `Retry-After` (global cap 30/10 min); correct code still blocked during the lockout window; entries appear as `failed` in audit log; throttle clears after window. Also: a pairing code is single-use and expires (default 120 s, max 300 s); setup codes (passkey enrollment) last 10 min.

- [ ] SEC-10

### SEC-11 Local token is loopback-only (Wave 4)

Bearer daemon-token from non-loopback peer, or loopback with `X-Forwarded-For` present → refused (or accepted once with warning + Devices banner if the one-release grace is implemented).

- [ ] SEC-11

### SEC-12 Desktop IPC project-root checks (Wave 1/Wave 4)

In desktop app: open/reveal/trash a file inside the project → works; a path that symlinks outside the project root → rejected; calls from a non-main frame (e.g. in a preview iframe/webview) → rejected. **(Wave 4)** roots come from the main-process project-root registry: after adding/removing a project, open/reveal/trash for the removed root is rejected.

- [ ] SEC-12

### SEC-13 Permission symlink escape (Wave 1/#529)

In a project, create `ln -s /tmp/outside link`; ask agent to write `link/new.txt` (non-existent target). Expected: classified outside project → requires approval (not auto-allowed).

- [ ] SEC-13

---

## 5. Authentication & pairing **(Wave 4)**

Design: `docs/architecture/access.md`.

### AUTH-1 Local desktop unaffected

Desktop app on loopback connects without pairing; conversations stream; WS connects. No pairing screen flashes. Dev proxy (`pnpm dev` + `pnpm dev:ui`) still works.

- [ ] AUTH-1

### AUTH-2 Pair a browser/phone by code

Settings → Devices (or `node packages/workbench-server/dist/main.js pair --purpose mobile`) → **Pair a device** dialog shows code `XXXX-XXXX`, QR and copy link (`…/#pair=CODE`). Redeem from phone over mobile HTTPS (E3): the hash disappears from the address bar immediately, device name is prefilled from the user agent → app loads; issuing desktop shows toast "Device paired: <name>"; device appears in list with name, kind, last seen. Also: tray → **Copy Mobile Setup URL** → `http://$LAN_IP:$PORT/mobile-setup#pair=CODE` (no token) → install CA → **Open secure Nerve** → pairs over HTTPS.

- [ ] AUTH-2

### AUTH-3 Code is single-use and expires

Reuse the same code → fails. Wait past TTL → fails. Codes/credentials never appear in URL query; share links use fragment.

- [ ] AUTH-3

### AUTH-4 Remote desktop pairing (E4)

Launch desktop with `--connect https://host --pair-code CODE` → connects (conversations stream, WS works — header injection for WS handshakes is the main risk). Relaunch without the code → reconnects from the stored credential (`remote-credentials.json` in userData, encrypted). Revoke it on the server → relaunch fails; relaunch with a new code → re-pairs. `--token`/`NERVE_DAEMON_TOKEN` logs a deprecation warning and still connects (exchanged for a device credential).

- [ ] AUTH-4

### AUTH-5 Devices list

Shows all paired devices with name, kind, created, last seen, method (`pairing`/`passkey`/`legacy-token`); "this device" marked; rename dialog works; lastSeen updates after use; expired devices show an Expired badge with dismiss. Passkeys section: list/add/remove; removing the last one with publicUrl set shows the PASSKEY_LAST_REMAINING message. Recent activity list shows audit events. legacyBearerSeen banner appears after a non-loopback request with the daemon token as bearer.

- [ ] AUTH-5

### AUTH-6 Revoke

Revoke a device → its open tab drops to the pairing screen within ~2 s (WS closed, API 401). Other devices unaffected. **Revoke all others** keeps the current device. Rotate local token: in the desktop renderer devtools run `fetch('/api/access/local-token/rotate',{method:'POST'})` → app stays usable (shell re-reads `secrets/daemon-token` on 401 and re-installs its cookie); old token → 401. From a device credential the route returns 403 `LOCAL_ONLY`.

- [ ] AUTH-6

### AUTH-7 Legacy token link conversion

Open an old `?token=$TOKEN` link / bookmarked QR over HTTPS or loopback → redirects to clean URL, cookie set, new device "Legacy link" appears in Devices, revocable. Over plain HTTP LAN → "switch to HTTPS pairing" page, no cookie.

- [ ] AUTH-7

### AUTH-8 Audit log (Phase 3)

`pair`, `login`, `failed`, `revoked`, `rotated` events recorded as JSONL with IP and UA; **no secrets/codes/tokens** (`grep -i "$TOKEN\|$CODE"` over the file → none). Devices UI shows recent auth events.

- [ ] AUTH-8

### AUTH-9 CSP / connect-src

`connect-src` is now `'self' ws: wss:` (no `https:`). Browser console shows no CSP violations during normal use (providers, update check, avatars, Atlassian, GitHub, html previews).

- [ ] AUTH-9

---

## 6. Reverse proxy, passkey owner login, trustProxy **(Wave 4)** (E5)

Caddy setup:

```
nerve.example.com { reverse_proxy 127.0.0.1:43967 }
```

(For local testing use `nerve.localhost` with Caddy's internal CA, or a tunnel.) Set Settings → Network → `publicUrl` = `https://nerve.example.com`; daemon stays bound to loopback.

### PROXY-1 Warning without publicUrl

`allowRemote` on, no TLS, no publicUrl → Settings shows explicit warning.

- [ ] PROXY-1

### PROXY-2 Host handling

Through the proxy, `/health` and UI work with `Host: nerve.example.com`; direct request with other host → 421.

- [ ] PROXY-2

### PROXY-3 Setup code + passkey enrollment

With no passkey: non-loopback requests are refused except setup/enroll endpoints, static, `/health`. Daemon stdout on first remote start / `node dist/main.js pair --enroll` prints a setup code (10 min). Visit site → enter code → register passkey (setup codes go to `/api/access/passkeys/register/*`; `/api/access/pair` rejects them). Pairing codes for other devices are unavailable until a passkey exists.

- [ ] PROXY-3

### PROXY-4 Passkey login

Sign out → login page → passkey → app loads; device recorded with method `passkey`; cookie `Secure`. Challenge expiry (2 min) → retry works. Second passkey registration nudge shows.

- [ ] PROXY-4

### PROXY-5 Recovery

On server: `node dist/main.js access reset` → passkeys cleared, new setup code printed; old passkey no longer logs in.

- [ ] PROXY-5

### PROXY-6 trustProxy CIDR

`trustProxy.peers` default loopback: `X-Forwarded-For` from the proxy used as client IP in audit log. Set peers to a CIDR not containing the proxy → forwarded headers ignored (audit shows proxy IP, `X-Forwarded-Proto` not trusted → treated as non-TLS → device auth refused). Direct request from untrusted peer with spoofed `X-Forwarded-For: 127.0.0.1` cannot get `local` principal or evade throttling.

- [ ] PROXY-6

### PROXY-7 WebSockets through proxy

Conversation streams over proxy; idle for >60 s stays connected (long idle timeout); revoke closes the socket.

- [ ] PROXY-7

---

## 7. Conversations & agent turns (core + Wave 4 harness splits)

- [ ] **CONV-1** New conversation in a project; send prompt; streaming text, thinking blocks, tool calls render; turn completes; usage updates.
- [ ] **CONV-2** Stop mid-turn; Stop stays available while background work can wake the conversation (#526); resume afterwards.
- [ ] **CONV-3** Queue a message while running; edit/cancel queued input; it delivers after the turn.
- [ ] **CONV-4** Branching / retry / edit-message from history; transcript shows correct branch; reload keeps state.
- [ ] **CONV-5** Compaction (manual and auto at threshold); summary visible; conversation continues.
- [ ] **CONV-6** Multiple conversations concurrently; attention/unread indicators correct; discovery/search finds old ones.
- [ ] **CONV-7** Restart daemon mid-turn → conversation recovers to a sane state (no stuck "running").
- [ ] **CONV-8** Agent turns regression (harness split, **Wave 4**): multi-step tool use, parallel tool calls, provider error + retry, cancel during tool, token usage and cost totals unchanged vs main.
- [ ] **CONV-9** Conversation center split (**Wave 4**): header, transcript scroll/sticky bottom, jump-to-latest, composer focus, drafts persisted per conversation, switching conversations keeps scroll, keyboard shortcuts.
- [ ] **CONV-10** Prune conversations dialog (FormDialog): Enter does not trigger destructive action implicitly from inputs.

## 8. Models & providers

- [ ] **MOD-1** Model picker shows provider icon (not name); switching model mid-conversation applies on next turn.
- [ ] **MOD-2** Add custom provider (dialog: Enter submits once, spinner while busy, Cancel disabled while saving); model works.
- [ ] **MOD-3** Model definition dialog (wide), edit/save/delete.
- [ ] **MOD-4** Thinking/reasoning level selection; per-model capabilities respected.
- [ ] **MOD-5** Invalid key → clear error, no crash; usage in status bar refreshes after returning to a hidden tab (`createPoll`).

## 9. Tools

- [ ] **TOOL-1** `bash` foreground: output streams, exit code, large output projected/truncated with retrieval; cwd correct.
- [ ] **TOOL-2** `read`/`write`/`edit` file tools; edit conflict on externally modified file shows conflict, not "invalid".
- [ ] **TOOL-3** Search/glob/grep tools return expected results; project-relative path rejection: `.//a` rejected, `a/./b` normalizes to `a/b` (completions, launch target, project listing).
- [ ] **TOOL-4** Web/Atlassian/Tavily tools: account dialogs save (Enter submits once), Jira/Confluence non-JSON body → `*_INVALID_RESPONSE` error rather than raw text.
- [ ] **TOOL-5** Tool call cards (**Wave 4 split**): each card type (bash, file edit/diff, read, search, web, task, sub-agent, plan, question) renders running/success/error/cancelled; expand/collapse; copy; long output; approval buttons inside card.
- [ ] **TOOL-6** Tool config dialog: footer buttons left-aligned; saves; Enter submits.
- [ ] **TOOL-7** Old tool output clearing/projection: very large output stored as file, model can read it back by reference; old outputs cleared per setting.

## 10. Background tasks (Wave 3)

Design: `docs/architecture/conversation-core/async-bash-and-launches.md`.

- [ ] **BG-1** `bash` with `background:true`; let finish → task card, model receives `<background_task_update>`, outcome `completed`.
- [ ] **BG-2** Failing command → `failed`; nonzero exit shown.
- [ ] **BG-3** Ready pattern: `background:true` + `ready` regex (e.g. dev server prints "Listening") → tool returns at match in the same call with process still running; later completion yields notice.
- [ ] **BG-4** Ready pattern never matches → readiness timeout reported; process handling per spec (not leaked).
- [ ] **BG-5** Command timeout → outcome `timed_out`, process tree killed.
- [ ] **BG-6** Cancel during readiness wait (Stop or cancel task) → process cancelled, outcome `cancelled`, no orphan (`ps`).
- [ ] **BG-7** Cancel a running background task from the UI → `cancelled` notice; model informed.
- [ ] **BG-8** Restart daemon while async bash runs → on startup it settles as **interrupted**, one notice only, process not orphaned.
- [ ] **BG-9** Sub-agent: spawn; completion notifies the lead with `task_result` (subagent); child terminal state and parent notice appear together (no finished child without a notice).
- [ ] **BG-10** `subagent_stop` and pausing the lead produce **no** notice.
- [ ] **BG-11** Notice wakes an idle lead; with several tasks finishing together, each reported once (no duplicates after restart).
- [ ] **BG-12** Task card UI: kind icon, outcome label for each of `completed/failed/cancelled/timed_out/interrupted`; legacy rows show as `task_result`.

## 11. Interactions (Wave 3)

Design: `docs/architecture/conversation-core/tool-call-lifecycle.md`.

- [ ] **INT-1** `ask_user`: question with options + free text; answer → model continues; cancel/dismiss handled; answer persists across reload.
- [ ] **INT-2** Approval approve → tool runs. Approve-always/rule creation (if offered) creates a rule.
- [ ] **INT-3** Approval deny (with and without reason) → tool not run; model sees denial.
- [ ] **INT-4** Plan review: reject with feedback → model revises plan; accept → implementation starts; accept with **choose model** → chosen model used for execution.
- [ ] **INT-5** `configuration_blocked` (e.g. missing key/setting) → prompt shown; resolving retries the call (`retry`), dismissing settles.
- [ ] **INT-6** Restart daemon with a pending interaction → still pending and resolvable; resolving twice (two clients) is idempotent, second gets a clear conflict.
- [ ] **INT-7** Interactions from a sub-agent surface to the user and resolve correctly.

## 12. Permissions (Auto / Supervise)

Spec: `docs/architecture/permissions.md`.

- [ ] **PERM-1** Supervise mode: writes, shell, network need approval; reads inside project don't.
- [ ] **PERM-2** Auto mode: in-project edits and safe commands run without prompts; out-of-project or risky still prompt.
- [ ] **PERM-3** Git read allowlist: `git status`, `git log`, `git diff`, `git show`, `git branch --list` classified read-only (no prompt in Supervise); `git push`, `git reset --hard`, `git checkout`, unknown subcommand, unknown global option (e.g. `git -c core.pager=x log`, `git --exec-path=...`) require approval. Same classification in plan mode.
- [ ] **PERM-4** Permission rules dialog: add/edit/delete allow & deny rules; Enter submits; rule takes effect immediately; deny beats allow.
- [ ] **PERM-5** Risk labels shown on approvals use `effectiveRisk` of the call; no stale deprecated risk values.
- [ ] **PERM-6** Agent profile trust/revoke for a project profile works in Settings (no "invalid" error).

## 13. Files panel & code viewer

- [ ] **FILE-1** Browse tree, large dirs (native listing), hidden/ignored files.
- [ ] **FILE-2** Open, edit, save file; unsaved-changes guard; external modification → conflict prompt.
- [ ] **FILE-3** Quick open (fuzzy) and content search; results open at line.
- [ ] **FILE-4** Diff viewer, image/HTML/markdown previews; HTML preview sandboxed (scripts cannot reach app).
- [ ] **FILE-5** Open / reveal in file manager / move to trash (desktop): only works inside registered project roots (see SEC-12).
- [ ] **FILE-6** Files panel after Wave 4 split: panel resize, tab state, tree expansion persisted, keyboard navigation, drag/drop move and Alt-copy, OS file upload with replace prompt, root and item context menus all present. Desktop: open / reveal / trash an entry (now resolved via project id → daemon), a legacy project-config issue's "open folder", and with the daemon stopped an open must error and do nothing.
- [ ] **FILE-7** Paths with spaces/unicode and symlinks.

## 14. Git, PRs and checks (regression area for Wave 4 splits)

- [ ] **GIT-1** Changes tab lists staged/unstaged/untracked; stage/unstage/discard; commit with message; amend.
- [ ] **GIT-2** Branch card: create/switch branch, switch-to-base, publish, push; stashes actions; merged PRs hidden from branch card.
- [ ] **GIT-3** Diff view per file and per commit; large diffs.
- [ ] **GIT-4** Prompt suggestions (git-aware) appear, dialog Enter submits once.
- [ ] **GIT-5** PR panel: create PR, view status, review/comment counts, merge state; sync refreshes (`docs/architecture/pull-request-sync.md`).
- [ ] **GIT-6** Checks: CI check list, statuses (pending/pass/fail), re-run link, auto-refresh while pending; offline/GitHub error handled gracefully.
- [ ] **GIT-7** Git panel after Wave 4 split: no visual/behavior difference vs main for all of the above; no console errors.
- [ ] **GIT-8** Worktrees / multiple repos in a project, if used.

## 15. Settings & dialogs

- [ ] **SET-1** FormDialog behavior in each migrated dialog: Atlassian, Tavily, launch folder, launch definition, prune, prompt suggestion, permission rule, custom provider, model definition, tool config → opens, Enter submits once, spinner while busy, Cancel disabled while saving, validation errors inline, Escape closes.
- [ ] **SET-2** Network settings: allowRemote, mobile HTTPS, `publicUrl`/`trustProxy` (Wave 4) save and apply; invalid CIDR rejected.
- [ ] **SET-3** Theme switching (incl. Indigo dark), font/density; persists across restart.
- [ ] **SET-4** Settings controllers (activity, maintenance, storage) load, refresh, show errors, no duplicate polling when tab hidden.
- [ ] **SET-5** Maintenance/storage panels: usage numbers, clean-up actions work.
- [ ] **SET-6** Launch definitions (dev servers) start/stop/log (`docs/architecture/launch-definitions.md`).
- [ ] **SET-7** Release check/update polling: pauses when hidden, refreshes on visible, no overlapping requests (watch network tab).

## 16. Mobile / PWA (E3)

- [ ] **MOB-1** Install local CA, open mobile-setup page: no token in the URL, "Open secure Nerve" keeps you signed in (iOS Safari and Android Chrome).
- [ ] **MOB-2** Native phone shell: conversation hub, grouped lists, safe areas; compose and send; streaming works.
- [ ] **MOB-3** Add to home screen; PWA launches standalone; offline/background resume reconnects WS; PWA update flow prompts once.
- [ ] **MOB-4** Approvals / ask_user answerable from phone.
- [ ] **MOB-5** Revoked phone (AUTH-6) lands on a re-pair page, not a broken app. **(Wave 4)**
- [ ] **MOB-6** `http://$LAN_IP:$PORT` plaintext: UI refuses device auth / redirects to HTTPS setup. **(Wave 4)**

## 17. Desktop app (E1) and remote desktop (E4)

- [ ] **DESK-1** App starts, connects to local daemon, tray menu works (incl. restart GPU process).
- [ ] **DESK-2** Open-path argv / "open folder in Nerve" from OS works.
- [ ] **DESK-3** Share link / mobile QR generation; copy works; no daemon-token in shown URLs (Wave 4).
- [ ] **DESK-4** Connect to remote daemon (E4): connects, WS stays up, conversations stream; wrong credentials → clear error.
- [ ] **DESK-5** Project-root registry **(Wave 4)**: add project → open/reveal/trash work; remove project → rejected; renaming/moving root re-registers; works after app restart (registry rebuilt from daemon).
- [ ] **DESK-6** Multiple windows; non-main frame IPC rejected.

## 18. Tooling, scripts and CI **(Wave 4)**

Design: `scripts/README.md`, `docs/architecture/codebase.md`.

- [ ] **TOOLS-1** `pnpm fix:focused` and `pnpm check:focused` on a small change: correct scope, green; `--dry-run` prints stage scope, reasons, commands; `--base HEAD` limits to local changes.
- [ ] **TOOLS-2** Plan golden tests: `cd scripts && pnpm exec tsx --test checks/test/plan-golden*.test.ts` (adapt path) pass for all change sets.
- [ ] **TOOLS-3** `pnpm test:scripts` passes; no orphaned `scripts/**/*.test.*`.
- [ ] **TOOLS-4** Scripts CLI helpers: `--help`, bad flag → usage error + non-zero exit, consistent log format across executors.
- [ ] **TOOLS-5** `pnpm migrations:check`, `pnpm storage:copy/migrate/rehearse` still run after fresh install (build prep).
- [ ] **TOOLS-6** ui-kit component tests: `cd packages/ui-kit && pnpm test:components`.
- [ ] **TOOLS-7** Per-package unit suites pass (contracts, protocol, tools, conversation-core, harness, workbench-server incl. `src/**`, workbench-app, ui-kit, scripts).
- [ ] **TOOLS-8** Boundary rule: `adapters/**` importing `app/**` fails lint (add a temp import to confirm; revert).
- [ ] **TOOLS-9** CI on the PR: `CI / Gate` required and green; `Lint / …` job separate (includes knip and ui-kit component tests); native addon cache hit on rerun; wall time ≤ ~480 s; script-only PR stays narrow; `knip` blocking (a step in the Lint job).
- [ ] **TOOLS-10** Branch protection references `CI / Gate` only (not renamed matrix jobs).

## 19. Results template

```
QA run: <date>   Tester: <name>   Branch/commit: <sha>   OS: <...>   Slot: <N>
Envs available: [ ] E1 desktop  [ ] E2 localhost  [ ] E3 phone  [ ] E4 remote desktop  [ ] E5 Caddy

| ID | Env | Result (PASS/FAIL/SKIP/N-A) | Notes / issue link |
|----|-----|-----------------------------|--------------------|
| MIG-1 |  |  |  |
| SEC-1 |  |  |  |
| ... |  |  |  |

Blocking failures:
-
Non-blocking issues:
-
Cases skipped (why):
-
Cleanup done: [ ] data/storage-N removed  [ ] Caddy/tunnel stopped  [ ] phone CA removed
Sign-off: ____________
```
