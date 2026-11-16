---
title: Usage and limits
description: Read token and cost figures in the composer and check subscription usage limits.
sidebar:
  order: 4
---

## Conversation usage

When providers return usage events, the composer can show cumulative input/output tokens, cache activity, estimated cost, and current context fraction. Unknown values remain unknown rather than being guessed.

These figures are operational estimates, not invoices. Provider accounting, cache rules, discounts, and subscription terms remain authoritative.

## Subscription limits

Nerve retrieves subscription usage snapshots for OAuth Anthropic, OpenAI Codex and GitHub Copilot. Refresh attempts are debounced per provider, and the list shows only providers that have data plus the one you've selected. This is separate from cumulative conversation usage and does not track general API-key billing.

- **Anthropic and Codex** report rolling windows, usually a 5-hour session and a weekly limit, as a percentage with a countdown to reset.
- **GitHub Copilot** reports the plan's monthly allowance: GitHub AI Credits, or premium requests on plans still billed per request. The panel shows used and included amounts, what is left, the reset date and any additional usage billed beyond the allowance. Copilot Free also shows its completions allowance.
- **Copilot Business and Enterprise** seats draw from an organization pool. Without a per-user budget there is no personal limit, so Nerve shows the credits used instead of a percentage.

Copilot usage comes from the same internal GitHub endpoint VS Code reads, including GitHub Enterprise (GHE.com) logins. GitHub may change it without notice; when a reading can't be parsed, Nerve shows no data rather than a guess.

## Next steps

- [Connect a provider](/start/providers/)
- [Images and voice](/guides/images-and-voice/)
