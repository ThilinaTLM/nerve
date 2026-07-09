import type { ManagedContainerCreateSpec, VolumeRef } from "@nervekit/shared";

const prohibitedMountFragments = [
  "/var/run/docker.sock",
  "/run/docker.sock",
  "/run/podman/podman.sock",
  "/var/run/podman/podman.sock",
  "/proc/1/root",
];

export type CreateSpecValidationOptions = {
  production?: boolean;
};

export function validateManagedContainerCreateSpec(
  spec: ManagedContainerCreateSpec,
  options: CreateSpecValidationOptions = {},
): string[] {
  const errors: string[] = [];
  for (const mount of spec.mounts) {
    errors.push(...validateMount(mount));
  }
  if (options.production) {
    if (!hasTarget(spec, "/workspace")) errors.push("missing /workspace mount");
    if (!hasTarget(spec, "/state")) errors.push("missing /state mount");
    if (spec.security?.privileged)
      errors.push("privileged containers are not allowed");
    if (spec.security?.readOnlyRootFilesystem !== true) {
      errors.push("read-only root filesystem is required");
    }
    if (spec.security?.noNewPrivileges !== true) {
      errors.push("no-new-privileges is required");
    }
    if (!spec.security?.capDrop?.includes("ALL")) {
      errors.push("capDrop must include ALL");
    }
  }
  return errors;
}

export function assertValidManagedContainerCreateSpec(
  spec: ManagedContainerCreateSpec,
  options: CreateSpecValidationOptions = {},
): void {
  const errors = validateManagedContainerCreateSpec(spec, options);
  if (errors.length > 0) {
    throw new Error(
      `Invalid sandbox container create spec: ${errors.join("; ")}`,
    );
  }
}

function validateMount(mount: VolumeRef): string[] {
  const errors: string[] = [];
  const source = mount.source ?? "";
  if (source === "/") errors.push("host root filesystem must not be mounted");
  for (const fragment of prohibitedMountFragments) {
    if (source.includes(fragment) || mount.target.includes(fragment)) {
      errors.push(`prohibited mount path: ${fragment}`);
    }
  }
  if (mount.target.startsWith("/workspace") && mount.readonly) {
    errors.push("/workspace mount must be writable for the sandbox runtime");
  }
  return errors;
}

function hasTarget(spec: ManagedContainerCreateSpec, target: string): boolean {
  return spec.mounts.some((mount) => mount.target === target);
}
