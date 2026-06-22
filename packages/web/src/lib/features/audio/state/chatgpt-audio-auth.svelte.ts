import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { hasChatGptAudioAuth } from "./chatgpt-audio-auth";

export {
  CHATGPT_AUDIO_PROVIDER,
  hasChatGptAudioAuth,
} from "./chatgpt-audio-auth";

export const chatGptAudioAuth = {
  get configured(): boolean {
    return hasChatGptAudioAuth(settingsState.authProviders);
  },
};
