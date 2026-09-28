import assert from "node:assert/strict";
import test from "node:test";
import type { LiveProtocolRequester } from "./live-protocol-client";
import {
  LiveProtocolSessionUnavailableError,
  installLiveProtocolRequester,
  requestLiveProtocol,
} from "./live-protocol-client";

test("delegates requests only to an installed ready live requester", async () => {
  const calls: string[] = [];
  const requester = {
    isReady: () => true,
    request: async (method: string) => {
      calls.push(method);
      return {
        version: "1.2.3",
        releaseUrl: "https://example.com/release",
        publishedAt: "2026-01-01T00:00:00.000Z",
      };
    },
  } as LiveProtocolRequester;
  const uninstall = installLiveProtocolRequester(requester);
  try {
    const result = await requestLiveProtocol("status.latestRelease.get", {});
    assert.equal(result.version, "1.2.3");
    assert.deepEqual(calls, ["status.latestRelease.get"]);
  } finally {
    uninstall();
  }

  await assert.rejects(
    requestLiveProtocol("status.latestRelease.get", {}),
    LiveProtocolSessionUnavailableError,
  );
});

test("does not delegate while the installed requester is not ready", async () => {
  let called = false;
  const uninstall = installLiveProtocolRequester({
    isReady: () => false,
    request: (() => {
      called = true;
      return Promise.reject(new Error("unexpected"));
    }) as LiveProtocolRequester["request"],
  });
  try {
    await assert.rejects(
      requestLiveProtocol("status.latestRelease.get", {}),
      LiveProtocolSessionUnavailableError,
    );
    assert.equal(called, false);
  } finally {
    uninstall();
  }
});
