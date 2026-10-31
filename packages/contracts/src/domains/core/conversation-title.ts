/** Reserved for automatically derived titles. Raw prompts must strip this token. */
export const CONVERSATION_TITLE_IMAGE_MARKER = "\uE002";
export type ConversationTitleSegment =
  | { type: "text"; text: string }
  | { type: "image" };

export function splitConversationTitle(
  title: string,
): ConversationTitleSegment[] {
  return title
    .split(CONVERSATION_TITLE_IMAGE_MARKER)
    .flatMap((text, index) => [
      ...(index ? [{ type: "image" as const }] : []),
      ...(text ? [{ type: "text" as const, text }] : []),
    ]);
}

export function conversationTitleToPlainText(title: string): string {
  return title.replaceAll(CONVERSATION_TITLE_IMAGE_MARKER, "(image)");
}

/** Recognizes image references without reading files or resolving URLs. */
export function replaceConversationImages(
  text: string,
  replacement: string,
): string {
  return text
    .replace(/!\[[^\]\n]*\]\([^)\n]*\)/gu, replacement)
    .replace(
      /(?:@)?(?:[A-Za-z]:[\\/]|[~./\\])?[^\s<>`"'(),;!?]*\.(?:png|jpe?g|gif|webp|svg|bmp|avif|heic|tiff?)(?:[?#][^\s<>`"'(),;!]*)?/giu,
      replacement,
    );
}
