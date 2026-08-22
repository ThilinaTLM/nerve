const WORKBENCH_LIB = "packages/workbench-app/src/lib/";

/**
 * Return a boundary error for one resolved Workbench import, or undefined when
 * the dependency direction is allowed. This helper intentionally operates on
 * normalized repository paths so the checker can apply it to aliases and
 * relative imports alike.
 */
export function workbenchBoundaryViolation(sourceFile, targetFile) {
  if (!sourceFile.startsWith(WORKBENCH_LIB)) return undefined;
  if (!targetFile?.startsWith(WORKBENCH_LIB)) return undefined;

  const source = sourceFile.slice(WORKBENCH_LIB.length);
  const target = targetFile.slice(WORKBENCH_LIB.length);
  const sourceLayer = source.split("/", 1)[0];
  const targetLayer = target.split("/", 1)[0];

  if (sourceLayer === "kernel" && targetLayer !== "kernel") {
    return `kernel may not depend on ${targetLayer}`;
  }

  if (
    sourceLayer === "platform" &&
    ["app", "application", "features", "presentation"].includes(targetLayer)
  ) {
    return `platform may not depend on ${targetLayer}`;
  }

  if (sourceLayer === "presentation" && targetLayer !== "presentation") {
    return `presentation may not depend on ${targetLayer}`;
  }

  const sourceFeature = featureOwner(source);
  const targetFeature = featureOwner(target);
  if (sourceFeature && targetFeature && sourceFeature !== targetFeature) {
    return `feature ${sourceFeature} may not depend on feature ${targetFeature}; compose cross-feature workflows in app/composition or application`;
  }

  if (sourceLayer === "features" && targetLayer === "app") {
    return "features may not depend on app composition";
  }

  if (
    source.startsWith("app/shell/") &&
    target.startsWith("features/") &&
    isPrivateFeaturePath(target)
  ) {
    return "app shell must use feature public APIs; concrete private wiring belongs in app/composition";
  }

  return undefined;
}

export function resolveWorkbenchImport(sourceFile, specifier) {
  if (specifier === "$lib") return `${WORKBENCH_LIB.slice(0, -1)}.ts`;
  if (specifier.startsWith("$lib/")) {
    return `${WORKBENCH_LIB}${specifier.slice("$lib/".length)}`;
  }
  if (!specifier.startsWith(".")) return undefined;
  const sourceParts = sourceFile.split("/");
  sourceParts.pop();
  for (const part of specifier.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") sourceParts.pop();
    else sourceParts.push(part);
  }
  return sourceParts.join("/");
}

export function findDependencyCycles(graph) {
  let nextIndex = 0;
  const indexes = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const cycles = [];

  function visit(node) {
    indexes.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const dependency of graph.get(node) ?? []) {
      if (!indexes.has(dependency)) {
        visit(dependency);
        lowLinks.set(
          node,
          Math.min(lowLinks.get(node), lowLinks.get(dependency)),
        );
      } else if (onStack.has(dependency)) {
        lowLinks.set(
          node,
          Math.min(lowLinks.get(node), indexes.get(dependency)),
        );
      }
    }

    if (lowLinks.get(node) !== indexes.get(node)) return;
    const component = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    if (component.length > 1) cycles.push(component.sort());
  }

  for (const node of graph.keys()) {
    if (!indexes.has(node)) visit(node);
  }
  return cycles;
}

function featureOwner(path) {
  const match = /^features\/([^/]+)(?:\/|$)/.exec(path);
  return match?.[1];
}

function isPrivateFeaturePath(path) {
  return /^features\/[^/]+\/(?:api|application|components|domain|infrastructure|state|ui)\//.test(
    path,
  );
}
