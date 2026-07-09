export async function writeClipboardText(text: string): Promise<void> {
  const clipboardApi = globalThis.navigator?.clipboard;
  if (clipboardApi?.writeText) {
    await clipboardApi.writeText(text);
    return;
  }

  throw new Error("Clipboard API is not available.");
}
