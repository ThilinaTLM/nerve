# Settings: conversation titles

A new **Titles** page in **user settings**, in the App group after Voice (`TextCursorInput` icon). It's a user-level setting only, with no project override, like Voice/transcription. It follows the Voice page layout and uses only the existing settings primitives (`SettingsSection`, `SettingsRow`, `SettingsToggleRow`, `SettingsInlineMessage`) with auto-save. Wireframe: `/dev/wireframes/conversation-title-settings`.

Page description: "Name new conversations with a small AI model."

## Section "AI titles"

The section info tooltip says: "New conversations always get an instant local title first. An AI title replaces it in the background, once, and never overrides a name you set."

| Control                                                                                          | Behavior                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Disclosure** (`SettingsInlineMessage`, info, same treatment as the Voice page's provider note) | "Sends a shortened version of each new conversation's first prompt to the selected provider, which may bill for usage. It can differ from your coding agent's provider."                                                                                                                                                                                                                                   |
| **Improve titles with AI** (`SettingsToggleRow`)                                                 | Off by default. Description: "Off by default. Existing conversations are never retitled."                                                                                                                                                                                                                                                                                                                  |
| **Model** (existing `ModelPicker`, `showReasoning={false}`)                                      | Disabled while the switch is off. Lists text models from authenticated providers, using the same model list as General → Model and filtered to text-generation routes with `isModelCompatible`. Description: "A small, fast text model works best, such as Flash-Lite, GPT-5 nano or Haiku." It has a "Providers →" hint link. There's no maintained recommendation list; the description is the guidance. |

Inline status, shown below the rows when it applies:

- **On, no model:** warning "Choose a model to start. Until then, local titles are used."
- **On, model unavailable** (provider disconnected, credentials missing, or model removed from the catalog): the picker shows its existing "Unavailable" badge, plus a warning "This model isn't available with your connected providers. Local titles are used until you choose another model or reconnect its provider."

## Section "Test"

The section info tooltip says: "Uses a built-in sample prompt, never one of your conversations."

- A row shows the sample prompt as its description and an outline **Run test** button (disabled when off or unavailable).
- The result shows below as `SettingsInlineMessage`: success shows "‹generated title› · ‹latency› ms"; destructive shows the error category (timeout, auth, rate limit, invalid output). Runtime provider failures aren't otherwise surfaced in settings; they're logged and local titles are used.

## Storage and behavior

- User settings shape in `packages/contracts`: `conversationTitles: { enabled: boolean, model: { provider, modelId } | null }`. The default is `{ enabled: false, model: null }`.
- The concrete provider and model are stored, with no `latest` alias following and no substitution when the model disappears.
- Credentials stay in Providers, never on this page.
- Turning the switch off cancels queued title jobs. Titles already improved stay.

## Tests

- Settings schema validation and defaults.
- Model eligibility filter (text-generation only).
- Status derivation: off, no model, unavailable, ready.
- The Test request uses the synthetic sample only and reports error categories.
