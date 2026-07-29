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

A model belongs to a configured provider and can declare:

- model ID and display name;
- context and maximum-output limits;
- reasoning capability and supported thinking levels/mappings;
- text/image input modalities;
- input/output/cache cost metadata.

The runtime inherits connection fields from its custom provider or a built-in provider template. Test a new definition with read-only permission before granting mutation.

## Removal

Deleting a custom provider cascades its manually defined models and provider secret. Export or record configuration you need before deletion.

:::caution
Custom endpoint headers and credentials are security-sensitive. Do not paste secrets into conversation prompts, public logs, screenshots, or project resource files.
:::

## Next steps

- [Select models](/models/selecting-models/)
- [Provider troubleshooting](/troubleshooting/providers/)
- [Security model](/operations/security/)
