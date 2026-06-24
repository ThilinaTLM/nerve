export function stripEnvVarAssignments(tokens: string[]): string[] {
  let index = 0;
  while (
    index < tokens.length &&
    /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] ?? "")
  ) {
    index++;
  }
  return tokens.slice(index);
}

export function normalizeCommandName(command: string): string {
  return (command.split("/").pop() ?? command).trim();
}

function stripLeadingOptions(tokens: string[]): string[] {
  let index = 0;
  while (tokens[index]?.startsWith("-")) index++;
  return tokens.slice(index);
}

const WRAPPER_ROOT_COMMANDS = new Set([
  "command",
  "env",
  "nice",
  "nohup",
  "time",
  "timeout",
]);

export function unwrapCommandTokens(tokens: string[]): string[] {
  let current = tokens;

  for (let depth = 0; depth < 5; depth++) {
    const rootCommand = normalizeCommandName(current[0] ?? "");
    if (!WRAPPER_ROOT_COMMANDS.has(rootCommand)) break;

    if (rootCommand === "env") {
      let index = 1;
      while (index < current.length) {
        const token = current[index];
        if (token === "-u" || token === "--unset" || token === "-S") {
          index += 2;
          continue;
        }
        if (token.startsWith("-")) {
          index++;
          continue;
        }
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
          index++;
          continue;
        }
        break;
      }
      current = current.slice(index);
      continue;
    }

    if (rootCommand === "timeout") {
      const withoutOptions = stripLeadingOptions(current.slice(1));
      current = withoutOptions.slice(1);
      continue;
    }

    if (rootCommand === "nice") {
      let index = 1;
      if (current[index] === "-n") index += 2;
      else if (current[index]?.startsWith("-n")) index++;
      while (current[index]?.startsWith("-")) index++;
      current = current.slice(index);
      continue;
    }

    current = stripLeadingOptions(current.slice(1));
  }

  return current;
}

export function getXargsInvokedCommandIndex(
  tokens: string[],
): number | undefined {
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (
      token === "-E" ||
      token === "-I" ||
      token === "-L" ||
      token === "-P" ||
      token === "-d" ||
      token === "-n" ||
      token === "-s"
    ) {
      i++;
      continue;
    }
    if (token.startsWith("-")) continue;
    return i;
  }
  return undefined;
}

export function hasAnyToken(tokens: string[], blocked: Set<string>): boolean {
  return tokens.some((token) => blocked.has(token));
}
