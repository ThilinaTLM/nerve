---
title: Add images and voice
description: Paste clipboard images and transcribe voice into a prompt.
sidebar:
  order: 3
---

## Paste an image

Copy an image and paste with `Ctrl/Cmd+V` inside the composer. Nerve intercepts clipboard files with an `image/*` MIME type, stores each image under the operating system temp directory in `nerve/`, and inserts newline-separated local paths at the cursor.

Accepted MIME families include PNG, JPEG, GIF, WebP, SVG, BMP, TIFF, and AVIF. The path lets the agent's file-reading pipeline send image content to a capable model.

:::caution
The composer does not currently prevent image paste when a text-only model is selected. Choose a model known to support image input. Pasted files are temporary paths, not durable project attachments, and the UI does not promise a file-size or decoded-signature validation boundary.
:::

Nerve does not currently provide generic file attachment, thumbnail, or composer drag-and-drop. Use `@` completion to reference files already in the project.

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
