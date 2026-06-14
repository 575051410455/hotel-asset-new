// The Ops Monitor radar logo mark (ported from the prototype).
export function BrandMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2" fill="#fff" />
      <circle cx="8" cy="8" r="4.6" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.3" />
      <circle cx="8" cy="8" r="7" stroke="#fff" strokeOpacity="0.25" strokeWidth="1.2" />
    </svg>
  );
}
