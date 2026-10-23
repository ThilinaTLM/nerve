---
title: Select models and thinking levels
description: Configure defaults, picker scopes, delegated-agent models, and model-dependent thinking.
sidebar:
  order: 2
---

## Defaults and conversation selection

User/project `config/agent.json` stores model/thinking defaults; remember-last-selection is removed. Each conversation can make an explicit model/thinking choice from the composer unless a profile requires it. Reset removes the choice and inherits; source labels explain the effective value. A change during a run applies to the next provider request.

A model scope narrows the picker. Empty scope means every authenticated model; a nonempty list filters it. Stale scope entries remain in Settings as unavailable and are ignored until the model returns or the entry is removed.

Sub-agents resolve their own defaults and [profile](/reference/agent-profiles/), never the lead's effective model/thinking. Scoped launch model/thinking overrides beat recommendations but not requirements. Creation freezes underlying preferences and the applied profile for follow-ups. To handle usage limits, edit the existing child's supported model/thinking controls directly; later lead/default/profile edits do not update it, and child profile switching is unsupported.

## Catalog limits

Nerve combines built-in and custom definitions. Current runtime resolution exposes complete catalogs for selected provider families; other providers can be limited to the first eight models. A missing compatible model can be added manually.

The public model record includes reasoning/thinking support, context window, and maximum output. Custom definitions can hold richer cost and input-modality metadata, but not every field reaches the model picker.

## Thinking levels

The full vocabulary is:

`off` · `minimal` · `low` · `medium` · `high` · `xhigh` · `max`

Concrete support comes from model metadata and provider mappings. `xhigh` and `max` are only meaningful for selected model families. Reasoning from a different source than the effective model can be fitted to supported levels, with a visible adjustment. An incompatible pair chosen at one scope, or incompatible required reasoning, is blocked rather than silently downgraded.

## Choosing well

Use a fast model for small, well-scoped changes and a deeper supported thinking level for architecture or difficult debugging. Context size is not a quality score. Review provider price/terms rather than relying only on Nerve's cumulative cost display.

## Next steps

- [Custom providers](/models/custom-providers/)
- [Agents and delegation](/guides/agents-and-delegation/)
- [Usage, images, and voice](/models/usage-images-voice/)
