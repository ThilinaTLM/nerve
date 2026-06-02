export function hasShellControlOperator(command: string): boolean {
  return (
    /[><|`$();]/.test(command) ||
    command.includes("&&") ||
    command.includes("||")
  );
}

export function isKnownReadOnlyCommand(command: string): boolean {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (!normalized || hasShellControlOperator(normalized)) return false;
  const first = normalized.split(" ")[0];
  if (["pwd", "ls", "find", "rg", "grep", "which", "cat"].includes(first))
    return true;
  if (normalized === "git status" || normalized.startsWith("git status "))
    return true;
  if (normalized === "git diff" || normalized.startsWith("git diff "))
    return true;
  if (normalized === "git log" || normalized.startsWith("git log "))
    return true;
  if (normalized === "git show" || normalized.startsWith("git show "))
    return true;
  return false;
}

export function hasDangerousCommandPattern(command: string): boolean {
  return /(^|\s)(rm\s+-rf|sudo|mkfs|dd\s+if=|chmod\s+-R|chown\s+-R|git\s+reset\s+--hard|git\s+clean\s+-fd|docker\s+system\s+prune|kubectl\s+delete)(\s|$)/.test(
    command,
  );
}

export function isLikelyLongRunningCommand(command: string): boolean {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (!normalized) return false;
  return (
    /(^|\s)(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|preview|watch)(\s|$)/.test(
      normalized,
    ) ||
    /(^|\s)(vite|next\s+dev|svelte-kit\s+dev|astro\s+dev|webpack\s+serve|nodemon|tsx\s+watch|tsc\s+--watch|cargo\s+watch)(\s|$)/.test(
      normalized,
    )
  );
}
