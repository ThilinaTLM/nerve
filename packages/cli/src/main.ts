#!/usr/bin/env node
import { commandAuth } from "./commands/auth.js";
import { commandCrashes } from "./commands/crashes.js";
import { commandServe } from "./commands/daemon.js";
import { commandLogs } from "./commands/logs.js";
import { commandRun } from "./commands/run.js";
import { commandStatus } from "./commands/status.js";
import { commandUi } from "./commands/ui.js";

function printHelp(): void {
  console.log(`nerve

Usage:
  nerve daemon [--host 127.0.0.1] [--port 3747] [--allow-remote] [--mobile-https] [--https-port 3748]
  nerve serve [--host 127.0.0.1] [--port 3747] [--open] [--allow-remote] [--mobile-https]
  nerve status
  nerve ui [--open]
  nerve logs [--level info] [--source orchestrator] [--limit 100] [--follow]
  nerve crashes [--limit 10] [--follow] [--json]
  nerve run [dir] [prompt...]
  nerve auth list
  nerve auth login <provider>
  nerve auth set-key <provider> [--stdin]
  nerve auth remove <provider>

Environment:
  NERVE_HOME   Override the data directory (default: ~/.nerve)
  NERVE_HOST   Override daemon host
  NERVE_PORT   Override daemon port
  NERVE_ALLOW_REMOTE=1   Allow non-loopback daemon bind addresses
  NERVE_MOBILE_HTTPS=1   Enable opt-in self-signed HTTPS LAN sharing
  NERVE_HTTPS_PORT       Override opt-in mobile HTTPS port
  NERVE_DAEMON_URL     Connect CLI commands to an explicit daemon URL
  NERVE_DAEMON_TOKEN   Bearer token for NERVE_DAEMON_URL or local daemon override
`);
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  while (rawArgs[0] === "--") rawArgs.shift();
  const [command = "ui", ...args] = rawArgs;

  if (command === "daemon") {
    await import("@nervekit/orchestrator/main");
    return;
  }
  if (command === "serve") {
    await commandServe(args);
    return;
  }
  if (command === "status") {
    await commandStatus();
    return;
  }
  if (command === "ui") {
    await commandUi(args);
    return;
  }
  if (command === "logs") {
    await commandLogs(args);
    return;
  }
  if (command === "crashes") {
    await commandCrashes(args);
    return;
  }
  if (command === "run") {
    await commandRun(args);
    return;
  }
  if (command === "auth") {
    await commandAuth(args);
    return;
  }
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  console.error(`unknown command: ${command}`);
  printHelp();
  process.exit(2);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
