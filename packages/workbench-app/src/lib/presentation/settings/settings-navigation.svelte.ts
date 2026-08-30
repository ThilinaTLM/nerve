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

export function observeNavigationOverflow(
  nav: HTMLElement,
  onChange: (state: { back: boolean; forward: boolean }) => void,
): () => void {
  const update = () => {
    const maxScroll = nav.scrollWidth - nav.clientWidth;
    onChange({
      back: nav.scrollLeft > 1,
      forward: nav.scrollLeft < maxScroll - 1,
    });
  };
  update();
  nav.addEventListener("scroll", update, { passive: true });
  const observer = new ResizeObserver(update);
  observer.observe(nav);
  return () => {
    nav.removeEventListener("scroll", update);
    observer.disconnect();
  };
}

export function scrollNavigation(
  nav: HTMLElement | null,
  direction: -1 | 1,
): void {
  if (!nav) return;
  nav.scrollBy({ left: direction * nav.clientWidth * 0.7, behavior: "smooth" });
}

export function flashSettingsSection(element: Element): void {
  element.classList.remove("animate-section-flash");
  void (element as HTMLElement).offsetWidth;
  element.classList.add("animate-section-flash");
  element.addEventListener(
    "animationend",
    () => element.classList.remove("animate-section-flash"),
    { once: true },
  );
}
