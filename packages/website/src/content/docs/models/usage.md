---
title: Usage and limits
description: Read token and cost figures in the composer and check subscription usage windows.
sidebar:
  order: 4
---

## Conversation usage

When providers return usage events, the composer can show cumulative input/output tokens, cache activity, estimated cost, and current context fraction. Unknown values remain unknown rather than being guessed.

These figures are operational estimates, not invoices. Provider accounting, cache rules, discounts, and subscription terms remain authoritative.

## Subscription windows

Nerve currently retrieves subscription usage snapshots only for OAuth Anthropic and OpenAI Codex. Refresh attempts are debounced per provider. This is separate from cumulative conversation usage and does not track general API-key billing.

## Next steps

- [Connect a provider](/start/providers/)
- [Images and voice](/guides/images-and-voice/)
