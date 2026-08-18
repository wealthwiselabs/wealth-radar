// Whole-second label for a "Thought for Ns" chip. Floors, min 1s so a fast
// turn never reads "0s".
export function formatThoughtDuration(ms: number): string {
  return `${Math.max(1, Math.floor(ms / 1000))}s`;
}
