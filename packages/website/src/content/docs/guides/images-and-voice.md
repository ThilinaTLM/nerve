---
title: Images and voice
description: Paste images, get image descriptions from text-only models, generate images, and dictate prompts.
sidebar:
  order: 3
---

Show the agent an image, have it generate one, or dictate a prompt instead of typing.

## Paste an image

Copy an image and paste it into the composer with `Mod+V`. Nerve saves a temporary copy on your computer and inserts its path at the cursor. PNG, JPEG, GIF, WebP, SVG, BMP, TIFF, and AVIF images work. A model that accepts images can then read it.

The copy is temporary, not a project attachment. To refer to a file that already exists, drop it onto the desktop composer or use `@file:`. See [Write prompts](/guides/composer/#drop-files-and-folders).

## Use images with a text-only model

If your main model can't read images, turn on the **Image explanation** tool in **Settings → Tools** and choose an image-capable model for it. The agent can then ask that model to describe a JPEG, PNG, GIF, or WebP image and use the answer. The tool stays hidden while it's off, and when the main model already accepts images.

The image is sent to the model you choose for this tool. To keep images on your machine, point it at a local vision model through a compatible custom provider. Its usage and billing are separate from your main model's.

## Generate an image

Turn on **Image generation** in **Settings → Tools → Image generation** and choose a provider, model, and output defaults. The agent then writes the prompt, and the finished image appears in the conversation as a link to the file.

The OpenAI Codex provider uses your ChatGPT subscription's image access and limits, not API billing. Availability and options can vary by account.

## Dictate a prompt

1. Select the microphone in the composer, or use its [keyboard shortcut](/reference/shortcuts/).
2. Speak. A recording chip marks where the text will land.
3. Stop recording. The transcript replaces the chip, and nothing is sent until you press send.

You can also dictate an answer to an agent's question, or use **Quote & dictate** on selected text. Cancel a recording with `Escape` or by right-clicking it.

Voice needs a ChatGPT (OpenAI Codex) sign-in, and audio is uploaded to ChatGPT for transcription. A plain OpenAI API key isn't enough. See [Connect a model](/start/providers/).

## Good to know

- Recordings can be up to 8 minutes and 25 MB. Nerve retries a failed upload up to three times.
- Audio isn't saved in the conversation. Only the transcript text is.
- The microphone appears only where voice is supported.

:::caution
Image explanation and image generation can send image data to a remote provider. Check the model you chose before using sensitive images.
:::

## Next steps

- [Write prompts](/guides/composer/)
- [Usage and limits](/models/usage/)
- [Troubleshoot providers](/troubleshooting/providers/)
