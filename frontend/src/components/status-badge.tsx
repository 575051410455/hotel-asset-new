import { normStatus, statusMeta } from '@/lib/types';
import type { Device } from '@/lib/types';

// Status pill used in the inventory table and detail panels.
export function StatusBadge({ device }: { device: Pick<Device, 'type' | 'status'> }) {
  const meta = statusMeta(normStatus(device));
  return (
    <span
      className="inline-flex items-center gap-[6px] whitespace-nowrap rounded-full px-[10px] py-[2px] text-[10.5px] font-bold tracking-[0.04em]"
      style={{ background: meta.soft, color: meta.color }}
    >
      <span className="size-[6px] rounded-full bg-current" />
      {meta.label}
    </span>
  );
}

export function StatusDot({ status, size = 8 }: { status: string; size?: number }) {
  const meta = statusMeta(status);
  return (
    <span
      className="inline-block flex-none rounded-full"
      style={{ width: size, height: size, background: meta.color }}
    />
  );
}
