<script lang="ts">
import type { Settings, TranscriptionModel } from "$lib/api";
import {
  SettingsInlineMessage,
  SettingsRow,
  SettingsSection,
} from "$lib/presentation/components/settings";
import SelectField from "@nervekit/ui-kit/components/ui/select-field";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import type { SettingsChange } from "../settings-change";
import {
  formatSettingLines,
  parseLanguageLines,
  parseVocabularyLines,
  transcriptionModelOptions,
  usesStructuredTranscriptionContext,
} from "./transcription-settings";

type Props = {
  settingsDraft: Settings;
  onSettingsChange?: SettingsChange;
};

let { settingsDraft, onSettingsChange }: Props = $props();

function initialLanguageText(): string {
  return formatSettingLines(settingsDraft.transcription.languages);
}

function initialVocabularyText(): string {
  return formatSettingLines(settingsDraft.transcription.vocabulary);
}

let languageText = $state(initialLanguageText());
let vocabularyText = $state(initialVocabularyText());
let languageError = $state<string>();
let vocabularyError = $state<string>();

const languagePlaceholder = "en\nfr\nzh-tw";
const vocabularyPlaceholder = "Nerve\nCodex CLI\nSvelte";

const usesStructuredContext = $derived(
  usesStructuredTranscriptionContext(settingsDraft.transcription.model),
);

function sameValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function setModel(value: string): void {
  const model = value as TranscriptionModel;
  settingsDraft.transcription.model = model;
  onSettingsChange?.({ transcription: { model } }, { immediate: true });
}

function saveLanguages(): void {
  const parsed = parseLanguageLines(languageText);
  if (!("values" in parsed)) {
    languageError = parsed.error;
    return;
  }
  languageError = undefined;
  languageText = formatSettingLines(parsed.values);
  if (sameValues(settingsDraft.transcription.languages, parsed.values)) return;
  settingsDraft.transcription.languages = parsed.values;
  onSettingsChange?.({ transcription: { languages: parsed.values } });
}

function saveVocabulary(): void {
  const parsed = parseVocabularyLines(vocabularyText);
  if (!("values" in parsed)) {
    vocabularyError = parsed.error;
    return;
  }
  vocabularyError = undefined;
  vocabularyText = formatSettingLines(parsed.values);
  if (sameValues(settingsDraft.transcription.vocabulary, parsed.values)) return;
  settingsDraft.transcription.vocabulary = parsed.values;
  onSettingsChange?.({ transcription: { vocabulary: parsed.values } });
}
</script>

<SettingsSection
  id="model"
  title="Model"
  description="Choose the OpenAI speech-to-text model used for voice input."
>
  <SettingsInlineMessage tone="info" class="border-primary/40 bg-primary/10">
    OpenAI Codex OAuth remains the transcription provider. Nerve uses ChatGPT's
    subscription endpoint, so model availability depends on the connected
    account.
  </SettingsInlineMessage>
  <SettingsRow
    label="Transcription model"
    description="GPT Transcribe is OpenAI's recommended model; GPT-4o Transcribe remains the compatibility default."
    layout="responsive"
  >
    {#snippet control()}
      <SelectField
        items={transcriptionModelOptions}
        value={settingsDraft.transcription.model}
        ariaLabel="Transcription model"
        class="w-full max-w-full sm:w-64"
        onValueChange={setModel}
      />
    {/snippet}
  </SettingsRow>
</SettingsSection>

<SettingsSection
  id="context"
  title="Context"
  description={usesStructuredContext
    ? "GPT Transcribe receives structured language and vocabulary hints."
    : "GPT-4o transcription models receive these hints as prompt context."}
>
  <SettingsRow
    label="Expected languages"
    description={usesStructuredContext
      ? "Enter one ISO language code per line. All codes are sent as language hints, which supports multilingual audio and code-switching."
      : "Enter one ISO language code per line. These codes are included in prompt context because this model does not support structured language hints."}
    htmlFor="transcription-languages"
    layout="stacked"
  >
    <Textarea
      id="transcription-languages"
      aria-label="Expected transcription languages"
      aria-invalid={languageError ? "true" : undefined}
      placeholder={languagePlaceholder}
      class="min-h-24"
      bind:value={languageText}
      oninput={() => (languageError = undefined)}
      onblur={saveLanguages}
    />
    {#if languageError}
      <SettingsInlineMessage tone="error" text={languageError} />
    {/if}
  </SettingsRow>

  <SettingsRow
    label="Custom vocabulary"
    description={usesStructuredContext
      ? "Enter one name, acronym, or preferred spelling per line. OpenAI treats these as keyword hints, not required output."
      : "Enter one name, acronym, or preferred spelling per line. Nerve adds these terms to the model prompt as preferred spellings."}
    htmlFor="transcription-vocabulary"
    layout="stacked"
  >
    <Textarea
      id="transcription-vocabulary"
      aria-label="Custom transcription vocabulary"
      aria-invalid={vocabularyError ? "true" : undefined}
      placeholder={vocabularyPlaceholder}
      class="min-h-28"
      bind:value={vocabularyText}
      oninput={() => (vocabularyError = undefined)}
      onblur={saveVocabulary}
    />
    {#if vocabularyError}
      <SettingsInlineMessage tone="error" text={vocabularyError} />
    {/if}
    <p class="text-xs text-muted-foreground">
      Include only terms relevant to your dictation. Strong hints can bias the
      transcript toward words that were not spoken.
    </p>
  </SettingsRow>
</SettingsSection>
