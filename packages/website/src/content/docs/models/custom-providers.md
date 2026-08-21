---
title: Custom providers and models
description: Configure compatible model endpoints and describe manually defined models.
sidebar:
  order: 3
---

Use a custom provider when you have a compatible endpoint or a model missing from the built-in catalog.

## Provider definition

A custom provider requires:

- a lowercase slug ID, 1–64 characters;
- display name and endpoint URL;
- a supported pi-ai API transport;
- optional headers and compatibility settings;
- provider authentication where required.

The UI supports the transports Nerve deliberately registers with pi-ai. “OpenAI-compatible” is not a guarantee that every server variant implements streaming, tools, reasoning, images, or usage identically.

## Model definition

Choose **Add model**, select an already configured or authenticated provider, and paste one pi-compatible model object into the JSON editor. Copy the object inside the provider's `models` array—not the outer `providers` configuration—from [pi.dev/models](https://pi.dev/models), or edit the template Nerve provides.

```json
{
  "id": "my-model",
  "name": "My Model",
  "reasoning": false,
  "input": ["text"],
  "contextWindow": 128000,
  "maxTokens": 16384,
  "cost": {
    "input": 0,
    "output": 0,
    "cacheRead": 0,
    "cacheWrite": 0
  }
}
```

Nerve accepts pi model metadata such as `thinkingLevelMap`, `compat`, model headers, sampling parameters, and tiered costs. Invalid JSON, unknown fields, and full provider configurations are rejected instead of being silently discarded.

Provider URLs, API types, headers shared by every model, and API keys remain in provider settings. The runtime inherits those connection fields from the selected custom provider or built-in provider template. Test a new definition with read-only permission before granting mutation.

## Removal

Deleting a custom provider cascades its manually defined models and provider secret. Export or record configuration you need before deletion.

:::caution
Custom endpoint headers and credentials are security-sensitive. Do not paste secrets into conversation prompts, public logs, screenshots, or project resource files.
:::

## Next steps

- [Select models](/models/selecting-models/)
- [Provider troubleshooting](/troubleshooting/providers/)
- [Security model](/operations/security/)
