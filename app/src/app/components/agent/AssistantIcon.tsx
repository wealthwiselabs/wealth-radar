// Sparkle "AI" mark for the assistant, matching the reference icon: one large
// four-point sparkle with two smaller ones. Uses `currentColor` so it inherits
// the surrounding text color and stays theme-aware. Purely decorative.
export default function AssistantIcon({ className }: { className?: string }) {
  // A single four-point sparkle centered at (0,0), unit radius, with concave
  // (pinched) sides via the 0.45 control points. Reused at three positions.
  const sparkle =
    'M0,-1 C0,-0.45 0.45,0 1,0 C0.45,0 0,0.45 0,1 C0,0.45 -0.45,0 -1,0 C-0.45,0 0,-0.45 0,-1 Z';
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={sparkle} transform="translate(9 13) scale(7)" />
      <path d={sparkle} transform="translate(17.5 7) scale(3.6)" />
      <path d={sparkle} transform="translate(17.5 18.5) scale(2.8)" />
    </svg>
  );
}
