/** The image media type of `data` when it is PNG, JPEG or WebP, by its leading bytes. */
export function supportedImageType(
  data: Uint8Array,
): "image/png" | "image/jpeg" | "image/webp" | undefined {
  const at = (index: number) => data[index];
  if (
    data.byteLength >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (byte, index) => at(index) === byte,
    )
  )
    return "image/png";
  if (
    data.byteLength >= 3 &&
    at(0) === 0xff &&
    at(1) === 0xd8 &&
    at(2) === 0xff
  )
    return "image/jpeg";
  if (
    data.byteLength >= 12 &&
    String.fromCharCode(...data.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...data.subarray(8, 12)) === "WEBP"
  )
    return "image/webp";
  return undefined;
}
