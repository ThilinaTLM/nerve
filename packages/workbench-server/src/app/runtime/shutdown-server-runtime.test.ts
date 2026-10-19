import assert from "node:assert/strict";
import { test } from "node:test";
import { shutdownRuntimeResources } from "./shutdown-runtime-resources.js";
import {
  shutdownServerRuntime,
  type ServerShutdownResources,
} from "./shutdown-server-runtime.js";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

void test("actual server shutdown finalizes Activity and every outer resource after rejected ordered drains", async () => {
  const order: string[] = [];
  const maintenanceFailure = new Error("maintenance");
  const gitFailure = new Error("git");
  const completionFailure = new Error("completion");
  const activityFailure = new Error("activity");
  const skillsFailure = new Error("skills");
  const usageFailure = new Error("usage");
  const loggerFailure = new Error("logger");
  let rejectMaintenance!: (error: Error) => void;
  let rejectGit!: (error: Error) => void;
  let rejectCompletion!: (error: Error) => void;
  const maintenance = new Promise<void>((_resolve, reject) => {
    rejectMaintenance = reject;
  });
  const git = new Promise<void>((_resolve, reject) => {
    rejectGit = reject;
  });
  const completion = new Promise<void>((_resolve, reject) => {
    rejectCompletion = reject;
  });
  const state: ServerShutdownResources = {
    maintenance: {
      shutdown: async () => {
        order.push("maintenance");
        await maintenance;
      },
    },
    lifecycle: {
      shutdown: () =>
        shutdownRuntimeResources({
          gitOperations: {
            close: async () => {
              order.push("git");
              await git;
            },
          },
          completions: {
            dispose: async () => {
              order.push("completion");
              await completion;
            },
          },
          workspaceMonitor: {
            close: async () => {
              order.push("monitor");
            },
          },
          launches: {
            shutdown: async () => {
              order.push("launches");
            },
          },
          conversationCore: {
            close: async () => {
              order.push("core");
            },
          },
        }),
    },
    activities: {
      dispose: () => {
        order.push("activity");
        throw activityFailure;
      },
    },
    agentBrowserSkills: {
      shutdown: async () => {
        order.push("skills");
        throw skillsFailure;
      },
    },
    subscriptionUsage: {
      stop: () => {
        order.push("usage");
        throw usageFailure;
      },
    },
    logger: {
      flush: async () => {
        order.push("logger");
        throw loggerFailure;
      },
    },
  };
  const closing = shutdownServerRuntime(state);
  assert.equal(shutdownServerRuntime(state), closing);
  const outcome = closing.catch((error: unknown) => error);
  await tick();
  assert.deepEqual(order, ["maintenance"]);
  rejectMaintenance(maintenanceFailure);
  await tick();
  assert.deepEqual(order, ["maintenance", "git"]);
  rejectGit(gitFailure);
  await tick();
  assert.deepEqual(order, ["maintenance", "git", "completion"]);
  rejectCompletion(completionFailure);
  const error = await outcome;
  assert.ok(error instanceof AggregateError);
  assert.equal(error.errors[0], maintenanceFailure);
  assert.ok(error.errors[1] instanceof AggregateError);
  assert.deepEqual(error.errors[1].errors, [gitFailure, completionFailure]);
  assert.deepEqual(error.errors.slice(2), [
    activityFailure,
    skillsFailure,
    usageFailure,
    loggerFailure,
  ]);
  assert.deepEqual(order, [
    "maintenance",
    "git",
    "completion",
    "monitor",
    "launches",
    "core",
    "activity",
    "skills",
    "usage",
    "logger",
  ]);
  assert.equal(shutdownServerRuntime(state), closing);
});

void test("successful server cleanup is idempotent and returns the same drain promise", async () => {
  const order: string[] = [];
  const state: ServerShutdownResources = {
    maintenance: {
      shutdown: async () => {
        order.push("maintenance");
      },
    },
    lifecycle: {
      shutdown: async () => {
        order.push("lifecycle");
      },
    },
    activities: {
      dispose: () => {
        order.push("activity");
      },
    },
    agentBrowserSkills: {
      shutdown: async () => {
        order.push("skills");
      },
    },
    subscriptionUsage: {
      stop: () => {
        order.push("usage");
      },
    },
    logger: {
      flush: async () => {
        order.push("logger");
      },
    },
  };
  const closing = shutdownServerRuntime(state);
  await closing;
  assert.equal(shutdownServerRuntime(state), closing);
  assert.deepEqual(order, [
    "maintenance",
    "lifecycle",
    "activity",
    "skills",
    "usage",
    "logger",
  ]);
});
