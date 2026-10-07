import { spawn } from "node:child_process";

// Own only the children started here. In particular, a discovered daemon is
// never part of this set and cannot be stopped by this launcher.
export async function runOwned(commands, { cwd, env, shell = false }) {
  const children = new Set();
  let failure;
  let stopping = false;
  let escalation;
  const stop = (signal = "SIGTERM") => {
    if (stopping) return;
    stopping = true;
    for (const child of children) child.kill(signal);
    escalation = setTimeout(() => {
      for (const child of children) child.kill("SIGKILL");
    }, 5000);
    escalation.unref();
  };
  const interrupt = () => {
    failure ??= new Error("Development launch interrupted.");
    stop("SIGINT");
  };
  const terminate = () => {
    failure ??= new Error("Development launch terminated.");
    stop();
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    await Promise.all(
      commands.map(
        ([command, args, childCwd = cwd]) =>
          new Promise((done) => {
            const child = spawn(command, args, {
              cwd: childCwd,
              env,
              stdio: "inherit",
              shell,
            });
            children.add(child);
            let finished = false;
            const finish = (error) => {
              if (finished) return;
              finished = true;
              children.delete(child);
              failure ??= error;
              stop();
              done();
            };
            child.once("error", (cause) =>
              finish(new Error(`Could not launch ${command}.`, { cause })),
            );
            child.once("exit", (code, signal) =>
              finish(
                !stopping && code !== 0
                  ? new Error(
                      `${command} ${signal ? `stopped by ${signal}` : `exited with code ${code}`}.`,
                    )
                  : undefined,
              ),
            );
          }),
      ),
    );
    if (failure) throw failure;
  } finally {
    clearTimeout(escalation);
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
}

export function runCommand(command, args, options) {
  // Windows package-manager entrypoints are .cmd scripts. Only our fixed pnpm
  // build/preparation commands use the shell; long-running Node owners do not.
  return runOwned([[command, args]], {
    ...options,
    shell: process.platform === "win32" && command === "pnpm",
  });
}
