export async function writeClipboardText(text: string): Promise<void> {
  const clipboardApi = globalThis.navigator?.clipboard;
  if (clipboardApi?.writeText) {
    await clipboardApi.writeText(text);
    return;
  }

  throw new Error("Clipboard API is not available.");
}

/** Copies an image. Clipboards reliably accept PNG only, so other formats
 * are converted through a canvas first. */
export async function writeClipboardImage(source: Blob): Promise<void> {
  const clipboardApi = globalThis.navigator?.clipboard;
  if (!clipboardApi?.write || typeof ClipboardItem === "undefined")
    throw new Error("Clipboard API is not available.");
  const png = source.type === "image/png" ? source : await toPng(source);
  await clipboardApi.write([new ClipboardItem({ "image/png": png })]);
}

async function toPng(source: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is not available.");
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("Image conversion failed.")),
        "image/png",
      ),
    );
  } finally {
    bitmap.close();
  }
}
