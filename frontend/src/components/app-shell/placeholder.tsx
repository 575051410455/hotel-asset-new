import { Construction } from 'lucide-react';

export function ComingSoon({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-surface2 text-ink3">
        <Construction size={22} />
      </div>
      <div className="text-[16px] font-bold text-ink">{title}</div>
      <div className="max-w-[360px] text-[13px] text-ink2">{note}</div>
    </div>
  );
}
