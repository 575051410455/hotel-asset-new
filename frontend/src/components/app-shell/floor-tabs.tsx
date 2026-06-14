import { Link } from '@tanstack/react-router';
import { cn } from '@/lib/utils';

// Data-driven floor switcher shown in the map top bar. Renders one tab per floor
// of the given kind; hidden when there's 0–1 floor (nothing to switch between).
export function FloorTabs({
  floors,
  activeFloorId,
  to,
}: {
  floors: { id: string; short: string }[];
  activeFloorId: string;
  to: '/workstation' | '/cctv';
}) {
  if (floors.length <= 1) return null;
  return (
    <div className="flex items-center gap-[3px] rounded-[9px] border border-line bg-bg p-[3px]">
      {floors.map((f) => (
        <Link
          key={f.id}
          to={to}
          search={{ floor: f.id }}
          className={cn(
            'whitespace-nowrap rounded-md px-[13px] py-[5px] text-[12.5px] font-semibold',
            activeFloorId === f.id ? 'bg-surface text-ink shadow-[var(--shadow)]' : 'text-ink2 hover:text-ink'
          )}
        >
          {f.short}
        </Link>
      ))}
    </div>
  );
}
