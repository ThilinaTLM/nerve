import type { ConversationTreeEntry } from "./entries.js";

type NavigationText = {
  newLeafId: string | null;
  editorText?: string;
};

type TextLikeContent = string | readonly { type: string; text?: string }[];

export function editorTextForNavigatedEntry(
  targetEntry: ConversationTreeEntry,
  targetId: string | null,
): NavigationText {
  if (targetEntry.type === "message" && targetEntry.message.role === "user") {
    return {
      newLeafId: targetEntry.parentId,
      editorText: textFromContent(
        targetEntry.message.content as TextLikeContent,
      ),
    };
  }
  if (targetEntry.type === "custom_message") {
    return {
      newLeafId: targetEntry.parentId,
      editorText: textFromContent(targetEntry.content),
    };
  }
  return { newLeafId: targetId };
}

function textFromContent(content: TextLikeContent): string {
  return typeof content === "string"
    ? content
    : content
        .filter(
          (item): item is { type: "text"; text: string } =>
            item.type === "text",
        )
        .map((item) => item.text)
        .join("");
}
