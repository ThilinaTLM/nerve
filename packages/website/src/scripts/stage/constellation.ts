/* §7 Repo constellation.
 *
 * Impulses conduct from the workspace node to each discovered repository; a
 * repo charges while the signal is arriving. The SVG scales non-uniformly
 * (`preserveAspectRatio="none"`), so the impulse is a travelling dash on the
 * path's own stroke rather than a circle that would render as an ellipse.
 */

import { travelDash } from "./primitives";
import { q, qa } from "./runtime";

export function constellationStage(): void {
  const constellation = q("[data-constellation]");
  if (!constellation) return;

  /* The stage's arrival is owned by its `Reveal` wrapper; animating the nodes
   * a second time here would double the entrance. This stage only conducts. */
  const repos = qa("[data-constellation-repo]", constellation);

  const paths = qa<SVGPathElement>("[data-constellation-path]", constellation);

  for (const [index, path] of paths.entries()) {
    const repo = repos[index];
    let charged = false;

    travelDash(path, {
      duration: 2 + index * 0.35,
      gap: 1.6 + index * 0.5,
      segment: 60,
      onProgress: (progress) => {
        const arriving = progress > 0.72 && progress < 1;
        if (arriving === charged) return;
        charged = arriving;
        repo?.classList.toggle("is-charged", arriving);
      },
    });
  }
}
