import { spawn } from "node:child_process";

export async function runCommand(
  command: string,
  args: string[],
  timeoutMs = 2_000,
  env?: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: env ? { ...process.env, ...env } : process.env,
      });
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = "";
    let stderr = "";
    const append = (current: string, chunk: Buffer) =>
      `${current}${String(chunk)}`.slice(-256 * 1024);
    child.stdout?.on(
      "data",
      (chunk: Buffer) => (stdout = append(stdout, chunk)),
    );
    child.stderr?.on(
      "data",
      (chunk: Buffer) => (stderr = append(stderr, chunk)),
    );
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}
