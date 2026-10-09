# Input queue

Part of the [conversation core redesign](README.md).

One queue holds user prompts, parent prompts and system notices. Rows contain only undelivered inputs: no delivered or cancelled state and no separate idempotency key. Image locations stay in prompt text; there is no attachment column.

## Sources

| `source`              | Submitted by                                       | `content`                                                                                                                      |
| --------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `user`                | A person                                           | Prompt text, image paths and executable blocks                                                                                 |
| `parent_conversation` | The parent conversation (`sender_conversation_id`) | Prompt text                                                                                                                    |
| `system`              | An internal producer                               | Notice subtype (`async_bash_event`, `sub_conversation_event`, `user_intervention`, `notification`), producer and typed details |

Source does not grant priority or authority; delivery follows acceptance order.

## Delivery

After command preparation and settlement of the current turn's tool calls, and before the next model request, one transaction:

1. Appends eligible inputs in acceptance order: prompts as `user_message`, notices as `system_event`.
2. Advances the event head.
3. Updates `last_user_message_at` for delivered prompts.
4. Deletes the delivered queue rows.

Eligibility by `delivery_target`:

| Target               | Eligible                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `next_turn`          | At the next safe turn boundary, including continuing an execution after a final assistant response |
| `specific_execution` | Only during the execution started by `target_execution_id`                                         |
| `next_execution`     | At the start of the next execution, optionally after `target_execution_id` finishes                |

`wake_when_idle` decides whether accepting an input starts processing on an idle conversation or only queues it. System and parent inputs never override pause. Accepting a new user prompt clears pause and wakes normal processing.

Queued inputs never bypass an unresolved approval or question. Force push stops without setting pause, clears any existing pause and drains eligible queued inputs; see [cancellation and force push](tool-call-lifecycle.md#cancellation-and-force-push).

## Identities

- `input_id` identifies a submission. A sender reuses it when retrying; intentionally repeated text gets a new ID. Before delivery, deduplicate against the queue row; after delivery, against the event's `input_id`. Reuse with different content is rejected.
- `turn_id` identifies one model invocation plus its tool processing. One prompt can lead to several turns, and several inputs can be delivered within one execution. An input identity is not a turn identity.
- Internal tool-call IDs pair `TOOL_CALL` rows with responses; `provider_call_id` pairs model calls with assistant tool-call blocks.

## Command preparation

Fenced `!!!` blocks in a prompt run before delivery, tracked per block in `command_preparation`:

```text
not_started | running | completed | cancelled | indeterminate | not_run
```

- Record progress before executing a block; reuse confirmed results.
- Mark uncertain outcomes `indeterminate` instead of rerunning automatically.
- `completed` means an outcome was recorded, not that the command succeeded.
- `prepared_text` holds the prompt after block replacement; null means unfinished or not applicable.
- Results are expanded into the prompt; receipts are preserved in the delivered `user_message` payload before the row is deleted.

## Cancellation

Cancelling removes an undelivered row without writing an event. Deduplication therefore covers pending and delivered submissions, **not cancelled ones**: retrying a cancelled submission with the same `input_id` queues it again. This gap is accepted rather than adding a receipt or tombstone table.
