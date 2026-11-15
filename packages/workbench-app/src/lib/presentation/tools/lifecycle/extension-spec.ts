import type { ExtensionToolView } from "@nervekit/contracts/extensions";
import {
  relativePathForDisplay,
  resolveDisplayPath,
} from "@nervekit/ui-kit/display/path-links";
import type { PrimaryArg } from "../../cards/card-presentation";
import type { ToolArgumentSource } from "./argument-source";
import {
  argumentPresentation,
  type ExtensionToolLifecycleSpec,
} from "./tool-lifecycle-contracts";

const MAX_SECONDARY = 3;

function headerArg(
  source: ToolArgumentSource,
  header: NonNullable<ExtensionToolView["header"]>,
  cwd?: string,
): PrimaryArg | undefined {
  const value = source.string(header.argument);
  if (!value) return undefined;
  if (header.format !== "path") return { text: value };
  return {
    text: (cwd && relativePathForDisplay(value, cwd)) || value,
    openPath: cwd ? resolveDisplayPath(value, cwd) : value,
  };
}

/**
 * The spec of an extension's direct tool, from the view it declares: the
 * header argument (else the first argument) and its facts (else the next
 * three arguments); approval lists every argument.
 */
function specFor(
  view: ExtensionToolView | undefined,
): ExtensionToolLifecycleSpec {
  return {
    name: "extension",
    argumentRegion: "none",
    completedView: "extension",
    resultPlaceholder: { variant: "text", rows: 3 },
    emptyResult: "No output",
    present: (source, stage, cwd) => {
      const entries = source
        .structuredEntries()
        .filter((entry) => !entry.redacted && entry.value !== "[unavailable]");
      const named = (key: string) => entries.find((entry) => entry.key === key);
      const [first, ...rest] = entries;
      const primaryArg = view?.header
        ? headerArg(source, view.header, cwd)
        : first
          ? { text: first.value }
          : undefined;
      const facts =
        view?.header || view?.meta
          ? (view.meta ?? []).flatMap((key) => named(key) ?? [])
          : rest.slice(0, MAX_SECONDARY);
      return argumentPresentation({
        primaryArg,
        secondary: facts.map((entry) => ({
          text: `${entry.key} ${entry.value}`,
        })),
        body:
          stage === "approval" && entries.length > 0
            ? {
                kind: "key-values",
                items: entries.map((entry) => ({
                  label: entry.key,
                  value: entry.value,
                })),
              }
            : undefined,
        safetyNotes: [
          "Runs an extension tool; its arguments are sent to the service the extension uses.",
        ],
      });
    },
  };
}

const generic = specFor(undefined);
const specs = new WeakMap<ExtensionToolView, ExtensionToolLifecycleSpec>();

/** The lifecycle spec of an extension tool with this view (the generic one without). */
export function extensionToolLifecycleSpec(
  view: ExtensionToolView | undefined,
): ExtensionToolLifecycleSpec {
  if (!view) return generic;
  let spec = specs.get(view);
  if (!spec) {
    spec = specFor(view);
    specs.set(view, spec);
  }
  return spec;
}
