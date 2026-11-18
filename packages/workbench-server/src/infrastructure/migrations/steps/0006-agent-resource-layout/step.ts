import { existsSync, readdirSync, readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { defineStep, type StepContext } from "../../framework/step.js";

/**
 * User agent profiles move from `data/agent-profiles/` to `agent/agent-profiles/`, the one
 * place every authored user resource lives (docs/architecture/storage.md, "Home layout").
 * `data/` is Nerve-owned state; authored resources do not belong there.
 *
 * The trust table rebuild that belongs to the same release (`trusted_resource` v3) is a core SQL
 * migration (`schema-v4.ts` in conversation-core), applied when the core opens the database.
 *
 * Merge-safe: a profile that already exists in the target, whatever its content, wins. The
 * source of a different one is quarantined and reported; an identical one is simply removed.
 */

/** The legacy and the new location of user profiles. */
function locations(context: StepContext) {
  return {
    legacy: context.paths.agentProfilesConfigPath,
    target: context.paths.agentProfilesPath,
  };
}

function sameBytes(a: string, b: string): boolean {
  const left = lstatSync(a);
  const right = lstatSync(b);
  return (
    left.isFile() &&
    right.isFile() &&
    left.size === right.size &&
    readFileSync(a).equals(readFileSync(b))
  );
}

function pending(context: StepContext): string[] {
  const { legacy } = locations(context);
  return existsSync(legacy) ? readdirSync(legacy).sort() : [];
}

export default defineStep({
  id: "0006-agent-resource-layout",
  description: "Move user agent profiles to the agent folder",
  async run(context) {
    const { legacy, target } = locations(context);
    const names = pending(context);
    context.progress("run", 0, names.length, "Moving agent profiles");
    let done = 0;
    for (const name of names) {
      const source = join(legacy, name);
      const destination = join(target, name);
      await context.unit(
        { kind: "configuration", id: source },
        () => {
          if (!existsSync(destination)) {
            context.fs.mkdir(target);
            context.fs.move(source, destination);
          } else if (sameBytes(source, destination)) context.fs.remove(source);
          else {
            context.quarantine(
              {
                kind: "configuration",
                id: source,
                reason: `agent/agent-profiles already has ${name}; kept it and set this older copy aside`,
              },
              { files: [source] },
            );
            context.loss(
              "A user agent profile with the same name already existed in agent/agent-profiles; the existing one was kept",
            );
          }
        },
        { quarantine: { files: [source] } },
      );
      context.progress("run", ++done, names.length);
    }
    if (existsSync(legacy) && readdirSync(legacy).length === 0)
      context.fs.remove(legacy);
  },
  async verify(context) {
    const { legacy } = locations(context);
    const left = pending(context).filter(
      (name) => !context.discarded.has(join(legacy, name)),
    );
    if (left.length)
      throw new Error(
        `${left.length} agent profiles remain in data/agent-profiles`,
      );
  },
});
