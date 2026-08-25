import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  matchesAddressedPeer,
  matchesNegotiatedPeerBinding,
  samePeer,
} from "../src/session/peer-binding.js";

const client = { role: "ui" as const, id: "client_1" };
const server = { role: "workbench_server" as const, id: "server_1" };

describe("negotiated peer binding", () => {
  it("matches exact peers while allowing an originally unaddressed target id", () => {
    assert.equal(samePeer(client, { ...client }), true);
    assert.equal(
      matchesAddressedPeer({ role: "workbench_server" }, server),
      true,
    );
    assert.equal(
      matchesNegotiatedPeerBinding(client, server, client, server, {
        role: "workbench_server",
      }),
      true,
    );
    assert.equal(
      matchesNegotiatedPeerBinding(
        { ...client, id: "client_2" },
        server,
        client,
        server,
        { role: "workbench_server" },
      ),
      false,
    );
  });
});
