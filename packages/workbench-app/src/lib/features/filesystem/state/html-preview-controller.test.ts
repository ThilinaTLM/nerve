import { strict as assert } from "node:assert";
import { it } from "node:test";
import {
  createHtmlPreviewController,
  type HtmlPreviewSource,
} from "./html-preview-controller.js";
import type {
  HtmlPreviewCreateRequest,
  HtmlPreviewCreateResponse,
} from "@nervekit/contracts/filesystem";
import type { HtmlPreviewApproval } from "../../../presentation/files/html-preview-message.js";
import type { HtmlPreviewViewModel } from "../../../presentation/files/file-pane-contracts.js";

const source: HtmlPreviewSource = {
  key: "tab",
  projectId: "project",
  path: "docs/mock.html",
  text: "draft",
};
const capability = (n: number) => {
  const id = n.toString(16).padStart(64, "0");
  return { id, url: `/html-preview/${id}/document` };
};
const message = (category = "script", url = "https://cdn.example/a.js") => ({
  type: "nerve:html-preview-resource",
  category,
  url,
});
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture() {
  const calls: {
    request: HtmlPreviewCreateRequest;
    resolve: (value: HtmlPreviewCreateResponse) => void;
    reject: (error: Error) => void;
  }[] = [];
  const revoked: string[] = [];
  let state: HtmlPreviewViewModel & { pending?: HtmlPreviewApproval } = {};
  const controller = createHtmlPreviewController({
    create: (request) =>
      new Promise((resolve, reject) =>
        calls.push({ request, resolve, reject }),
      ),
    revoke: async (id) => {
      revoked.push(id);
    },
    changed: (next) => {
      state = next;
    },
  });
  return { controller, calls, revoked, state: () => state };
}

it("revokes stale creates, rejects stale failures, and revokes disposal", async () => {
  const f = fixture();
  f.controller.activate(source);
  f.controller.activate({ ...source, text: "new draft" });
  f.calls[0].resolve(capability(1));
  await tick();
  assert.deepEqual(f.revoked, [capability(1).id]);
  assert.equal(f.state().loading, true);
  f.calls[1].resolve(capability(2));
  await tick();
  assert.equal(f.state().url, capability(2).url);
  f.controller.activate({ ...source, key: "other" });
  f.controller.dispose();
  f.calls[2].reject(new Error("stale"));
  await tick();
  assert.deepEqual(f.state(), {});
  assert.deepEqual(f.revoked, [capability(1).id, capability(2).id]);
});

it("deduplicates exact origin/category consent, denies once, and reloads with approval", async () => {
  const f = fixture();
  f.controller.activate(source);
  f.calls[0].resolve(capability(1));
  await tick();
  f.controller.resource(message(), "https://app.example");
  f.controller.resource(
    message("script", "https://cdn.example/b.js"),
    "https://app.example",
  );
  f.controller.resource(message("image"), "https://app.example");
  const denied = f.state().pending!;
  f.controller.decide(false, denied);
  assert.equal(f.state().pending?.category, "image");
  f.controller.resource(message(), "https://app.example");
  const approved = f.state().pending!;
  f.controller.decide(true, approved);
  // Dialog close must not decline the next queued permission.
  f.controller.decide(false, approved);
  assert.deepEqual(f.calls[1].request.approvals, [
    { origin: "https://cdn.example", category: "image" },
  ]);
  assert.deepEqual(f.revoked, [capability(1).id]);
  f.calls[1].resolve(capability(2));
  await tick();
  f.controller.resource(message(), "https://app.example");
  assert.equal(f.state().pending, undefined);
  f.controller.retry();
  f.calls[2].resolve(capability(3));
  await tick();
  f.controller.resource(message(), "https://app.example");
  assert.equal(f.state().pending?.category, "script");
  f.controller.activate({ ...source, text: "edited" });
  assert.deepEqual(f.calls[3].request.approvals, []);
  assert.equal(f.state().pending, undefined);
});

it("leaving preview resets permissions and pending sessions cannot outlive disposal", async () => {
  const f = fixture();
  f.controller.activate(source);
  f.controller.activate(source);
  assert.equal(f.calls.length, 1);
  f.controller.dispose();
  f.calls[0].resolve(capability(1));
  await tick();
  assert.deepEqual(f.revoked, [capability(1).id]);
  assert.deepEqual(f.state(), {});
  f.controller.activate(source);
  assert.deepEqual(f.calls[1].request.approvals, []);
});

it("fails closed on malformed capability responses and supports retry", async () => {
  const f = fixture();
  f.controller.activate(source);
  f.calls[0].resolve({ id: capability(1).id, url: "https://evil.example" });
  await tick();
  assert.ok(f.state().error);
  assert.equal(f.state().url, undefined);
  assert.deepEqual(f.revoked, [capability(1).id]);
  f.controller.retry();
  f.calls[1].resolve(capability(2));
  await tick();
  assert.equal(f.state().url, capability(2).url);
});
