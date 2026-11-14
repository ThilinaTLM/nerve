import {
  argumentPresentation,
  type ExtensionToolLifecycleSpec,
} from "./tool-lifecycle-contracts";

const MAX_SECONDARY = 3;

/** What every extension direct tool shows: its first argument as the header, the rest as small facts. */
export const extensionToolLifecycleSpec: ExtensionToolLifecycleSpec = {
  name: "extension",
  argumentRegion: "none",
  completedView: "extension",
  resultPlaceholder: { variant: "text", rows: 3 },
  emptyResult: "No output",
  present: (source, stage) => {
    const entries = source
      .structuredEntries()
      .filter((entry) => !entry.redacted && entry.value !== "[unavailable]");
    const [primary, ...rest] = entries;
    return argumentPresentation({
      primaryArg: primary ? { text: primary.value } : undefined,
      secondary: rest
        .slice(0, MAX_SECONDARY)
        .map((entry) => ({ text: `${entry.key} ${entry.value}` })),
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
