import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

type Stage =
  | "decision"
  | "release"
  | "lease"
  | "claim"
  | "effect"
  | "result"
  | "append"
  | "settlement";
type Snapshot = {
  agent: string;
  run?: string;
  interactions?: string[];
  transitions?: string[];
  tools: {
    id: string;
    status: string;
    attempt?: number;
    revision: number;
    error?: string;
  }[];
  work: {
    kind: string;
    state: string;
    generation: number;
    failurePhase?: string;
    proposalId?: string;
  }[];
  issues: { code: string; proposalId?: string }[];
  results: string[];
  effects: string[];
};
type Message = {
  event: "ready" | "snapshot" | "decided" | "barrier" | "error";
  state?: Snapshot;
  name?: Stage;
  error?: string;
};
const childPath = fileURLToPath(
  new URL("../../support/approval-checkpoint-child.ts", import.meta.url),
);
const timeoutMs = 15_000;

class ProcessHarness {
  readonly child: ChildProcess;
  private readonly messages: Message[] = [];
  private readonly waiters = new Set<() => void>();
  private output = "";
  private exited = false;
  constructor(
    mode: "setup" | "recover",
    home: string,
    workspace: string,
    count: number,
    stage: Stage,
  ) {
    const environment = { ...process.env };
    delete environment.NODE_TEST_CONTEXT;
    this.child = spawn(
      process.execPath,
      ["--import=tsx", childPath, mode, home, workspace, String(count), stage],
      {
        cwd: fileURLToPath(new URL("../../../", import.meta.url)),
        env: {
          ...environment,
          NERVE_HOME: home,
          NERVE_PORT: "0",
          NERVE_MOBILE_PORT: "0",
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    for (const stream of [this.child.stdout, this.child.stderr])
      stream?.on("data", (data) => {
        this.output = (this.output + String(data)).slice(-12_000);
      });
    this.child.on("message", (message: Message) => {
      this.messages.push(message);
      this.signal();
    });
    this.child.once("exit", () => {
      this.exited = true;
      this.signal();
    });
    this.child.once("error", (error) => {
      this.output += String(error);
      this.exited = true;
      this.signal();
    });
  }
  private signal() {
    for (const wake of this.waiters) wake();
    this.waiters.clear();
  }
  async expect(
    event: Message["event"],
    predicate: (message: Message) => boolean = () => true,
  ): Promise<Message> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const index = this.messages.findIndex(
        (message) => message.event === event && predicate(message),
      );
      if (index >= 0) return this.messages.splice(index, 1)[0]!;
      const failure = this.messages.find(
        (message) => message.event === "error",
      );
      if (failure || this.exited || Date.now() >= deadline)
        throw new Error(
          `Child ${event} failed: ${JSON.stringify({ failure, exited: this.exited, messages: this.messages, output: this.output })}`,
        );
      await new Promise<void>((resolve) => {
        const timer = setTimeout(
          () => {
            this.waiters.delete(wake);
            resolve();
          },
          Math.min(250, deadline - Date.now()),
        );
        const wake = () => {
          clearTimeout(timer);
          resolve();
        };
        this.waiters.add(wake);
      });
    }
  }
  send(command: unknown) {
    this.child.send(command);
  }
  async snapshot(): Promise<Snapshot> {
    this.send({ op: "snapshot" });
    return (await this.expect("snapshot")).state!;
  }
  async until(predicate: (state: Snapshot) => boolean): Promise<Snapshot> {
    const deadline = Date.now() + timeoutMs;
    let state: Snapshot;
    do {
      state = await this.snapshot();
      if (predicate(state)) return state;
      await new Promise((resolve) => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    throw new Error(
      `Recovery did not converge: ${JSON.stringify(state)}\n${this.output}`,
    );
  }
  async kill(): Promise<void> {
    if (this.exited) return;
    this.child.kill("SIGKILL");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`SIGKILL did not reap child: ${this.output}`)),
        timeoutMs,
      );
      this.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.exited = true;
  }
}

