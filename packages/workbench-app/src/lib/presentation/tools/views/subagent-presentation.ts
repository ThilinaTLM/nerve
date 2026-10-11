import type { MetaItem } from "../../cards/card-presentation";
import { plural } from "./tool-presentation-helpers";
import type { ToolPresentation } from "./tool-presentation-types";
import type { ToolView } from "./tool-view-types";

/** Header and footer chips of the sub-agent tool cards. */
export function subagentPresentation(
  view: Extract<ToolView, { kind: "subagent" }>,
  base: ToolPresentation,
): ToolPresentation {
  const meta: MetaItem[] = [];
  let primaryArg = base.primaryArg;
  switch (view.action) {
    case "prompt": {
      const created = view.assignments.filter(
        (item) => item.disposition === "created",
      ).length;
      const followUps = view.assignments.filter(
        (item) => item.disposition === "follow_up",
      ).length;
      primaryArg ??=
        view.assignments.length === 1
          ? { text: view.assignments[0].name }
          : view.assignments.length > 1
            ? { text: plural(view.assignments.length, "sub-agent") }
            : undefined;
      if (created > 0) meta.push({ text: `${created} created` });
      if (followUps > 0) meta.push({ text: `${followUps} follow-up` });
      break;
    }
    case "status":
      primaryArg ??= { text: view.name ?? "all sub-agents" };
      if (!view.name && view.rows.length > 0)
        meta.push({ text: plural(view.rows.length, "sub-agent") });
      break;
    case "stop":
      primaryArg ??=
        view.names.length > 0 ? { text: view.names.join(", ") } : undefined;
      break;
  }
  return { ...base, primaryArg, meta };
}
