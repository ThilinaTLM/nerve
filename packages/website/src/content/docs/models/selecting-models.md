---
title: Select models and thinking levels
description: Configure defaults, picker scopes, delegated-agent models, and model-dependent thinking.
sidebar:
  order: 2
---

## Defaults and conversation selection

Settings stores a global default model/thinking level and remembers the last selection. Each conversation can change its model from the composer. A change during a run applies to the next provider request.

A model scope narrows the picker. Empty scope means every authenticated model; a nonempty list filters it. Stale scope entries remain in Settings as unavailable and are ignored until the model returns or the entry is removed.

Sub-agents use the lead's model and thinking level unless their [profile](/reference/subagent-profiles/) names its own, which can suit work such as parallel codebase research. The choice is made when a sub-agent is created; afterwards you can change its model and thinking level in its own view like any conversation. If an existing child reaches usage limits, edit that child directly: changing its profile or the lead's model will not update it, and follow-ups keep its current configuration. Scoped profile configuration adds conversation-local model/thinking overrides for future children without changing reusable profiles.

## Catalog limits

Nerve combines built-in and custom definitions. Current runtime resolution exposes complete catalogs for selected provider families; other providers can be limited to the first eight models. A missing compatible model can be added manually.

The public model record includes reasoning/thinking support, context window, and maximum output. Custom definitions can hold richer cost and input-modality metadata, but not every field reaches the model picker.

## Thinking levels

The full vocabulary is:

`off` · `minimal` · `low` · `medium` · `high` · `xhigh` · `max`

Concrete support comes from model metadata and provider mappings. `xhigh` and `max` are only meaningful for selected model families. General runtime resolution clamps unsupported requests. Sub-agent profile configuration instead blocks known model/thinking incompatibility at creation, with a diagnostic prompting a supported choice; it must not silently downgrade an explicit profile choice.

## Choosing well

Use a fast model for small, well-scoped changes and a deeper supported thinking level for architecture or difficult debugging. Context size is not a quality score. Review provider price/terms rather than relying only on Nerve's cumulative cost display.

## Next steps

- [Custom providers](/models/custom-providers/)
- [Agents and delegation](/guides/agents-and-delegation/)
- [Usage, images, and voice](/models/usage-images-voice/)
