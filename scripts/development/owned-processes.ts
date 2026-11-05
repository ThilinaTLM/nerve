import { spawn, type ChildProcess } from "node:child_process";

export type OwnedCommand = [command: string, args: string[], cwd?: string];

export interface OwnedOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  shell?: boolean;
}

// Own only the children started here. In particular, a discovered daemon is
// never part of this set and cannot be stopped by this launcher.
export async function runOwned(
  commands: OwnedCommand[],
  { cwd, env, shell = false }: OwnedOptions,
): Promise<void> {
  const children = new Set<ChildProcess>();
  let failure: Error | undefined;
  let stopping = false;
  let escalation: NodeJS.Timeout | undefined;
  const stop = (signal: NodeJS.Signals = "SIGTERM") => {
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
          new Promise<void>((done) => {
            const child = spawn(command, args, {
              cwd: childCwd,
              env,
              stdio: "inherit",
              shell,
            });
            children.add(child);
            let finished = false;
            const finish = (error?: Error) => {
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

export function runCommand(
  command: string,
  args: string[],
  options: OwnedOptions,
): Promise<void> {
  // Windows package-manager entrypoints are .cmd scripts. Only our fixed pnpm
  // build/preparation commands use the shell; long-running Node owners do not.
  return runOwned([[command, args]], {
    ...options,
    shell: process.platform === "win32" && command === "pnpm",
  });
}
