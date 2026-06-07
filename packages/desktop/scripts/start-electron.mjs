import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import electronPath from "electron";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const electronArgs =
  process.platform === "linux" ? ["--class=nerve", "."] : ["."];

const child = spawn(electronPath, electronArgs, {
  cwd,
  env,
  stdio: "inherit",
  windowsHide: false,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
