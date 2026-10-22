import type { TranscriptionModel } from "$lib/api";

export type TranscriptionModelOption = {
  value: TranscriptionModel;
  label: string;
  detail: string;
};

export const transcriptionModelOptions: TranscriptionModelOption[] = [
  {
    value: "gpt-transcribe",
    label: "GPT Transcribe",
    detail: "Recommended; supports structured language and vocabulary hints.",
  },
  {
    value: "gpt-4o-transcribe",
    label: "GPT-4o Transcribe",
    detail: "Existing high-accuracy compatibility model.",
  },
  {
    value: "gpt-4o-mini-transcribe",
    label: "GPT-4o mini Transcribe",
    detail: "Faster, lower-cost GPT-4o variant.",
  },
];

export function usesStructuredTranscriptionContext(
  model: TranscriptionModel,
): boolean {
  return model === "gpt-transcribe";
}

export function formatSettingLines(values: readonly string[]): string {
  return values.join("\n");
}

type ParsedLines = { values: string[]; error?: undefined } | { error: string };

function nonEmptyLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function unique(values: string[], key: (value: string) => string): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = key(value);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function parseLanguageLines(value: string): ParsedLines {
  const values = unique(
    nonEmptyLines(value).map((language) => language.toLowerCase()),
    (language) => language,
  );
  if (values.length > 10) {
    return { error: "Enter no more than 10 expected languages." };
  }
  const invalid = values.find(
    (language) => !/^[a-z]{2,3}(?:-[a-z]{2})?$/.test(language),
  );
  if (invalid) {
    return {
      error: `“${invalid}” is not an ISO-style language code such as en, yue, or zh-tw.`,
    };
  }
  return { values };
}

export function parseVocabularyLines(value: string): ParsedLines {
  const values = unique(nonEmptyLines(value), (term) => term.toLowerCase());
  if (values.length > 50) {
    return { error: "Enter no more than 50 vocabulary terms." };
  }
  const invalid = values.find(
    (term) => term.length > 100 || /[<>\r\n]/.test(term),
  );
  if (invalid) {
    return {
      error:
        "Vocabulary terms must be 100 characters or fewer and cannot contain < or >.",
    };
  }
  return { values };
}
