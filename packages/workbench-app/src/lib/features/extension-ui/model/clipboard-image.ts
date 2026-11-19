/** Decodes base64 into a Blob; `undefined` when the data is not valid base64. */
export function base64ToBlob(
  dataBase64: string,
  mediaType: string,
): Blob | undefined {
  try {
    const binary = atob(dataBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mediaType });
  } catch {
    return undefined;
  }
}
