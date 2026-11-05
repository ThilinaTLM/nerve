import type {
  SettingsPageDef,
  SettingsSectionDef,
} from "./settings-component-contracts";
import { settingsSectionDomId } from "./section-id";

export function firstEnabledSectionId(page?: SettingsPageDef): string {
  const sections = page?.sections ?? [];
  return (
    (sections.find((section) => !section.disabled) ?? sections[0])?.id ?? ""
  );
}

export function observeSettingsSections(
  viewport: HTMLElement,
  sections: readonly SettingsSectionDef[],
  onActiveSection: (id: string) => void,
): () => void {
  let frame = 0;
  let observer: IntersectionObserver | undefined;
  let visible: string[] = [];

  frame = requestAnimationFrame(() => {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.getAttribute("data-settings-section");
          if (!id) continue;
          if (entry.isIntersecting) {
            if (!visible.includes(id)) visible = [...visible, id];
          } else {
            visible = visible.filter((value) => value !== id);
          }
        }
        const next = sections.find((section) => visible.includes(section.id));
        if (next) onActiveSection(next.id);
      },
      { root: viewport, rootMargin: "0px 0px -60% 0px", threshold: 0 },
    );

    for (const section of sections) {
      const element = viewport.querySelector(
        `#${CSS.escape(settingsSectionDomId(section.id))}`,
      );
      if (!element) continue;
      element.setAttribute("data-settings-section", section.id);
      observer.observe(element);
    }
  });

  return () => {
    cancelAnimationFrame(frame);
    observer?.disconnect();
  };
}
