const narrowCarousel = (): MediaQueryList => matchMedia("(max-width: 767px)");

const reduceMotion = (): boolean =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

export function initCarousels(): void {
  for (const track of document.querySelectorAll<HTMLElement>(
    "[data-carousel]",
  )) {
    initCarousel(track);
  }
}

function initCarousel(track: HTMLElement): void {
  const slides = [
    ...track.querySelectorAll<HTMLElement>("[data-carousel-slide]"),
  ];
  const root =
    track.closest<HTMLElement>("[data-pocket]") ?? track.parentElement;
  const dots = [
    ...(root?.querySelectorAll<HTMLElement>("[data-carousel-dot]") ?? []),
  ];
  if (!slides.length) return;

  const media = narrowCarousel();
  let pointerId: number | undefined;
  let startX = 0;
  let startScrollLeft = 0;
  let dragged = false;
  let suppressClick = false;
  let syncFrame = 0;

  const nearestIndex = (): number => {
    const center = track.scrollLeft + track.clientWidth / 2;
    let nearest = 0;
    let distance = Number.POSITIVE_INFINITY;

    for (const [index, slide] of slides.entries()) {
      const slideCenter = slide.offsetLeft + slide.offsetWidth / 2;
      const nextDistance = Math.abs(slideCenter - center);
      if (nextDistance >= distance) continue;
      nearest = index;
      distance = nextDistance;
    }

    return nearest;
  };

  const syncDots = (): void => {
    cancelAnimationFrame(syncFrame);
    syncFrame = requestAnimationFrame(() => {
      const active = nearestIndex();
      for (const [index, dot] of dots.entries())
        dot.toggleAttribute("data-active", index === active);
    });
  };

  const scrollToSlide = (index: number): void => {
    const slide = slides[Math.max(0, Math.min(index, slides.length - 1))];
    if (!slide) return;
    const centered =
      slide.offsetLeft - (track.clientWidth - slide.offsetWidth) / 2;
    const left = Math.max(
      0,
      Math.min(centered, track.scrollWidth - track.clientWidth),
    );
    track.scrollTo({
      left,
      behavior: reduceMotion() ? "auto" : "smooth",
    });
  };

  const clearDrag = (settle: boolean): void => {
    if (pointerId === undefined) return;
    if (track.hasPointerCapture(pointerId))
      track.releasePointerCapture(pointerId);
    pointerId = undefined;
    delete track.dataset.dragging;
    suppressClick = dragged;
    if (settle && dragged) scrollToSlide(nearestIndex());
    dragged = false;
  };

  track.addEventListener("pointerdown", (event) => {
    if (!media.matches || event.pointerType !== "mouse" || event.button !== 0)
      return;

    pointerId = event.pointerId;
    startX = event.clientX;
    startScrollLeft = track.scrollLeft;
    dragged = false;
    track.dataset.dragging = "";
    track.setPointerCapture(pointerId);
  });

  track.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId) return;
    const delta = event.clientX - startX;
    if (!dragged && Math.abs(delta) < 4) return;
    dragged = true;
    event.preventDefault();
    track.scrollLeft = startScrollLeft - delta;
  });

  track.addEventListener("pointerup", (event) => {
    if (event.pointerId === pointerId) clearDrag(true);
  });
  track.addEventListener("pointercancel", (event) => {
    if (event.pointerId === pointerId) clearDrag(false);
  });
  track.addEventListener("lostpointercapture", () => clearDrag(true));
  track.addEventListener(
    "click",
    (event) => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
    },
    { capture: true },
  );

  track.addEventListener("keydown", (event) => {
    if (!media.matches || !["ArrowLeft", "ArrowRight"].includes(event.key))
      return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    scrollToSlide(nearestIndex() + direction);
  });

  track.addEventListener("scroll", syncDots, { passive: true });
  window.addEventListener("resize", syncDots, { passive: true });
  window.addEventListener("blur", () => clearDrag(true));
  media.addEventListener("change", () => {
    clearDrag(false);
    syncDots();
  });
  syncDots();
}
