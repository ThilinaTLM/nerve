import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONVERSATION_TITLE_IMAGE_MARKER as IMAGE,
  conversationTitleToPlainText,
  replaceConversationImages,
  splitConversationTitle,
} from "../../src/domains/core/conversation-title.js";

test("image title segments and plain-text fallback", () => {
  assert.deepEqual(splitConversationTitle(`Review ${IMAGE} now`), [
    { type: "text", text: "Review " },
    { type: "image" },
    { type: "text", text: " now" },
  ]);
  assert.equal(
    conversationTitleToPlainText(`Review ${IMAGE}`),
    "Review (image)",
  );
});
test("ordinary manual titles stay untouched", () => {
  const title = "Review @image.png (image) [image]";
  assert.equal(conversationTitleToPlainText(title), title);
  assert.deepEqual(splitConversationTitle(title), [
    { type: "text", text: title },
  ]);
});

test("replaces markdown images before scanning image-path tokens", () => {
  assert.equal(
    replaceConversationImages(
      "Review ![a [nested label](not-an-image) and ![](x) @C:\\shots\\A.JPEG?raw=1#x, ~/b.tiff; https://x/c.webp#preview now",
      IMAGE,
    ),
    `Review ${IMAGE} and ${IMAGE} ${IMAGE}, ${IMAGE}; ${IMAGE} now`,
  );
  assert.equal(
    replaceConversationImages(
      "![broken]x ![ok](target) ![line\nbreak](x)",
      IMAGE,
    ),
    `![broken]x ${IMAGE} ![line\nbreak](x)`,
  );
  assert.equal(replaceConversationImages("![x](a\rb)", IMAGE), IMAGE);
  assert.equal(replaceConversationImages("![x](a\nb)", IMAGE), "![x](a\nb)");
});

test("preserves greedy extensions, partial tokens, and query boundaries", () => {
  assert.equal(
    replaceConversationImages(
      'a.png.b.jpgTAIL a.png#v?next.jpg?x! b.pngTAIL?c.gif q.ſvg .tiffz <x.avif> "x.heic"',
      IMAGE,
    ),
    `${IMAGE}TAIL ${IMAGE}! ${IMAGE}TAIL?${IMAGE} ${IMAGE} ${IMAGE}z <${IMAGE}> "${IMAGE}"`,
  );
  assert.equal(replaceConversationImages("a.png?x?y#z", IMAGE), IMAGE);
  assert.equal(
    replaceConversationImages("![x](target)", "next.png"),
    "next.png",
  );
});

test("retains replacement-string substitutions", () => {
  assert.equal(
    replaceConversationImages("before a.png after", "[$$][$&][$`][$']"),
    "before [$][a.png][before ][ after] after",
  );
  assert.equal(
    replaceConversationImages("before ![x](target) after", "[$$][$&][$`][$']"),
    "before [$][![x](target)][before ][ after] after",
  );
});

test("scans adversarial unterminated markdown images without retrying openers", () => {
  const labels = "![".repeat(100_000);
  const destinations = "![x](".repeat(50_000);
  assert.equal(replaceConversationImages(labels, IMAGE), labels);
  assert.equal(replaceConversationImages(destinations, IMAGE), destinations);
  assert.equal(replaceConversationImages(`${labels}](target)`, IMAGE), IMAGE);
  assert.equal(
    replaceConversationImages(`${destinations}\n![ok](target)`, IMAGE),
    `${destinations}\n${IMAGE}`,
  );
});

test("scans adversarial non-image paths and repeated extension candidates", () => {
  const noExtension = "a".repeat(200_000);
  const nearExtensions = "a.pn.".repeat(40_000);
  const extensions = "a.png#".repeat(30_000);
  assert.equal(replaceConversationImages(noExtension, IMAGE), noExtension);
  assert.equal(
    replaceConversationImages(nearExtensions, IMAGE),
    nearExtensions,
  );
  assert.equal(replaceConversationImages(`${nearExtensions}jpg`, IMAGE), IMAGE);
  assert.equal(
    replaceConversationImages(`${extensions}?query!tail`, IMAGE),
    `${IMAGE}!tail`,
  );
});
