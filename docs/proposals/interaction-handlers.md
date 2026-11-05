# Interaction handlers: one handler per interaction kind

> **Status:** Proposal. Covers `packages/conversation-core/src/tool-calls/` (`tool-call-interactions.service.ts`, `core-tool-handlers.ts`, `core-tool.ts`) and `packages/contracts/src/domains/core/tool-call.ts`.

## Problem

A tool call can pause on an _interaction_: `approval`, `user_input`, `plan_review`, or `configuration_blocked`. The kind is a discriminant in the contract, but the behavior for each kind is spread over one 190-line method and several optional hooks.

### Kind branching in `ToolCallInteractions.resolve()`

`packages/conversation-core/src/tool-calls/tool-call-interactions.service.ts` (292 lines) `resolve()` (roughly lines 66-250) is one function that branches on `resolution.kind` / `interaction.kind` at least eight times:

- Mismatch check: `interaction.kind !== input.resolution.kind`.
- A **plan-review-only prelude**: if the stored plan review is already approved, run `handler.recover` to reconcile with config, and join or replay identical requests.
- Approval-only guard: `persistScope` without `suggestedRules`.
- Approval-only: `presentedApproval` capture, persist a permission rule, mark `ready`, start the worker.
- `configuration_blocked`: `cancel` settles `cancelled`, `retry` marks `ready` and restarts.
- Approval `deny`: settle `denied`.
- Everything else (user_input, plan_review): delegate to `handler.resolve`, with a `profile_transition` special-case.
- A **plan-review-only `catch`**: reopen via `handler.recover` and rethrow, while every other kind settles `failed`.

The common skeleton (idempotency against `resolutionRequestId`, stopping check, state check, write the resolution onto the interaction, finally clean controllers) is mixed with this per-kind logic, so each new kind or tweak edits a function whose invariants nobody can see.

### The tool handler is a second dispatch

`CoreToolHandler` (`core-tool.ts`) has optional `resolve` and `recover`. `core-tool-handlers.ts` implements `resolve` for `ask_user` (`if (resolution.kind !== "user_input") throw`) and `plan_review` (`if (resolution.kind !== "plan_review") throw`), re-checking the kind that the service already validated. Results are an untyped union (`CoreToolResolution`) in which the service has to sniff `"kind" in result && result.kind === "profile_transition"`. Approval and configuration-blocked have no handler at all; they live only in the service.

### Contract derives schemas by position

`packages/contracts/src/domains/core/tool-call.ts`:

```ts
export const interactionResolutionSchema = z.discriminatedUnion("kind", [ approval, user_input, planReviewResolutionSchema, configurationBlockedResolutionSchema ]);
...
resolution: interactionResolutionSchema.options[0].optional(),   // approval   (line ~214)
resolution: interactionResolutionSchema.options[1].optional(),   // user_input (line ~220)
resolution: interactionResolutionSchema.options[2].optional(),   // plan_review(line ~226)
```

Reordering the union silently attaches the wrong resolution schema to the wrong interaction. The configuration-blocked kind is already declared "once" (request + resolution + interaction in one place, lines 77-100), which shows the intended shape, but the other three are split between `interactionResolutionSchema` and `interactionSchema`. `planReviewResolutionSchema` additionally lives in `contracts/src/domains/agent-configuration/agent-configuration-operations.ts:277` and `core-operations.ts:90` imports `interactionResolutionSchema` for the RPC input.

## Goals / non-goals

**Goals**

- Declare each interaction kind once in contracts: `{ kind, request, resolution }`, with the unions built from the list.
- Each kind has one `InteractionHandler` in conversation-core that validates and applies a resolution and returns a closed outcome. `ToolCallInteractions.resolve()` shrinks to the shared skeleton.
- Remove duplicated kind checks and the `"kind" in result` sniffing.

**Non-goals**

- No change to wire format, stored interaction JSON, or the `InteractionResolveResult` returned to clients.
- No change to approval policy or permission-rule semantics.
- Not redesigning `CoreToolHandler.execute`.

## Proposed design

### Contracts: declare each kind once

```ts
// contracts/src/domains/core/tool-call.ts
function interactionKind<K extends string, Req extends z.ZodType, Res extends z.ZodType>(
  kind: K, request: Req, resolution: Res,
) {
  return {
    kind,
    resolution: resolution,
    interaction: z.object({
      kind: z.literal(kind),
      request,
      resolution: resolution.optional(),
      resolutionRequestId: z.string().optional(),
    }),
  } as const;
}

export const approvalKind = interactionKind("approval", approvalRequestSchema, approvalResolutionSchema);
export const userInputKind = interactionKind("user_input", userInputRequestPreprocessed, userInputResolutionSchema);
export const planReviewKind = interactionKind("plan_review", planReviewRequestSchema, planReviewResolutionSchema);
export const configurationBlockedKind = /* strict variant, as today */;

export const interactionSchema = z.discriminatedUnion("kind", [
  approvalKind.interaction, userInputKind.interaction,
  planReviewKind.interaction, configurationBlockedKind.interaction,
]);
export const interactionResolutionSchema = z.discriminatedUnion("kind", [
  approvalKind.resolution, userInputKind.resolution, /* ... */
]);
```

Both unions come from the same four declarations, so they cannot disagree and the `options[n]` indexing disappears. Exported types (`Interaction`, `InteractionResolution`, `ApprovalRequest`, …) stay identical, which a type-level equality test can pin. The `ConfigurationBlocked*` strict objects keep `z.strictObject`. A small wrapper parameter, `strict`, covers that.

### conversation-core: `InteractionHandler`

