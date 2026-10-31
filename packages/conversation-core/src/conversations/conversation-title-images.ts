import {
  CONVERSATION_TITLE_IMAGE_MARKER as IMAGE,
  replaceConversationImages,
} from "@nervekit/contracts/core";

export const IMAGE_FILE_EXTENSIONS = [
  "avif",
  "bmp",
  "gif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "tiff",
  "webp",
].join("|");

export function hasImageReference(text: string): boolean {
  return replaceConversationImages(text, "") !== text;
}

export function normalizeTitleImages(input: string): string {
  let text = replaceConversationImages(input, IMAGE)
    .replace(/^(?:\s*\uE002)+\s*(.+)$/u, "$1 " + IMAGE)
    .replace(/([.!?])\s*\uE002$/u, " " + IMAGE + "$1");
  let seen = false;
  text = text.replaceAll(IMAGE, () => {
    if (seen) return " ";
    seen = true;
    return IMAGE;
  });
  return text;
}
