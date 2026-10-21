import type { Legacy } from "./legacy.reader.js";

/** Historical calls only; never executable work. Ambiguous selectors stay generic. */
export function mapProcessCall(
  name: string,
  args: Legacy,
  linked?: Legacy,
): { name: string; args: Legacy; generic: boolean } {
  if (name === "bash") {
    const rest = { ...args };
    delete rest.timeout;
    return { name, args: rest, generic: false };
  }
  const generic = { name, args, generic: name.startsWith("task_") };
  if (
    Object.keys(args).some((key) =>
      ["name", "mode", "cursor", "since", "taskName"].includes(key),
    )
  )
    return generic;
  if (
    name === "task_start" &&
    linked &&
    Object.keys(args).every((key) => ["command", "cwd"].includes(key)) &&
    typeof (args.command ?? linked.command) === "string"
  )
    return {
      name: "bash",
      args: {
        command: args.command ?? linked.command,
        ...(args.cwd ? { cwd: args.cwd } : {}),
        background: true,
      },
      generic: false,
    };
  if (name === "task_status" && Object.keys(args).length === 0)
    return { name: "async_bash", args: { action: "list" }, generic: false };
  const id = args.id ?? args.taskId ?? args.bashId ?? args.task;
  if (typeof id !== "string" || !/^(?:task_|bash_)/.test(id)) return generic;
  if (
    name === "task_logs" &&
    Object.keys(args).every((key) =>
      ["id", "taskId", "bashId", "task"].includes(key),
    )
  )
    return {
      name: "async_bash",
      args: { action: "logs", id: linked?.id ?? id },
      generic: false,
    };
  if (
    name === "task_control" &&
    args.action === "stop" &&
    Object.keys(args).every((key) =>
      ["id", "taskId", "bashId", "task", "action"].includes(key),
    )
  )
    return {
      name: "async_bash",
      args: { action: "stop", id: linked?.id ?? id },
      generic: false,
    };
  return generic;
}

/** Restrict grants to one action; ambiguous grants require consultation (prompt). */
export function convertPermissionRules(
  document: Legacy,
  report: (message: string) => void = console.warn,
): boolean {
  let changed = false;
  const ask = (rule: Legacy, names: string[], groups: string[]): Legacy[] => {
    const oldArguments: Legacy[] = rule.when.arguments ?? [];
    // "Ask" is represented by "prompt" in the frozen permission schema.
    rule.decision = "prompt";
    rule.when = {
      ...(names.length
        ? {
            toolNames: [
              ...new Set(
                names.map((name) =>
                  name === "task_start"
                    ? "bash"
                    : name.startsWith("task_")
                      ? "async_bash"
                      : name,
                ),
              ),
            ],
          }
        : {}),
      ...(!names.length && groups.length
        ? {
            toolGroups: groups.map((group) =>
              group === "taskManagement" ? "process" : group,
            ),
          }
        : {}),
    };
    if (names.length === 1) {
      const name = names[0];
      const stop = oldArguments.some(
        (argument) =>
          argument.path === "args.action" &&
          argument.operator === "equals" &&
          argument.value === "stop",
      );
      const action =
        name === "task_status"
          ? "list"
          : name === "task_logs"
            ? "logs"
            : name === "task_control" && stop
              ? "stop"
              : undefined;
      if (name === "task_start" || action)
        rule.when.arguments = [
          {
            path: name === "task_start" ? "args.background" : "args.action",
            operator: "equals",
            value: name === "task_start" ? true : action,
          },
        ];
    }
    report(
      `Historical process permission rule ${rule.id} converted to ask: cannot preserve its grant scope exactly`,
    );
    return [rule];
  };
  const visit = (value: Legacy): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (Array.isArray(value.rules))
      value.rules = value.rules.flatMap((rule: Legacy) => {
        const when = rule.when;
        if (!when) return [rule];
        const names: string[] = when.toolNames ?? [];
        const groups: string[] = when.toolGroups ?? [];
        if (
          !names.some((name) => name.startsWith("task_")) &&
          !groups.includes("taskManagement")
        )
          return [rule];
        changed = true;
        if (rule.decision !== "allow") {
          if (names.length)
            when.toolNames = names.map((name) =>
              name === "task_start"
                ? "bash"
                : name.startsWith("task_")
                  ? "async_bash"
                  : name,
            );
          if (groups.length)
            when.toolGroups = groups.map((group) =>
              group === "taskManagement" ? "process" : group,
            );
          // Old risk/kind/target classifiers and argument layouts need not match
          // the new tools. Retain the restriction conservatively, not a grant.
          delete when.arguments;
          delete when.primaryArgument;
          delete when.toolKinds;
          delete when.baseRisks;
          delete when.primaryTarget;
          delete when.targets;
          if (names.length) delete when.toolGroups;
          return [rule];
        }
        const stopOnly =
          names[0] === "task_control" &&
          when.arguments?.length === 1 &&
          when.arguments[0].path === "args.action" &&
          when.arguments[0].operator === "equals" &&
          when.arguments[0].value === "stop";
        // Groups include newly introduced launches. Never widen a historical grant.
        if (
          groups.includes("taskManagement") ||
          names.length !== 1 ||
          (when.arguments && !stopOnly) ||
          when.primaryArgument ||
          when.primaryTarget ||
          when.targets ||
          !["task_status", "task_logs", "task_control", "task_start"].includes(
            names[0],
          )
        ) {
          return ask(rule, names, groups);
        }
        const name = names[0];
        // Control also included restart; an unconstrained grant cannot be retained exactly.
        if (name === "task_control" && !stopOnly) {
          return ask(rule, names, groups);
        }
        when.toolNames = [name === "task_start" ? "bash" : "async_bash"];
        when.arguments = [
          {
            path: name === "task_start" ? "args.background" : "args.action",
            operator: "equals",
            value:
              name === "task_start"
                ? true
                : name === "task_status"
                  ? "list"
                  : name === "task_control"
                    ? "stop"
                    : "logs",
          },
        ];
        return [rule];
      });
    Object.values(value).forEach((child) => {
      if (child && typeof child === "object") visit(child as Legacy);
    });
  };
  visit(document);
  return changed;
}