for (const stage of [
  "decision",
  "release",
  "lease",
  "claim",
  "effect",
  "result",
  "append",
  "settlement",
] as const) {
  test(
    `SIGKILL after durable approval ${stage} boundary recovers without replaying effects`,
    { skip: process.platform === "win32" && "POSIX SIGKILL required" },
    async (t) => {
      const root = await mkdtemp(
        join(tmpdir(), `nerve-approval-process-${stage}-`),
      );
      const home = join(root, "home");
      const workspace = join(root, "workspace");
      const count = stage === "decision" || stage === "append" ? 2 : 1;
      const children: ProcessHarness[] = [];
      t.after(async () => {
        await Promise.all(children.map((child) => child.kill()));
        await rm(root, { recursive: true, force: true, maxRetries: 5 });
      });
      const setup = new ProcessHarness("setup", home, workspace, count, stage);
      children.push(setup);
      await setup.expect("ready");
      if (stage === "decision" || stage === "append") {
        setup.send({ op: "decide", index: 0, requestId: "request_0" });
        if (stage === "decision")
          await setup.expect("barrier", (message) => message.name === stage);
        else await setup.expect("decided");
      }
      if (stage !== "decision") {
        setup.send({
          op: "decide",
          index: count - 1,
          requestId: `request_${count - 1}`,
        });
        await setup.expect("barrier", (message) => message.name === stage);
      }
      await setup.kill();
      const recovery = new ProcessHarness(
        "recover",
        home,
        workspace,
        count,
        stage,
      );
      children.push(recovery);
      const initial = (await recovery.expect("ready")).state!;
      if (stage === "settlement") {
        assert.equal(
          initial.work.filter((work) => work.kind === "continue_model").length,
          2,
        );
        assert.equal(
          initial.transitions?.filter(
            (kind) => kind === "approval_checkpoint_settled",
          ).length,
          1,
        );
      }
      if (stage === "decision") {
        assert.equal(initial.run, "waiting");
        assert.equal(
          initial.work.filter((work) => work.kind === "execute_tool").length,
          0,
        );
        assert.deepEqual(initial.effects, []);
        // Same request ID must replay the committed decision without adding a second one.
        recovery.send({ op: "decide", index: 0, requestId: "request_0" });
        await recovery.expect("decided");
        const replay = await recovery.snapshot();
        assert.equal(
          replay.interactions?.filter((status) => status === "resolved").length,
          1,
        );
        assert.deepEqual(replay.effects, []);
        return;
      }
      const done =
        stage === "claim" || stage === "effect"
          ? await recovery.until((state) =>
              state.work.some((work) => work.state === "outcome_unknown"),
            )
          : await recovery.until(
              (state) =>
                state.transitions?.includes("approval_checkpoint_settled") ===
                  true && state.results.length === count,
            );
      if (stage === "claim" || stage === "effect") {
        assert.equal(done.tools[0]?.status, "running");
        assert.equal(
          done.work.find((work) => work.kind === "execute_tool")?.failurePhase,
          "post_dispatch",
        );
        assert.equal(
          done.issues.filter((issue) => issue.code === "outcome_unknown")
            .length,
          1,
        );
        assert.equal(done.effects.length, stage === "claim" ? 0 : 1);
        assert.equal(done.results.length, 0);
        assert.equal(done.run, "executing_tools");
        assert.equal(
          done.work.filter((work) => work.kind === "continue_model").length,
          1,
        );
        assert.equal(
          done.transitions?.filter(
            (kind) => kind === "approval_checkpoint_settled",
          ).length,
          0,
        );
      } else {
        assert.equal(done.effects.length, count);
        assert.equal(new Set(done.effects).size, count);
        assert.equal(done.results.length, count);
        assert.equal(new Set(done.results).size, count);
        assert.deepEqual(
          done.results,
          done.tools.map((tool) => tool.id),
        );
        assert.equal(
          done.transitions?.filter(
            (kind) => kind === "approval_checkpoint_settled",
          ).length,
          1,
        );
        assert.equal(
          done.work.filter((work) => work.kind === "execute_tool").length,
          count,
        );
        assert.equal(
          done.issues.filter((issue) => issue.code === "outcome_unknown")
            .length,
          0,
        );
        if (stage === "lease")
          assert.ok(done.work.some((work) => work.generation >= 2));
        if (stage === "settlement")
          assert.equal(
            done.work.filter((work) => work.kind === "continue_model").length,
            2,
          );
      }
    },
  );
}
