import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BoundedProcessOutput } from "../src/execution/common/bounded-process-output.js";

describe("BoundedProcessOutput", () => {
  it("retains a bounded head and rolling tail with exact omission counts", () => {
    const output = new BoundedProcessOutput(8, 4);
    output.push("stdout", Buffer.from("abcdefgh"));
    output.push("stderr", Buffer.from("ijkl"));
    output.push("stdout", Buffer.from("mnop"));

    const snapshot = output.snapshot();

    assert.equal(snapshot.totalBytes, 16);
    assert.equal(snapshot.retainedBytes, 12);
    assert.equal(snapshot.omittedBytes, 4);
    assert.equal(snapshot.truncated, true);
    const combined = Buffer.concat(snapshot.combinedChunks).toString();
    assert.match(combined, /^abcdefgh/);
    assert.match(combined, /4 output bytes omitted/);
    assert.match(combined, /mnop$/);
    assert.match(
      Buffer.concat(snapshot.stdoutChunks).toString(),
      /4 output bytes omitted/,
    );
    assert.equal(Buffer.concat(snapshot.stderrChunks).toString(), "");
  });

  it("does not duplicate a tail while output remains inside the head", () => {
    const output = new BoundedProcessOutput(16, 4);
    output.push("stdout", Buffer.from("small"));

    const snapshot = output.snapshot();

    assert.equal(Buffer.concat(snapshot.combinedChunks).toString(), "small");
    assert.equal(snapshot.truncated, false);
    assert.equal(snapshot.omittedBytes, 0);
  });
});