```ts
// conversation-core/src/tool-calls/interaction-handler.ts
export type InteractionOutcome =
  | {
      kind: "settle";
      status: "completed" | "denied" | "cancelled" | "failed";
      result: ToolExecutionResultPayload;
    }
  | { kind: "retry" } // mark ready and restart the worker
  | { kind: "reopen"; interaction: Interaction } // back to awaiting_input with a refreshed request
  | {
      kind: "transition";
      transition: ProfileTransitionResult;
      settle?: ToolExecutionResultPayload;
    };

export interface InteractionHandler<K extends InteractionKind> {
  readonly kind: K;
  /** Pure checks against the pending interaction. Throws a typed InteractionError. */
  validate(call: ToolCall, resolution: ResolutionOf<K>): void;
  /** Idempotent re-entry for an already-recorded resolution (e.g. plan approval after restart). */
  reconcile?(
    call: ToolCall,
    ctx: InteractionContext,
  ): Promise<InteractionOutcome | undefined>;
  apply(
    call: ToolCall,
    resolution: ResolutionOf<K>,
    ctx: InteractionContext,
  ): Promise<InteractionOutcome>;
  /** Called when apply throws. Default: settle failed. Plan review overrides to reopen. */
  onError?(
    call: ToolCall,
    error: unknown,
    ctx: InteractionContext,
  ): Promise<InteractionOutcome | "rethrow">;
}
```

`InteractionContext` carries what `InteractionHooks` provides today (permissions, `context(conversationId)`, `presentedApproval`, tool `CoreToolContext`, abort signal), narrowed per handler.

Handlers:

| Kind                    | validate                              | apply                                                                   | outcomes                                     |
| ----------------------- | ------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------- |
| `approval`              | `persistScope` needs a suggested rule | persist rule, restore the presented binding                             | `deny`→`settle denied`; `approve`→`retry`    |
| `configuration_blocked` | none                                  | none                                                                    | `cancel`→`settle cancelled`; `retry`→`retry` |
| `user_input`            | tool handler's own parsing            | `CoreToolHandler.resolve` (`ask_user`) builds the result                | `settle completed`                           |
| `plan_review`           | approve/reject shape                  | `CoreToolHandler.resolve`, `reconcile` via `recover`, `onError` reopens | `transition`, `reopen`, `settle`             |

`ToolCallInteractions.resolve()` becomes:

1. stopping/not-found/already-settled replay (stays in the service, it is kind-agnostic);
2. `handler = handlers.get(interaction.kind)`; `handler.validate`;
3. `handler.reconcile?.()` and early return when it yields an outcome;
4. record the resolution on the interaction;
5. `outcome = await handler.apply()` (catch → `onError`);
6. one `switch (outcome.kind)` that is the only place that calls `settlement.settle`, `hooks.update`, `hooks.start`.

`CoreToolHandler.resolve`/`recover` stay as the tool-specific _inputs_ to the `user_input` and `plan_review` handlers, but their return type becomes `InteractionOutcome` fragments (`settle` or `transition`) instead of the sniffed `CoreToolResolution` union.

## Migration / rollout

1. **Contracts first, no behavior change.** Introduce `interactionKind(...)` and rebuild `interactionSchema`/`interactionResolutionSchema` from it. Add a type-equality test against the current exported types, and keep `packages/contracts/test/core/tool-admission.test.ts` green. Move `planReviewResolutionSchema` import direction only if it does not create a cycle with `agent-configuration`; otherwise keep it imported.
2. **Extract `ApprovalHandler` and `ConfigurationBlockedHandler`** (they have no tool handler); route them through the new outcome switch while the rest stays in `resolve()`.
3. **Extract `UserInputHandler` and `PlanReviewHandler`**, including the plan-review prelude and reopen-on-error, and change `CoreToolHandler.resolve/recover` return types.
4. Delete the kind branches from `resolve()` and the `"kind" in result` sniffing.

Each step is mechanical and independently shippable. `tool-call.service.test.ts` and `core-tool-handlers.test.ts` plus `plan-review-result.test.ts` and `runtime/plan-review-lifecycle.test.ts` are the existing behavioral net; add one table-driven test that every declared kind has a registered handler.

## What gets deleted / simplified

- The `options[0|1|2]` indexing in contracts.
- About 150 lines of kind-specific branches in `resolve()`; the method keeps only the shared skeleton and one outcome switch.
- The duplicate `resolution.kind !== "…"` guards in `core-tool-handlers.ts` (lines ~95, ~194).
- The untyped `CoreToolResolution` + `profile_transition` sniffing.

## Risks & open questions

- **No storage change.** Interaction JSON and resolution JSON on tool calls are untouched; this proposal needs **no DB or storage-format approval**. If someone tries to also normalise stored interactions, that must be raised separately per AGENTS.md.
- **Subtle ordering**: the current code records the resolution on the call _before_ applying and relies on that for idempotent retries (`resolutionRequestId`). Keep step 4 before `apply`.
- **Plan-review recovery semantics** (`resolvedAgain`, "keep accepted state when configuration cannot be refreshed") are intricate; moving them into `reconcile`/`onError` must keep the existing tests unchanged, not rewritten.
- **Zod typing**: deriving a discriminated union from a helper that returns objects needs tuple typing so inference still narrows `ResolutionOf<K>`. If inference degrades, fall back to declaring the four kinds explicitly as consts and building both unions from them without the helper.
- **Registry location**: handlers live in conversation-core. The generic registry must not leak into `contracts` (kept transport-neutral).

## Effort

M: about 2 days. Contracts step is small (half a day); handler extraction is the bulk and is largely moving code.
