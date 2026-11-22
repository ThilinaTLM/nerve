import {
  clearLayer,
  setLayer,
  type LayerChoices,
  type Layered,
  type SettingLayer,
} from "../../state/layered";

/** Writes (or, for `undefined`, removes) one layer's choice. */
export type LayerWriter<T> = (choice: T | undefined) => unknown;

/**
 * A switch or value changed at `layer`: works out the stored choices with the
 * shared layer semantics (a choice equal to what it would inherit is dropped)
 * and writes only the layers that changed, User first. `next` of `undefined`
 * clears the layer's own choice.
 */
export async function applyLayerChange<T>(input: {
  value: Layered<T>;
  layer: SettingLayer;
  next: T | undefined;
  writeUser: LayerWriter<T>;
  writeProject: LayerWriter<T>;
  equals?: (a: T, b: T) => boolean;
}): Promise<LayerChoices<T>> {
  const { value, layer, next, equals = Object.is } = input;
  const choices =
    next === undefined
      ? clearLayer(value, layer, equals)
      : setLayer(value, layer, next, equals);
  const differs = (a: T | undefined, b: T | undefined) =>
    a === undefined || b === undefined ? a !== b : !equals(a, b);
  if (differs(choices.user, value.user)) await input.writeUser(choices.user);
  if (differs(choices.project, value.project))
    await input.writeProject(choices.project);
  return choices;
}
