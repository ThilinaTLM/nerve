# `edit` calls with empty arguments and an unhelpful error

> **Status:** Bug report. Found while testing the conversation history work on dev slot 1.

## Symptom

During a Claude Haiku 5.5 run, two parallel `edit` calls failed with:

```
Tool execution failed.
Tool: edit
Reason: Invalid validated arguments for edit.
Next action: inspect the reason, adjust the request if appropriate, and retry only when safe.
```

The transcript showed two red `edit` cards with `+0 −0`. The model recovered on a later turn.

## Evidence

The data is in slot 1, conversation `conv_01M6T5FYM81VSF0YVRB4MQ2J2G`.

- **Assistant event** `evt_01M6T5H8R8859BJVDM2RD738ER`:
  - provider `anthropic`, model `claude-haiku-5-5`, `stopReason: "toolUse"`;
  - output tokens: 1,178, of which 95 are reasoning;
  - stored tool calls:
    ```json
    { "type": "toolCall", "id": "toolu_01KhsvWcStcwk3WVGrZ4t38f", "name": "edit", "arguments": {} }
    { "type": "toolCall", "id": "toolu_01GsN5fEQGpaLxYVDa4thswZ", "name": "edit", "arguments": {} }
    ```
- **Tool responses** have `"arguments": {}` and `"outcome": "failed"`.

The event's visible text and thinking come to only about 2.5 KB. Most of the 1,178 output tokens are therefore unaccounted for, which suggests the model _did_ stream edit arguments and they were lost while being assembled.

## Two problems

### 1. Possible argument loss in streaming

If the provider streamed `input_json_delta` chunks for these two tool calls, the assembled arguments should not be `{}`. Possible causes:

- partial-JSON accumulation keyed per content block failing for two parallel tool calls;
- a parse failure of the final JSON (for example, very large `edits` with unusual escaping) silently falling back to `{}`.

**To investigate:**

- Find where the Anthropic stream is assembled into `toolCall.arguments` (harness / model adapter) and check what happens when the final JSON parse fails. It should keep the raw text and surface a parse error, not `{}`.
- Reproduce with a scripted provider stream: two parallel `tool_use` blocks with interleaved `input_json_delta`s.
- Log the raw `argsText` length on a parse failure so this is diagnosable from stored data.

### 2. The error does not tell the model what is wrong

The message comes from `packages/tools/src/policy/permission-policy.ts` `normalizePermissionRequest`:

```ts
if (!Value.Check(definition.parameters, args)) {
  throw new Error(`Invalid validated arguments for ${input.toolName}.`);
}
```

- The text is internal ("validated") and names no field, so the model cannot correct itself.
- Arguments that fail the schema should have been rejected earlier, with field-level errors, by the normal argument validation. Reaching the permission policy with `{}` means that step either did not run or accepted `{}`.

**Fix direction:**

- Make sure schema validation runs before permission normalization and reports the first errors, e.g. `edit: missing required "path"; "edits" must be a non-empty array`.
- If permission normalization still needs a defensive check, use the same formatted errors and say that the arguments were empty when they are.
- When arguments are `{}` but the provider sent non-empty argument text, say so: "The tool arguments could not be parsed (N bytes received)".

## Tests

- **Tools unit test:** an `edit` call with `{}` yields an error that names the missing fields.
- **Harness/provider unit test:** two interleaved parallel tool-use streams assemble both argument objects; an unparsable final JSON surfaces a parse error and keeps the raw text.
