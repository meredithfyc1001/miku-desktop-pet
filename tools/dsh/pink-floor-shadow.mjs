/** Fade pink floor-shadow pixels in the lower centre of a reviewed sample. */
export function pinkFloorOpacity({ x, y, width, height, r, g, b, backgroundR, backgroundG, backgroundB }) {
  if (x < width * 0.25 || x >= width * 0.75 || y < height * 0.68 ||
      backgroundR <= backgroundG + 80 || backgroundB <= backgroundG + 35 ||
      r <= g + 65 || b <= g + 35 || r <= b + 25) return 1;
  // Fade in gradually so the top edge of the floor treatment cannot form a line.
  return Math.max(0, Math.min(1, (height * 0.86 - y) / (height * 0.18)));
}
