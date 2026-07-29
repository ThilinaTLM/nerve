---
title: Usage, images, and voice
description: Interpret model usage and understand media capability limits.
sidebar:
  order: 4
---

## Conversation usage

When providers return usage events, the composer can show cumulative input/output tokens, cache activity, estimated cost, and current context fraction. Unknown values remain unknown rather than being guessed.

These figures are operational estimates, not invoices. Provider accounting, cache rules, discounts, and subscription terms remain authoritative.

## Subscription windows

Nerve currently retrieves subscription usage snapshots only for OAuth Anthropic and OpenAI Codex. Refresh attempts are debounced per provider. This is separate from cumulative conversation usage and does not track general API-key billing.

## Image input

Custom model definitions can declare image input and the harness can pass image content. The public model picker does not currently expose modality and the composer enables clipboard image paste for every selected model. Select a model known to accept images; a text-only model can reject the request.

See [Images and voice](/guides/images-and-voice/) for clipboard behavior. Pasted images become temporary local paths rather than durable attachments.

## Voice input

Voice capture happens in the browser/Electron renderer, then uploads to ChatGPT's transcription endpoint. It requires OpenAI Codex OAuth with an account ID and uses `gpt-4o-transcribe`.

Limits are 8 minutes and 25 MB, with three client retry attempts. The transcript returns as editable text; audio is not added to the conversation as an attachment.

## Next steps

- [Connect a provider](/start/providers/)
- [Composer media guide](/guides/images-and-voice/)
