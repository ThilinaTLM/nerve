import type {
  ManagedContainerCreateSpec,
  VolumeRef,
} from "@nervekit/contracts";

export function containerCreateArgs(
  spec: ManagedContainerCreateSpec,
): string[] {
  const args = [
    "create",
    "--name",
    containerName(spec),
    "--hostname",
    spec.instanceId,
  ];
  for (const [key, value] of Object.entries(spec.labels))
    args.push("--label", `${key}=${value}`);
  for (const [key, value] of Object.entries(spec.env))
    args.push("--env", `${key}=${value}`);
  for (const mount of spec.mounts) args.push(...mountArgs(mount));
  if (spec.workingDir) args.push("--workdir", spec.workingDir);
  if (spec.user) args.push("--user", spec.user);
  if (spec.network?.mode) args.push("--network", spec.network.mode);
  for (const port of spec.network?.ports ?? [])
    args.push(
      "--publish",
      `${port.hostPort ?? 0}:${port.containerPort}/${port.protocol ?? "tcp"}`,
    );
  if (spec.security?.readOnlyRootFilesystem) args.push("--read-only");
  if (spec.security?.noNewPrivileges)
    args.push("--security-opt", "no-new-privileges");
  for (const cap of spec.security?.capDrop ?? []) args.push("--cap-drop", cap);
  for (const cap of spec.security?.capAdd ?? []) args.push("--cap-add", cap);
  if (spec.security?.pidsLimit)
    args.push("--pids-limit", String(spec.security.pidsLimit));
  if (spec.resources?.memoryMb)
    args.push("--memory", `${spec.resources.memoryMb}m`);
  if (spec.resources?.vcpu) args.push("--cpus", String(spec.resources.vcpu));
  if (spec.healthcheck?.command)
    args.push("--health-cmd", spec.healthcheck.command.join(" "));
  if (spec.healthcheck?.intervalMs)
    args.push("--health-interval", `${spec.healthcheck.intervalMs}ms`);
  if (spec.healthcheck?.timeoutMs)
    args.push("--health-timeout", `${spec.healthcheck.timeoutMs}ms`);
  if (spec.healthcheck?.retries !== undefined)
    args.push("--health-retries", String(spec.healthcheck.retries));
  args.push(spec.image, ...(spec.command ?? []));
  return args;
}
export function containerName(
  spec: Pick<ManagedContainerCreateSpec, "sandboxId" | "instanceId">,
): string {
  return `nerve-${safe(spec.sandboxId)}-${safe(spec.instanceId)}`;
}
function safe(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 96);
}
function mountArgs(mount: VolumeRef): string[] {
  if (mount.kind === "tmpfs") return ["--tmpfs", mount.target];
  const type = mount.kind === "volume" ? "volume" : "bind";
  const source = mount.source ?? mount.name;
  const flags = [
    `type=${type}`,
    source ? `src=${source}` : undefined,
    `dst=${mount.target}`,
    mount.readonly ? "readonly" : undefined,
  ]
    .filter(Boolean)
    .join(",");
  return ["--mount", flags];
}
