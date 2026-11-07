# Heuristic conversation titles pick a late sentence

> **Status:** Bug report, low priority. Found while testing the conversation history work on dev slot 1, which has AI titles turned off.

## Symptom

A multi-sentence prompt received a title taken from its third sentence, an instruction near the end, instead of the main task:

> Create a new folder qa-sandbox in the project root and build a small Python CLI todo app there: a todo.py module with add/list/done/remove commands storing JSON, a README.md, and unit tests in test_todo.py. Run the tests with python3 -m unittest and fix any failures. Then use grep and read to review your own code, and finish with a short summary. Work step by step with separate tool calls; keep the todo list updated as you go.

Title: **"Use grep and read to review your own code, and finish with a short summary"**

That title is 14 words long, and it describes a follow-up step rather than the subject (a Python todo CLI).

## Reproduction

```ts
import { deriveConversationTitle } from "packages/conversation-core/src/conversations/conversation-title.ts";
deriveConversationTitle(promptAbove);
// "Use grep and read to review your own code, and finish with a short summary"
```

## Cause

`deriveConversationTitle` (in `packages/conversation-core/src/conversations/conversation-title.ts`) scores candidate fragments and keeps the best one.

- The first sentence contains a colon, file names and a long list. The scoring or fragment splitting probably penalizes or splits it.
- The later imperative sentence scores higher.
- Position in the prompt does not seem to carry enough weight.

## Proposed fix

- Give a strong bonus to the first sentence or clause, and to text before a colon ("Create a new folder qa-sandbox … build a small Python CLI todo app").
- Penalize fragments that start with sequencing words ("Then", "Finally", "Also", "After that") and generic process instructions ("review your own code", "finish with a short summary", "work step by step").
- Prefer the shorter title when scores are close; the AI title prompt asks for 4–9 words, and the heuristic could aim for the same range.

## Tests

Add this prompt to the `deriveConversationTitle` fixtures, expecting a title along the lines of "Create qa-sandbox Python CLI todo app". Add one or two similar multi-sentence prompts where the task comes first and process instructions follow.
