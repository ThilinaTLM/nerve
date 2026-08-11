---
title: Add images and voice
description: Paste clipboard images and transcribe voice into a prompt.
sidebar:
  order: 3
---

## Paste an image

Copy an image and paste with `Ctrl/Cmd+V` inside the composer. Nerve intercepts clipboard files with an `image/*` MIME type, stores each image under the operating system temp directory in `nerve/`, and inserts newline-separated local paths at the cursor.

Accepted MIME families include PNG, JPEG, GIF, WebP, SVG, BMP, TIFF, and AVIF. The path lets the agent's file-reading pipeline send image content to a capable model.

For a text-only model, configure and enable `explain_image` under **Settings → Tools**. The agent can then send the temporary path to the selected vision model and receive a detailed text explanation. The tool is completely hidden from vision-capable models and whenever it is disabled.

:::caution
Pasted files are temporary paths, not durable project attachments. `explain_image` uploads image bytes when its configured model is remote; use a compatible local vision provider when images must remain local.
:::

Dropping an image, another file, or a folder onto the desktop composer is different from clipboard image paste: it inserts the item's existing filesystem path without copying, uploading, or creating a durable attachment. See [Use the composer](/guides/composer/#drop-files-and-folders) for the full workflow. In a browser or installed PWA, use `@` completion to reference paths inside the project.

## Record voice

Use the microphone control or its keyboard shortcut. Recording can target the main composer or a user-question reply. Nerve shares one recording session across those surfaces.

- Maximum duration: 8 minutes.
- Maximum upload: 25 MB.
- Client transcription retries: up to 3.
- Right-click an active recording to cancel it.

The transcript is appended to the current draft; it is not sent automatically.

Voice requires OpenAI Codex/ChatGPT OAuth and uploads audio to ChatGPT's audio transcription endpoint using `gpt-4o-transcribe`. An OpenAI API key alone is not sufficient. Common WebM, MP4/M4A, WAV, MPEG/MP3, OGG, and FLAC recordings are accepted.

## Next steps

- [Model usage, images, and voice](/models/usage-images-voice/)
- [Provider troubleshooting](/troubleshooting/providers/)
