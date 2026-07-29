---
title: Select models and thinking levels
description: Configure defaults, scopes, Explore models, and model-dependent thinking.
sidebar:
  order: 2
---

## Defaults and conversation selection

Settings stores a global default model/thinking level and remembers the last selection. Each conversation can change its model from the composer. A change during a run applies to the next provider request.

A model scope narrows the picker. Empty scope means every authenticated model; a nonempty list filters it. Stale scope entries remain in Settings as unavailable and are ignored until the model returns or the entry is removed.

Explore sub-agents have their own default model and thinking selection because parallel codebase research can benefit from a different cost/latency profile.

## Catalog limits

Nerve combines built-in and custom definitions. Current runtime resolution exposes complete catalogs for selected provider families; other providers can be limited to the first eight models. A missing compatible model can be added manually.

The public model record includes reasoning/thinking support, context window, and maximum output. Custom definitions can hold richer cost and input-modality metadata, but not every field reaches the model picker.

## Thinking levels

The full vocabulary is:

`off` · `minimal` · `low` · `medium` · `high` · `xhigh` · `max`

Concrete support comes from model metadata and provider mappings. `xhigh` and `max` are only meaningful for selected model families. Runtime resolution clamps unsupported requests.

## Choosing well

Use a fast model for small, well-scoped changes and a deeper supported thinking level for architecture or difficult debugging. Context size is not a quality score. Review provider price/terms rather than relying only on Nerve's cumulative cost display.

## Next steps

- [Custom providers](/models/custom-providers/)
- [Usage, images, and voice](/models/usage-images-voice/)
