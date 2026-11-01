import {
  ALLOWED_STYLE_PARTIALS,
  countClassConsumers,
  extractClassSelectors,
  findBareGlobalSelectors,
  findDarkUtilities,
  findInertClassNames,
  findOffScaleTextSizes,
  findOffTokenColours,
  isDynamicClass,
} from "./style-policy.mjs";
import { sourceExtensions } from "./repository-source-inventory.mjs";

export function checkUiStyles({ files: trackedFiles, read }, fail) {
  checkUiStructureAndStyles();

  function checkUiStructureAndStyles() {
    const appSource = trackedFiles.filter(
      (file) =>
        /packages\/workbench-app\/src\//.test(file) &&
        sourceExtensions.test(file),
    );
    for (const file of appSource) {
      const text = read(file);
      if (/Git(?:RepoBranch|Changes|Pr)Section/.test(text))
        fail(file, "apps must compose Git through GitPanelView");
    }

    for (const file of trackedFiles.filter((path) =>
      path.endsWith(".svelte"),
    )) {
      const text = read(file);
      if (/@keyframes\b/.test(text))
        fail(file, "Svelte components may not define @keyframes");
      if (/import\s+["'][^"']+\.css["']/.test(text))
        fail(file, "Svelte components may not import CSS");
    }
    for (const file of trackedFiles.filter(
      (path) => sourceExtensions.test(path) && !path.endsWith(".svelte"),
    )) {
      const text = read(file);
      if (
        /import\s+["'][^"']+\.css["']/.test(text) &&
        !/\/src\/main\.ts$/.test(file)
      )
        fail(file, "CSS imports are allowed only from app src/main.ts entries");
    }

    checkNoDarkUtilities();
    checkTypeScale();
    checkAppColours();
    checkGlobalStylePartials();
    checkBareGlobalSelectors();
    checkInertClassNames();
  }

  /** Themes and previews are colour-only: mode differences live in tokens. */
  function checkNoDarkUtilities() {
    for (const file of trackedFiles) {
      if (
        !/packages\/(?:ui-kit|workbench-app)\/src\//.test(file) ||
        !sourceExtensions.test(file) ||
        file.includes("/design-lab/wireframes/")
      )
        continue;
      const offenders = findDarkUtilities(read(file));
      if (offenders.length > 0)
        fail(
          file,
          `dark: utilities are banned (${offenders[0]}); move the mode difference into a token`,
        );
    }
  }

  /** Font sizes come only from the four type roles defined in theme.css. */
  function checkTypeScale() {
    for (const file of trackedFiles) {
      if (
        !/packages\/(?:ui-kit|workbench-app)\/src\//.test(file) ||
        !sourceExtensions.test(file) ||
        /\.test\.[cm]?[jt]s$/.test(file) ||
        file.includes("/design-lab/wireframes/")
      )
        continue;
      const text = read(file);
      if (
        /import\s*\{[^}]*\btv\b[^}]*\}\s*from\s*["']tailwind-variants["']/.test(
          text,
        )
      )
        fail(
          file,
          "import tv from @nervekit/ui-kit/utils so variants merge type roles correctly",
        );
      const offenders = findOffScaleTextSizes(text);
      if (offenders.length > 0)
        fail(
          file,
          `off-scale font size (${offenders[0]}); use text-caption, text-ui, text-body or text-title`,
        );
    }
  }

  /**
   * App colours come from tokens and their derived recipes, never from local
   * opacity modifiers or color-mix(). Illustrations draw with free alphas.
   */
  function checkAppColours() {
    const illustrations =
      /\/(?:DiscoverNewsArtwork|ThemePreviewPicker|SettingsPreviewCards)\.svelte$/;
    for (const file of trackedFiles) {
      if (
        !/packages\/workbench-app\/src\/lib\/.*\.svelte$/.test(file) ||
        file.includes("/design-lab/") ||
        illustrations.test(file)
      )
        continue;
      const text = read(file);
      const offenders = findOffTokenColours(text);
      if (offenders.length > 0)
        fail(
          file,
          `off-token colour (${offenders[0]}); use a token or its -subtle/-strong recipe`,
        );
      if (/color-mix\(/.test(text))
        fail(
          file,
          "color-mix() belongs in ui-kit theme tokens; use a derived token",
        );
    }
  }

  /**
   * A class defined in another component's scoped <style> does nothing when it is
   * copied into a different component. svelte-check cannot see this, so the guard
   * does.
   */
  function checkInertClassNames() {
    const components = new Map(
      trackedFiles
        .filter(
          (file) =>
            file.endsWith(".svelte") &&
            /packages\/(?:workbench-app|ui-kit)\/src\//.test(file),
        )
        .map((file) => [file, read(file)]),
    );

    const globalClasses = new Set();
    for (const file of trackedFiles.filter(
      (path) =>
        path.endsWith(".css") &&
        /packages\/(?:workbench-app|ui-kit)\/src\/styles\//.test(path),
    )) {
      for (const className of extractClassSelectors(read(file)))
        globalClasses.add(className);
    }
    for (const [, source] of components) {
      for (const selector of findBareGlobalSelectorsIncludingAllowed(source)) {
        for (const className of extractClassSelectors(selector))
          globalClasses.add(className);
      }
    }

    for (const { file, className, definedIn } of findInertClassNames(
      components,
      globalClasses,
    ))
      fail(
        file,
        `class "${className}" is only defined in ${definedIn.join(", ")}; Svelte scoping makes it inert here`,
      );
  }

  function findBareGlobalSelectorsIncludingAllowed(source) {
    return [
      ...source.matchAll(/:global\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g),
    ].map((match) => match[1]);
  }

  /**
   * A global CSS partial is an escape from component ownership, so the set of
   * partials is fixed and every class in one must be a real cross-component
   * contract.
   */
  function checkGlobalStylePartials() {
    const componentSources = new Map(
      trackedFiles
        .filter((file) => file.endsWith(".svelte") || file.endsWith(".ts"))
        .filter((file) =>
          /packages\/(?:workbench-app|ui-kit)\/src\//.test(file),
        )
        .map((file) => [file, read(file)]),
    );

    for (const [directory, allowed] of ALLOWED_STYLE_PARTIALS) {
      const present = trackedFiles.filter(
        (file) => file.startsWith(`${directory}/`) && file.endsWith(".css"),
      );
      for (const file of present) {
        const name = file.slice(directory.length + 1);
        if (!allowed.includes(name)) {
          fail(
            file,
            "new global CSS partial: style the owning component instead, or add it to ALLOWED_STYLE_PARTIALS in scripts/checks/style-policy.mjs",
          );
          continue;
        }
        for (const className of extractClassSelectors(read(file))) {
          if (isDynamicClass(className)) continue;
          const consumers = countClassConsumers(className, componentSources);
          if (consumers === 0)
            fail(file, `.${className} is not referenced by any component`);
          else if (consumers === 1)
            fail(
              file,
              `.${className} has a single consumer and belongs in that component`,
            );
        }
      }
    }
  }

  /** A component may not declare an app-wide class from its own <style> block. */
  function checkBareGlobalSelectors() {
    for (const file of trackedFiles.filter(
      (path) =>
        path.endsWith(".svelte") &&
        /packages\/(?:workbench-app|ui-kit)\/src\//.test(path),
    )) {
      for (const selector of findBareGlobalSelectors(read(file)))
        fail(
          file,
          `bare :global(${selector}) declares an app-wide class; scope it under a local class or pass it through a child's class prop`,
        );
    }
  }
}
