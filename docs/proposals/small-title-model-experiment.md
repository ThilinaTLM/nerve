# Small title model experiment

> **Status:** Proposal. This document describes an offline experiment, not product functionality. No application code changes are proposed.

## Summary

Find out whether a small language model under 100 MB, fine-tuned on a few hundred examples, writes more meaningful conversation titles than the rule-based generator in `conversation-title.ts`.

The experiment has four steps:

1. Extract user prompts from local Nerve storage and clean them.
2. Have sub-agents write a good target title for each prompt.
3. Fine-tune two candidate models in Python.
4. Compare them with the rule-based generator on a held-out set.

The first dataset has 200–300 examples. If the results are promising, grow the dataset and repeat. Product integration is a separate decision made only after the experiment succeeds.

## Goals

- Measure whether a model of 100 MB or less, after fine-tuning, produces titles that people prefer and that stay faithful to the prompt.
- Build a repeatable pipeline (extract → clean → label → train → evaluate) that improves as data is added.
- Choose between the two candidate models with evidence.

## Non-goals

- Shipping the model, adding runtime dependencies, or changing how titles are created.
- Retitling existing conversations.
- Changes to the database schema or storage.
- Uploading prompts to third-party training services.

## Data source

Production storage (`~/.nerve/data/nerve.sqlite`) currently holds:

- 3,111 `user_message` events across 935 conversations.
- Of those conversations, 292 are top-level (`conversation.parent_conversation_id IS NULL`) across 8 projects.

The dataset contains only prompts written by people. The model's job is to title top-level conversations, which always start with a prompt a person typed.

- Include only top-level conversations (`parent_conversation_id IS NULL`).
- Exclude sub-agent conversations entirely. Their prompts are written by the lead agent, so they are AI-generated and would teach the wrong input distribution.
- Keep only messages with `payload.source = 'user'` and no `payload.senderConversationId`. Today every one of the 1,402 user messages in top-level conversations meets this. The filter is a guard against future message sources, so extraction should fail loudly if it removes anything unexpected.

Extraction rules:

- Always work on a read-only snapshot, never the live file:
  `sqlite3 -readonly ~/.nerve/data/nerve.sqlite ".backup <workdir>/nerve-snapshot.sqlite"`
- Read `conversation_event` rows where `event_type = 'user_message'`, ordered by `sequence`. Use `payload.originalText`, which holds the user's text before command preparation.
- Keep the first three user messages of each conversation. Record `conversation_id`, `project_id`, the message index, and the stored title for reference only. The stored title is not a training target.

## Privacy and file location

The prompts are private development history and may contain paths, hostnames, or pasted secrets.

- Keep all extracted data, labels, checkpoints, and reports in the gitignored `data/title-model/` directory. Nothing derived from prompts is committed.
- Commit only the pipeline scripts and this proposal: put the scripts in `experiments/title-model/`, with a `README.md` and a `requirements.txt`.
- The cleaning step removes likely secrets (tokens, keys, `user:password@` URLs, `.env`-style assignments) before any labelling or training.
- Labelling runs through Nerve sub-agents that use the provider already configured. No new external service is involved.

## Cleaning

Run cleaning in Python with deterministic rules, and use the same rules again at inference time:

1. Remove fenced code blocks and long pasted logs, leaving a short marker such as `[code]` or `[log]`.
2. Mask secrets as described above.
3. Replace references with placeholders that the model must copy exactly, so it never has to spell identifiers. This mirrors the reference extraction in `conversation-title.ts`:
   - GitHub URLs → `⟦R1⟧` (later restored as e.g. `PR acme/api#12`)
   - file paths and `@file` mentions
   - ticket keys
   - other URLs
4. Drop generated attachment mentions (`@image-<timestamp>.png`) and `@kind:name` mentions.
5. Normalize whitespace.
6. Skip conversations with no usable text after cleaning. Deduplicate near-identical first messages, such as repeated test prompts.

Each example stores its source in two forms:

- `first`: message 1 only, at most 300 tokens.
- `combined`: `[M1] … [M2] … [M3] …`, with message 1 capped at 300 tokens and messages 2 and 3 capped at 120 tokens each.

Both forms go into training, so the model works when the first title is created and when a later, better title is made.

## Labelling with sub-agents

A team lead splits the cleaned examples into batches of about 25. Sub-agents write targets in JSONL with this shape:

```json
{
  "id": "…",
  "variant": "first",
  "title": "Review changes in ⟦R1⟧",
  "confidence": "high",
  "note": ""
}
```

Labelling instructions (shared by every batch and versioned with the scripts):

- Write one title that a user would recognize while scanning a sidebar.
- At most 70 characters. Sentence case. No trailing punctuation. No quotes.
- Put the action and the main subject first. Prefer the user's own wording to paraphrase.
- Copy every placeholder that the title needs exactly. Never invent identifiers, numbers, resource types, or outcomes.
- Keep the user's uncertainty and negation, e.g. "Could X cause Y?" or "… but do not merge".
- Keep the title in the same language as the prompt.
- Answer `NONE` for greetings, or when nothing meaningful remains. The model learns to fall back on these.
- For `combined`, describe the conversation's main task. A follow-up should change the title only when it clearly redefines the task.

