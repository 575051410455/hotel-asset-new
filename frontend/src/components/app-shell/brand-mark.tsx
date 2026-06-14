// The Ops Monitor radar logo mark (ported from the prototype). Defaults to
// currentColor so it follows the chip's foreground; the sticker passes a fixed
// color since it's print artwork.
export function BrandMark({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2" fill={color} />
      <circle cx="8" cy="8" r="4.6" stroke={color} strokeOpacity="0.55" strokeWidth="1.3" />
      <circle cx="8" cy="8" r="7" stroke={color} strokeOpacity="0.25" strokeWidth="1.2" />
    </svg>
  );
}
