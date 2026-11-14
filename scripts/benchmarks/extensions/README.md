# Extensions benchmark

Task suite from the [extensions proposal](../../../docs/proposals/extensions/README.md#measurement) for `quick_script` against the test Atlassian site, per model family. It gated delivery step 5 by comparing `quick_script` with the direct Jira and Confluence tools (Claude Haiku 5.5: 45/45 vs 44/45); those tools are removed, so only the `quick_script` variant remains, for regression runs.

It drives an **already running** dev slot (never slot 1, never started or stopped by the harness) through the same conversation channel the app uses (`/ws/conversations`, authenticated with the slot's `secrets/daemon-token`). Verification and cleanup call Jira and Confluence directly with the product's own clients (`@nervekit/extensions` clients) using the slot's Atlassian account. Both need `pnpm build` output (`packages/*/dist`).

## Run

```sh
# Offline-safe checks, no model calls: task file, slot, models, rule set, both variant configurations, sandbox access, cost estimate.
pnpm exec tsx scripts/benchmarks/extensions/run.ts --slot 5 --dry-run --model anthropic/claude-sonnet-5,openai/gpt-5.5

# Fixture round trip without a model (creates, checks and deletes sandbox fixtures; never touches the daemon's data).
pnpm exec tsx scripts/benchmarks/extensions/run.ts --slot 5 --selftest

# One cheap lookup, once, on the first model (real model usage, a few requests).
pnpm exec tsx scripts/benchmarks/extensions/run.ts --slot 5 --smoke --model anthropic/claude-sonnet-5

# Full benchmark: costs real model usage; ask first.
pnpm exec tsx scripts/benchmarks/extensions/run.ts --slot 5 --variant quick_script \
  --model anthropic/claude-sonnet-5,openai/gpt-5.5 --runs 5 [--tasks lookup-issue,bulk-label]
```

`--help` lists every flag (`--rule-set` default `supervised`, `--jira-project SCRUM`, `--space SD`, `--project extensions-benchmark`, `--timeout-sec 900`, `--no-probe`, `--delete-conversations`, `--out`). Output goes to `<out>/<timestamp>/results.json` and `summary.md` (default `/tmp/nerve-bench/extensions`), rewritten after every run so an interrupted run keeps its data. Each benchmark conversation stays in the slot's `extensions-benchmark` project (title `[bench] <task> <variant> r<n>`) for inspection unless `--delete-conversations`.

Pass one model per family (Claude, GPT) in `--model`; the family is derived from the id and the summary compares variants within a family. A run order of run → task → model → variant keeps variants interleaved.

## What a run does

1. The task's `setup` creates its fixtures in the sandbox (every Jira issue carries label `bench-<runId>`, every page title starts with `[bench <runId>]`) and returns the prompt.
2. A conversation is created in the benchmark project with per-conversation overrides: the model, the rule set, and tool enablement. `quick_script` is on; web search/fetch, sub-agents, image explanation and `plan_present` are off; `bash` and `python_exec` stay on (the Excel task needs them).
3. Approvals are polled and answered by [`policy.ts`](policy.ts): approve inside the task's declared scope (issue keys and page ids of its own fixtures, sandbox project/space only, shell only when the task declares it, deletes only when declared), deny otherwise. `ask_user` is dismissed. Both are counted.
4. When the conversation is idle, the task's `check` verifies the outcome with read-only requests or the final answer. Cleanup runs in reverse order even on failure.

Tasks ([`tasks.ts`](tasks.ts)): `lookup-issue`, `lookup-page` (single lookups); `join-issues-page`, `join-status-counts` (cross-call joins); `bulk-label`, `bulk-transition-comment` (bulk updates with approvals); `excel-to-confluence` (generated `sales.xlsx` to a page with a table and a chart image); `pitfall-custom-field` (field by display name), `pitfall-transition-field` (skipped, reported, when no workflow transition has a required field; SCRUM has none today), `pitfall-stale-version` (page edited twice behind the prompt's back).

## Metrics ([`metrics.ts`](metrics.ts), [`report.ts`](report.ts))

Per run, from the conversation's recorded events: success, turns (assistant messages), input/output/total tokens from each response's usage, input tokens of every request up to and including the one that issued the first successful SDK call (`quick_script` code touching `jira.`/`confluence.`/`diagram.`/…), failures classified as wrong arguments or unknown methods, calls into unavailable namespaces (not-available/not-configured errors, or a tool that no longer exists), approvals requested and denied, dismissed questions. Failures are classified by error-text patterns, so spot-check `results.json` against a conversation before trusting small differences.

Tool-definition tokens per request cannot be read from usage directly. Before the runs, one trivial conversation per model and variant (plus a `none` baseline with `quick_script` off) records the first request's input tokens; the difference to the baseline is the variant's tool-definition cost.

The summary table lists success and cost per family and per task.

## Cost

Per pass over all 10 tasks about 71 model requests (the `estimatedModelCalls` in `tasks.ts`). The full matrix, 5 runs × 2 variants × 2 families, is 200 runs and about 1,420 requests, plus 6 probe requests. Each request re-reads a 10-30k-token context (mostly cache reads), so expect on the order of 20-40M input-side tokens and 0.3-0.6M output tokens in total, and 1.5-3 hours sequentially. `--tasks` and `--runs` scale it linearly; `--dry-run` prints the exact planned run and request counts.

## Limits

- Verified without a model: task file validation, dry run against a running slot, fixture setup/check/cleanup against the sandbox (`--selftest`), metric and policy unit tests. The conversation driving loop and event classification have not been exercised with a real model yet; run `--smoke` first and read its conversation.
- Slot 5 has no Atlassian token unless `copy-secrets` was run for it; set `ATLASSIAN_SITE_URL`, `ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN` to override the slot account.