Quality control:

- An automatic check rejects titles that:
  - use unknown placeholders,
  - leave out a placeholder named in the prompt's main request,
  - are longer than 70 characters,
  - are empty.

  Rejected items go back for relabelling.

- A person reviews every low-confidence label and a random 20% of the rest, fixing them by hand. The dataset records which labels were reviewed by a person.
- Record the teacher model and instruction version for each label, so later datasets can be compared.

### Split

Split by conversation, never by message, so that the `first` and `combined` forms of one conversation stay on the same side:

- About 70% train, 10% validation, 20% test.
- Stratify by project so one repository does not dominate the test set.
- The test set is frozen once created. Future rounds add data only to train and validation, so results remain comparable.

## Candidate models

|                       | Flan-T5-small                                                                                 | SmolLM2-135M-Instruct                                  |
| --------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Architecture          | Encoder-decoder, 77M parameters                                                               | Decoder-only, 135M parameters                          |
| Expected bundled size | about 60–80 MB as int8 ONNX                                                                   | about 90–105 MB as 4-bit GGUF                          |
| Strengths             | Pretrained for short input → short output; learns from little data                            | Byte-level tokenizer handles any text; 8k context      |
| Risks                 | Tokenizer has no `{ } < ~`, newlines, or most CJK characters (placeholders reduce the impact) | At the size limit; 4-bit quantization may hurt quality |

Both models train on the same data. Sizes must be measured after export, not assumed.

## Training (Python)

- Stack: PyTorch, Hugging Face `transformers`, `datasets`, and `peft` if adapters are needed. `optimum` handles ONNX export and int8 quantization. `llama.cpp`'s converter produces GGUF for SmolLM2.
- Fine-tune the full model, since both are small. Starting point: learning rate about 3e-4 for T5 and about 5e-5 for SmolLM2, 5–15 epochs with early stopping on validation loss, and fixed seeds.
- Add the placeholder tokens (`⟦R1⟧`…`⟦R8⟧`, `[M1]`–`[M3]`, `[code]`, `[log]`) to each tokenizer as special tokens.
- SmolLM2 uses its chat template with one fixed system instruction, and loss is computed only on the title tokens.
- Decode with greedy or 2-beam search, a maximum of 24 new tokens, and no sampling, so outputs are deterministic.
- Hardware: one consumer GPU or a free cloud notebook is enough. A CPU-only run is possible for T5 but slow.

## Evaluation

Run every system on the frozen test set:

- the rule-based generator (`deriveConversationTitle`, called through a small Node script),
- both fine-tuned models, before and after quantization,
- the teacher labels (as the upper bound).

| Metric               | How it is measured                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| Faithfulness         | Share of titles that invent an identifier or drop the main one, checked automatically through the placeholders |
| Hallucination        | Manual check for claims or details not in the prompt                                                           |
| Preference           | Blind A/B comparison against the rule-based title on all test items, reviewed by a person                      |
| Fallback correctness | `NONE` produced on greetings and empty prompts, and not elsewhere                                              |
| Similarity           | ROUGE-L and chrF against the teacher titles, used only as secondary signals                                    |
| Cost                 | Exported file size, cold load time, and p50/p95 latency on CPU from Node (ONNX Runtime or llama.cpp)           |

### Success criteria for round 1

1. Bundled model of 100 MB or less, with p95 latency of 150 ms or less on a typical laptop CPU.
2. Preferred over the rule-based title in at least 60% of test items, with ties excluded.
3. Invented identifiers in at most 1% of outputs, and the main identifier dropped in at most 3%.

If no model meets all three, record why: data volume, model capacity, or tokenizer. Then decide whether to add data, try another model, or stop.

## Iteration

- Grow the dataset each round as new conversations accumulate, adding only to train and validation.
- Prioritize labelling the cases where the model and the rule-based generator disagree most, or where the model failed checks.
- Keep a small `CHANGELOG` in `data/title-model/` recording each round's dataset size, instruction version, model, and test metrics.

## Deliverables

1. `experiments/title-model/`, containing:
   - `extract.py`, which reads the snapshot and writes raw examples.
   - `clean.py`, which applies the shared cleaning rules and placeholder extraction, with unit tests.
   - `labels/instructions.md` and `validate_labels.py`, for labelling.
   - `train.py` and `export.py`, for both models.
   - `evaluate.py`, plus `baseline.mjs`, which calls the rule-based generator.
   - `README.md` with steps to reproduce.
2. A short results report in `data/title-model/reports/`, summarized in this proposal or in a follow-up issue.

## Open questions

- Should the person reviewing labels also see the stored title, or would that bias the review?
- If the experiment succeeds, will the model run in the daemon (ONNX Runtime or node-llama-cpp) or in the desktop shell only? This decision belongs to a later integration proposal.
