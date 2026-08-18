// Clamp the chat panel width to a sane range: floor 340px, ceiling the smaller
// of 720px and 60% of the viewport, so it never crowds the page on a small window.
export function clampPanelWidth(px: number, viewportWidth: number): number {
  const ceil = Math.min(720, Math.floor(0.6 * viewportWidth));
  return Math.max(340, Math.min(px, ceil));
}
