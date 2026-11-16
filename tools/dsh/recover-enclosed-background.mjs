/** Recover large, high-confidence pieces of a red backdrop trapped inside a silhouette. */
export function recoverEnclosedBackground({ rgb, width, height, candidates, reached, rowR, rowG, rowB, recoverSmallMagenta = false }) {
  const pixels = width * height;
  if (rgb.length !== pixels * 3 || candidates.length !== pixels || reached.length !== pixels ||
      rowR.length !== height || rowG.length !== height || rowB.length !== height) {
    throw new Error('Unexpected matte input dimensions');
  }
  const seen = new Uint8Array(pixels), queue = new Int32Array(pixels);
  let recoveredPixels = 0, recoveredComponents = 0;
  for (let origin = 0; origin < pixels; origin++) {
    if (!candidates[origin] || reached[origin] || seen[origin]) continue;
    let start = 0, end = 0, distanceSum = 0, closeCount = 0, magentaCount = 0;
    seen[origin] = 1; queue[end++] = origin;
    while (start < end) {
      const i = queue[start++], x = i % width, y = Math.floor(i / width), p = i * 3;
      const distance = Math.hypot(rgb[p] - rowR[y], rgb[p + 1] - rowG[y], rgb[p + 2] - rowB[y]);
      distanceSum += distance;
      if (distance < 20) closeCount++;
      if (recoverSmallMagenta && distance < 28 && rowB[y] > rowG[y] + 55 && rgb[p + 2] > rgb[p + 1] + 45) magentaCount++;
      const add = j => {
        if (candidates[j] && !reached[j] && !seen[j]) { seen[j] = 1; queue[end++] = j; }
      };
      if (x > 0) add(i - 1); if (x < width - 1) add(i + 1);
      if (y > 0) add(i - width); if (y < height - 1) add(i + width);
    }
    // Small red ornaments and near-but-not-matching clothing are left intact.
    // This is deliberately conservative and still requires visual inspection.
    const largeBackdrop = end >= 40 && closeCount >= 30 && distanceSum / end < 32 && closeCount / end >= 0.35;
    // A small gap has proportionally more mixed edge pixels than a large one.
    const smallMagentaBackdrop = recoverSmallMagenta && magentaCount >= 12 && magentaCount >= end * 0.5 && distanceSum / end < 34;
    if (largeBackdrop || smallMagentaBackdrop) {
      for (let j = 0; j < end; j++) reached[queue[j]] = 1;
      recoveredPixels += end; recoveredComponents++;
    }
  }
  return { recoveredPixels, recoveredComponents };
}
