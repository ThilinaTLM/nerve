const repositoryEndpoint = "https://api.github.com/repos/ThilinaTLM/nerve";
const cacheKey = "nerve:github-stars:v1";
const cacheLifetime = 60 * 60 * 1000;
const starCountFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const scrambleStartedAt = performance.now();
const minimumScrambleTime = 500;
let activeStarAnimation = 0;
let scrambleInterval = 0;
let scrambleTimeout = 0;
let settleTimeout = 0;

function starCountElement() {
  return document.querySelector<HTMLElement>("[data-github-star-count]");
}

function setVisibleStarCount(count: number) {
  const starCount = starCountElement();
  if (starCount) {
    starCount.textContent =
      count === 0 ? "00" : starCountFormatter.format(count);
  }
}

function stopScramble() {
  window.clearInterval(scrambleInterval);
  window.clearTimeout(scrambleTimeout);
}

function startScramble() {
  if (reducedMotion) return;
  scrambleInterval = window.setInterval(() => {
    const randomCount = Math.floor(Math.random() * 100);
    const starCount = starCountElement();
    if (starCount) starCount.textContent = String(randomCount).padStart(2, "0");
  }, 70);
  scrambleTimeout = window.setTimeout(() => {
    stopScramble();
    setVisibleStarCount(0);
  }, 8000);
}

function renderStarCount(count: number) {
  const link = document.querySelector<HTMLAnchorElement>(
    "[data-github-star-link]",
  );
  if (link) {
    const exactCount = count.toLocaleString("en-US");
    link.ariaLabel = `Nerve on GitHub · ${exactCount} stars`;
    link.title = `${exactCount} GitHub stars`;
  }

  window.clearTimeout(settleTimeout);
  const settleDelay = reducedMotion
    ? 0
    : Math.max(
        0,
        minimumScrambleTime - (performance.now() - scrambleStartedAt),
      );
  settleTimeout = window.setTimeout(() => {
    stopScramble();
    if (reducedMotion) {
      setVisibleStarCount(count);
      return;
    }

    cancelAnimationFrame(activeStarAnimation);
    const visibleCount = Number.parseInt(
      starCountElement()?.textContent ?? "0",
      10,
    );
    const startingCount = Number.isFinite(visibleCount) ? visibleCount : 0;
    const startedAt = performance.now();
    const duration = 650;

    const animate = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      const displayedCount = Math.round(
        startingCount + (count - startingCount) * easedProgress,
      );
      setVisibleStarCount(displayedCount);
      if (progress < 1) activeStarAnimation = requestAnimationFrame(animate);
    };

    activeStarAnimation = requestAnimationFrame(animate);
  }, settleDelay);
}

function readCachedStars() {
  try {
    const cached: unknown = JSON.parse(
      localStorage.getItem(cacheKey) ?? "null",
    );
    if (
      typeof cached === "object" &&
      cached !== null &&
      "count" in cached &&
      "updatedAt" in cached &&
      typeof cached.count === "number" &&
      Number.isFinite(cached.count) &&
      cached.count >= 0 &&
      typeof cached.updatedAt === "number" &&
      Number.isFinite(cached.updatedAt)
    ) {
      return { count: cached.count, updatedAt: cached.updatedAt };
    }
  } catch {
    // Storage can be unavailable; the GitHub link still works without it.
  }
  return null;
}

function cacheStars(count: number) {
  try {
    localStorage.setItem(
      cacheKey,
      JSON.stringify({ count, updatedAt: Date.now() }),
    );
  } catch {
    // A star count is optional progressive enhancement.
  }
}

startScramble();
const cachedStars = readCachedStars();
if (cachedStars) renderStarCount(cachedStars.count);

if (!cachedStars || Date.now() - cachedStars.updatedAt >= cacheLifetime) {
  fetch(repositoryEndpoint, {
    headers: { Accept: "application/vnd.github+json" },
  })
    .then((response) => {
      if (!response.ok) throw new Error("GitHub star count unavailable");
      return response.json();
    })
    .then((repository: unknown) => {
      if (
        typeof repository !== "object" ||
        repository === null ||
        !("stargazers_count" in repository) ||
        typeof repository.stargazers_count !== "number" ||
        !Number.isFinite(repository.stargazers_count) ||
        repository.stargazers_count < 0
      ) {
        throw new Error("Invalid GitHub star count");
      }
      renderStarCount(repository.stargazers_count);
      cacheStars(repository.stargazers_count);
    })
    .catch(() => {
      if (!cachedStars) {
        stopScramble();
        setVisibleStarCount(0);
      }
    });
}
