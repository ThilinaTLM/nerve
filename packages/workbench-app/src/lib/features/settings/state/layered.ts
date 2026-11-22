/**
 * Layer semantics of the unified settings: a value is chosen by the project,
 * else by the user, else it is the built-in default. An absent layer inherits.
 */
export type Layered<T> = {
  builtinDefault: T;
  /** The user's own choice (every project); absent = the built-in default. */
  user?: T;
  /** This project's own choice; absent = the user's effective value. */
  project?: T;
};

export type LayerChoices<T> = Pick<Layered<T>, "user" | "project">;
export type SettingLayer = "user" | "project";

/** What applies for the user, ignoring any project. */
export function userEffective<T>(value: Layered<T>): T {
  return value.user ?? value.builtinDefault;
}

/** What applies in the project: project ?? user ?? built-in default. */
export function effective<T>(value: Layered<T>): T {
  return value.project ?? userEffective(value);
}

/**
 * The choices after setting `layer` to `next` (for a switch: the new on/off).
 * A choice that equals what it would inherit anyway is dropped, so a switch
 * never needs a reset: flipping the project back to the user's value clears the
 * project override, and a user change that makes the user's value equal the
 * project's clears the project override.
 */
export function setLayer<T>(
  value: Layered<T>,
  layer: SettingLayer,
  next: T,
  equals: (a: T, b: T) => boolean = Object.is,
): LayerChoices<T> {
  if (layer === "project") {
    const inherited = userEffective(value);
    return {
      user: value.user,
      project: equals(next, inherited) ? undefined : next,
    };
  }
  const user = equals(next, value.builtinDefault) ? undefined : next;
  const inherited = user ?? value.builtinDefault;
  return {
    user,
    project:
      value.project !== undefined && equals(value.project, inherited)
        ? undefined
        : value.project,
  };
}

/** Removes a layer's choice (the ↺ of a value cell), then drops a project choice the user layer now matches. */
export function clearLayer<T>(
  value: Layered<T>,
  layer: SettingLayer,
  equals: (a: T, b: T) => boolean = Object.is,
): LayerChoices<T> {
  if (layer === "project") return { user: value.user, project: undefined };
  const inherited = value.builtinDefault;
  return {
    user: undefined,
    project:
      value.project !== undefined && equals(value.project, inherited)
        ? undefined
        : value.project,
  };
}
