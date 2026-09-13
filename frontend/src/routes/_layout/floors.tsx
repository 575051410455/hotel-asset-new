import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Search, ShieldOff, Monitor, Cctv, ImageOff, MapPin } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useFloors, useDeleteFloor } from '@/lib/devices';
import { FloorDialog } from '@/components/floor-dialog';
import { useSetPageHeader } from '@/components/app-shell/page-header';
import { ReadOnlyBadge } from '@/components/app-shell/topbar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import type { FloorWithPins } from '@/lib/types';

export const Route = createFileRoute('/_layout/floors')({
  component: FloorsPage,
});

type KindFilter = 'all' | 'workstation' | 'cctv';

function KindPill({ kind }: { kind: string }) {
  const isCctv = kind === 'cctv';
  const Icon = isCctv ? Cctv : Monitor;
  return (
    <span className="inline-flex items-center gap-[6px] rounded-full border border-line bg-surface2 px-[10px] py-[3px] text-[11px] font-semibold text-ink2">
      <Icon size={12} className="text-ink3" />
      {isCctv ? 'CCTV floor' : 'Workstation floor'}
    </span>
  );
}

function FloorsPage() {
  const { activeHotelId, can } = useAuth();
  const canCrud = can('floors', 'crud');
  const canRead = can('floors', 'read');
  const readOnly = !canCrud && canRead;

  const { data: floors = [], isLoading } = useFloors(activeHotelId);
  const del = useDeleteFloor(activeHotelId);

  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [search, setSearch] = useState('');
  // `dialog.floor === null` → create; otherwise edit that floor.
  const [dialog, setDialog] = useState<{ floor: FloorWithPins | null } | null>(null);
  const [confirm, setConfirm] = useState<FloorWithPins | null>(null);

  useSetPageHeader(
    {
      title: 'Floors',
      subtitle: 'Manage floor plans, departments & navigation',
      badge: readOnly ? <ReadOnlyBadge /> : undefined,
      actions: canCrud ? (
        <button
          onClick={() => setDialog({ floor: null })}
          className="flex h-[30px] items-center gap-[6px] rounded-lg bg-ink px-[12px] text-[12px] font-semibold text-bg"
        >
          <Plus size={13} strokeWidth={2.4} />
          Add floor
        </button>
      ) : undefined,
    },
    [readOnly, canCrud]
  );

  if (!canRead) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex max-w-[360px] flex-col items-center gap-[10px] rounded-[14px] border border-line bg-surface p-[30px_38px] text-center shadow-[var(--shadow)]">
          <ShieldOff size={28} className="text-ink3" />
          <div className="text-[15px] font-bold">You don't have access to this page</div>
          <div className="text-[12.5px] leading-[1.55] text-ink2">
            Your role doesn't include floor management. Ask an administrator to grant it.
          </div>
        </div>
      </div>
    );
  }

  const q = search.trim().toLowerCase();
  const rows = floors.filter((f) => {
    if (kindFilter !== 'all' && f.kind !== kindFilter) return false;
    if (!q) return true;
    return `${f.short} ${f.name} ${f.id}`.toLowerCase().includes(q);
  });

  const tabs: { key: KindFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: floors.length },
    { key: 'workstation', label: 'Workstation', count: floors.filter((f) => f.kind === 'workstation').length },
    { key: 'cctv', label: 'CCTV', count: floors.filter((f) => f.kind === 'cctv').length },
  ];

  const doDelete = () => {
    if (!confirm) return;
    const f = confirm;
    del.mutate(f.id, {
      onSuccess: () => toast.success(`Floor "${f.short}" deleted`),
      onError: (e: Error) => toast.error(e.message),
    });
    setConfirm(null);
  };

  return (
    <div className="flex max-w-[1180px] flex-col gap-[14px] p-[18px]">
      {/* Filters + search */}
      <div className="flex flex-wrap items-center gap-[10px]">
        <div className="flex items-center gap-[3px] rounded-[9px] border border-line bg-surface p-[3px]">
          {tabs.map((t) => {
            const active = kindFilter === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setKindFilter(t.key)}
                className={cn(
                  'whitespace-nowrap rounded-md px-[14px] py-[6px] text-[12.5px] font-semibold',
                  active ? 'bg-brand-soft text-brand' : 'text-ink2 hover:text-ink'
                )}
              >
                {t.label} {t.count}
              </button>
            );
          })}
        </div>
        <div className="relative min-w-[150px] max-w-[270px] flex-1">
          <Search size={13} className="absolute left-[10px] top-1/2 -translate-y-1/2 text-ink3" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, label or slug…"
            className="h-[34px] w-full rounded-lg border border-line bg-surface pl-[30px] pr-[10px] text-[12.5px] outline-none focus:border-brand"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse">
            <thead>
              <tr>
                {['Floor', 'Slug', 'Type', 'Departments', 'Pins', 'Plan', ''].map((h, i) => (
                  <th
                    key={i}
                    className="whitespace-nowrap border-b border-line px-4 py-[10px] text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-ink3"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => {
                const deptNoun = f.kind === 'cctv' ? 'zone' : 'dept';
                return (
                  <tr key={f.id} className="hover:bg-surface2">
                    <td className="whitespace-nowrap border-b border-line2 px-4 py-[10px]">
                      <span className="block text-[13px] font-semibold text-ink">{f.short}</span>
                      <span className="block text-[11.5px] text-ink3">{f.name}</span>
                    </td>
                    <td className="whitespace-nowrap border-b border-line2 px-4 py-[10px] font-mono text-[11.5px] text-ink2">
                      {f.id}
                    </td>
                    <td className="whitespace-nowrap border-b border-line2 px-4 py-[10px]">
                      <KindPill kind={f.kind} />
                    </td>
                    <td className="max-w-[220px] truncate border-b border-line2 px-4 py-[10px] text-[12.5px] text-ink2">
                      {f.departments.length > 0 ? (
                        <span title={f.departments.join(', ')}>
                          {f.departments.length} {deptNoun}
                          {f.departments.length === 1 ? '' : 's'}
                        </span>
                      ) : (
                        <span className="text-ink3">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap border-b border-line2 px-4 py-[10px] text-[12.5px] text-ink2">
                      <span className="inline-flex items-center gap-[5px]">
                        <MapPin size={12} className="text-ink3" />
                        {f.pins.length}
                      </span>
                    </td>
                    <td className="whitespace-nowrap border-b border-line2 px-4 py-[10px]">
                      {f.image ? (
                        <img
                          src={f.image}
                          alt=""
                          className="h-[28px] w-[44px] rounded-[5px] border border-line object-cover"
                        />
                      ) : (
                        <span className="inline-flex items-center gap-[5px] text-[11.5px] text-ink3">
                          <ImageOff size={13} />
                          None
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap border-b border-line2 px-3 py-[10px]">
                      {canCrud && (
                        <div className="flex justify-end gap-[4px]">
                          <button
                            onClick={() => setDialog({ floor: f })}
                            title="Edit floor"
                            className="flex size-[28px] items-center justify-center rounded-[7px] text-ink3 hover:bg-surface2 hover:text-ink"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => setConfirm(f)}
                            title="Delete floor"
                            className="flex size-[28px] items-center justify-center rounded-[7px] text-ink3 hover:bg-bad-soft hover:text-bad"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <div className="p-[26px_16px] text-center text-[12.5px] text-ink3">
            {isLoading
              ? 'Loading floors…'
              : floors.length === 0
                ? canCrud
                  ? 'No floors yet — add your first one with “Add floor”.'
                  : 'No floors have been added for this property yet.'
                : 'No floors match your filters.'}
          </div>
        )}
      </div>

      {/* Add / edit dialog */}
      {dialog && (
        <FloorDialog
          open
          onOpenChange={(v) => !v && setDialog(null)}
          hotelId={activeHotelId}
          defaultKind={kindFilter === 'cctv' ? 'cctv' : 'workstation'}
          floor={dialog.floor}
          onCreated={() => setDialog(null)}
          onSaved={() => setDialog(null)}
        />
      )}

      {/* Delete confirm */}
      <AlertDialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirm?.short}?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm && confirm.pins.length > 0
                ? `This floor has ${confirm.pins.length} placed device${confirm.pins.length === 1 ? '' : 's'}. They stay in the inventory but lose their map placement. This cannot be undone.`
                : 'The floor is removed from the maps & navigation. This cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} className="bg-bad text-white hover:bg-bad/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
