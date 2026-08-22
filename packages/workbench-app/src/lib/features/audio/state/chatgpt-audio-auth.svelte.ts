import { settingsReadModel } from "$lib/application/preferences/settings-read-model.svelte";
import { hasChatGptAudioAuth } from "./chatgpt-audio-auth";

export {
  CHATGPT_AUDIO_PROVIDER,
  hasChatGptAudioAuth,
} from "./chatgpt-audio-auth";

export const chatGptAudioAuth = {
  get configured(): boolean {
    return hasChatGptAudioAuth(settingsReadModel.authProviders);
  },
};
