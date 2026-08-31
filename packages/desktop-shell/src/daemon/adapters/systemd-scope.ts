let daemonScopeCounter = 0;

export interface DaemonLaunchCommand {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  systemdUnit?: string;
}

export function resolveDaemonLaunch(input: {
  serverMain: string;
  args?: string[];
  env: NodeJS.ProcessEnv;
}): DaemonLaunchCommand {
  const daemonArgs = [input.serverMain, ...(input.args ?? [])];
  if (
    process.platform !== "linux" ||
    input.env.NERVE_ALLOW_UNCONTAINED_PROCESSES === "1" ||
    input.env.NERVE_CGROUP_ROOT
  ) {
    return { command: process.execPath, args: daemonArgs, env: input.env };
  }
  daemonScopeCounter += 1;
  const systemdUnit = `nerve-daemon-${process.pid}-${daemonScopeCounter}.scope`;
  return {
    command: "systemd-run",
    args: [
      "--user",
      "--scope",
      "--quiet",
      "--collect",
      `--unit=${systemdUnit}`,
      "--property=Delegate=yes",
      "--",
      process.execPath,
      ...daemonArgs,
    ],
    env: { ...input.env, NERVE_LINUX_DELEGATED_CGROUP: "1" },
    systemdUnit,
  };
}

export function systemdStopCommand(unit: string): {
  command: string;
  args: string[];
} {
  return { command: "systemctl", args: ["--user", "stop", unit] };
}
