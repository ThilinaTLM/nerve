# Architecture reference

## Purpose

- Fast onboarding to CURRENT engineering decisions + why.
- Signal change cost/risk per area so effort/care scales with impact.
- Guide, not cage: invariants are few and justified; everything else is a default the engineer may improve.
- Not: API docs, code walkthrough, changelog, status report, backlog.

## Include test

Include a fact only if ≥1 is true:

- violating it causes data loss, security/privacy leak, user-visible regression, cross-platform break, or costly migration;
- it is non-obvious from code (rationale, rejected alternative, external constraint, legal/terms);
- it is a cross-cutting convention every change must follow (layers, tokens, error model, concurrency);
- it is known debt someone could mistake for intent.
  Otherwise leave it to code/comments. Exact constants: include only when they are a contract (quota default, timeout users see, token value table enforced by tests).

## Choosing pages

Derive from the project; typical candidates (pick, merge, rename, drop):

- runtime/concurrency/lifetimes; data/persistence/migrations; integrations/providers/secrets; storage/IO; domain policies; UI product rules; design system; platform/native; security/privacy; API/contracts; deployment/ops; development/build/CI/testing.
  Heuristic: one page per area where a wrong change is expensive or where ≥5 durable rules exist. Small projects: README + 2–4 pages. Design system gets its own page whenever UI exists and has tokens/components.

## Size

Size is a signal, not a limit. Length follows the topic: a design system with token tables or a data page with many invariants may need 500–600 lines; a small area may need 40. `doccheck.mjs hygiene` emits WARN above ~500 lines/page (~250 README, ~150 proposal) and > 10 MUSTs/page. A WARN is information, never an instruction to shorten. Mention it to the user; optionally review:

- detail the code/tests already own → replace with a pointer;
- same fact stated twice → keep one, link;
- narrative → rule bullet or table;
- history/status → delete;
- two unrelated audiences in one page → split.
  Never cut useful rules or rationale to get under a threshold. `<!-- size: reviewed -->` silences the warning once a long page is accepted.

## README.md (required sections)

1. One-paragraph what the system is + maturity/platform truth.
2. Page map table: page | read when you are….
3. Component/package table: owns | must not contain.
4. Principles: numbered, priority-ordered, each `rule. *Why:* reason.` Earlier wins on conflict.
5. Link to `glossary.md` (in the page map); never inline terms in README.
6. Change-risk map (see below).
7. Decision checklist: yes/no questions run before merging a design.
8. Settled directions: do-not-reintroduce list, each with pointer to proposal process to reopen.
9. Freedom statement: anything not stated as MUST is open; improving defaults is encouraged when rationale is recorded.

## Glossary

Always a separate file `docs/architecture/glossary.md` (keeps README compact; glossary grows independently). Linked from README map and agent-guidance block. Format: title, one-line purpose, alphabetical table: term | meaning here | not to be confused with. No other prose.

Include:

- project/domain-specific terms and acronyms (internal product names, business entities, team jargon);
- ordinary words with a narrower or different meaning here (e.g. a word that elsewhere means X but here means Y);
- near-synonyms the project deliberately distinguishes (two concepts that look alike but have different lifetimes/owners);
- code identifiers whose name misleads.
  Exclude general industry terms used in their normal sense.

Rules: one line per meaning; link the page that owns the concept; docs and proposals must use terms exactly as defined; when code names differ from glossary terms, give both. Unsure meanings go through SKILL.md "Asking the user".

## Rule strength

Mark strength so agents know what is fixed vs open:

- **MUST** / invariant: new changes keep it; changing the rule needs a proposal + user decision. Existing code that violates it is debt, not a reason to stop work. Always give _why_.
- **Default**: current convention; deviate with stated reason in PR/docs.
- Unmarked description: how it works today; free to change.
  Keep MUSTs scarce; a page full of MUST blocks invention.

## Change risk

Each page ends with (or README holds) a change-risk table:

| Area                                                    | Risk   | Why                              | Required care                                                  |
| ------------------------------------------------------- | ------ | -------------------------------- | -------------------------------------------------------------- |
| persisted schema / file formats                         | High   | existing user data, irreversible | migration + synthetic-DB tests, user sign-off for lossy change |
| public/external contracts, secrets, security boundaries | High   | external breakage, leaks         | …                                                              |
| cross-module contracts, concurrency model               | Medium | wide blast radius                | …                                                              |
| UI composition, internals behind stable interface       | Low    | local                            | normal review                                                  |

Risk drivers: persisted user data, migrations, external users/APIs, security/privacy, legal/terms, native/FFI/unsafe, cross-platform behaviour, vendored/forked deps, performance budgets. Low-risk areas should be explicitly called easy to change.

## Debt

Existing implemented decisions that are bad, risky or outgrown stay documented (they are current truth) but flagged:

```markdown
> **Known debt:** <what is wrong, impact>. Do not extend this pattern. Fix: [proposal](../proposals/<x>.md).
```

Must be a blockquote starting `> **Known debt:**` (other forms are reported by `hygiene`). Folder proposal: link `../proposals/<x>/README.md`.

- Only after the user confirmed it, or under debt delegation the user gave explicitly; then list it in the report (SKILL.md "Asking the user").
- Every debt marker links a proposal; that proposal links back to the architecture page (checked by `hygiene`).
- Roadmap gets a debt item for it.
- Partially fixed: keep the marker, narrowed to what remains.
- Remove marker when proposal is decommissioned.

## Page skeleton

```markdown
# <Area>

<1–3 lines: scope; where code lives; pointer to deeper in-code README if any>

## Rules (MUST/Default bullets with _why_)

## Design (key solutions; mermaid if ownership/flow; module paths)

## Gotchas (non-obvious constraints, external limits)

## Change risk (table or bullets)
```

Sections optional; order fixed when present.

## Design-system page (conditional: only if the project has a UI with tokens/components; skip otherwise)

Must be strict and complete enough to build UI without reading theme code:

- hard rules (no raw literals, motion via presets, layer order, enforcement test + escape hatch);
- layer diagram + "where does X go" decision chart;
- token tables by group (name, values per theme, use-for), derived-state rules, contrast guarantees;
- typography/space/size/radius/elevation/opacity/layout/motion scales;
- motion presets + reduced-motion behaviour;
- component conventions (variants, states, disabled/selection rules);
- accessibility checklist + known platform limits;
- extension procedures (add token / preset / component) incl. which tests to update.
  Values must match code; say code is authoritative and which tests pin them.

## development.md (usually; keep only items that exist in the project)

Examples: toolchain pin, workspace/dependency policy, feature flags, prerequisites per OS, everyday commands (required checks first), testing rules (no user data, native tests opt-in), env vars, tooling (labs/probes), vendored patches policy, CI jobs + what CI does not prove, platform status table, packaging state.
