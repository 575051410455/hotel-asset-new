import { useMemo, useState } from 'react';
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Search, Plus, Pencil, Trash2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useDevices, useDeleteDevice, useFloors } from '@/lib/devices';
import { normStatus, type Device } from '@/lib/types';
import { StatusBadge } from '@/components/status-badge';
import { DeviceDialog, type DeviceTab } from '@/components/device-dialog';
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
import { useSetPageHeader } from '@/components/app-shell/page-header';
import { ReadOnlyBadge } from '@/components/app-shell/topbar';
import { cn } from '@/lib/utils';

const TABS: { key: DeviceTab; label: string }[] = [
  { key: 'ws', label: 'Workstations' },
  { key: 'cam', label: 'Cameras' },
  { key: 'ap', label: 'Wi-Fi' },
];
const PAGE_SIZE = 9;

// Static 24h demo series (illustrative sparkline, as in the prototype).
const WS_ONLINE = [31, 30, 29, 29, 28, 28, 30, 34, 38, 41, 42, 42, 41, 42, 43, 42, 40, 38, 35, 33, 32, 31, 31, 30];
const CAM_REC = [15, 15, 15, 15, 15, 15, 15, 16, 16, 16, 16, 16, 15, 16, 16, 16, 16, 15, 15, 15, 15, 15, 15, 15];

function chartPaths(series: number[], max: number) {
  const w = 800, h = 230, pad = 12;
  const pts = series.map((v, i) => [
    (i * w) / (series.length - 1),
    h - pad - (v / max) * (h - 2 * pad),
  ]);
  const line = 'M' + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L');
  const area = `${line} L${w} ${h} L0 ${h} Z`;
  return { line, area };
}

export const Route = createFileRoute('/_layout/dashboard')({
  validateSearch: (s: Record<string, unknown>): { tab?: DeviceTab } => {
    const tab = s.tab;
    return tab === 'cam' || tab === 'ap' || tab === 'ws' ? { tab } : {};
  },
  component: DashboardPage,
});

function DashboardPage() {
  const navigate = useNavigate();
  const { tab = 'ws' } = Route.useSearch();
  const { activeHotelId, activeHotel, can } = useAuth();
  const { data: devices, isLoading } = useDevices(activeHotelId);
  const { data: floors = [] } = useFloors(activeHotelId);
  const del = useDeleteDevice(activeHotelId);

  const floorById = useMemo(() => new Map(floors.map((f) => [f.id, f])), [floors]);
  const floorLabel = (id: string | null) => (id ? floorById.get(id)?.short : null) || id || '—';
  const firstWsFloor = floors.find((f) => f.kind === 'workstation')?.id;

  const canCrud = can('devices', 'crud');
  const readOnly = !canCrud && can('devices', 'read');

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [dialog, setDialog] = useState<{ device: Device | null } | null>(null);
  const [confirm, setConfirm] = useState<Device | null>(null);

  useSetPageHeader(
    {
      title: 'Dashboard',
      subtitle: 'Device inventory & availability',
      badge: readOnly ? <ReadOnlyBadge /> : undefined,
      actions: (
        <Link
          to="/workstation"
          search={firstWsFloor ? { floor: firstWsFloor } : {}}
          className="hidden h-8 items-center gap-[6px] rounded-lg border border-line bg-surface px-3 text-[12.5px] font-semibold text-ink2 hover:bg-surface2 hover:text-ink sm:flex"
        >
          Open floor map →
        </Link>
      ),
    },
    [readOnly, firstWsFloor]
  );

  const all = devices ?? [];
  const camRows = useMemo(() => all.filter((r) => r.type === 'IP Camera'), [all]);
  const apRows = useMemo(() => all.filter((r) => r.type === 'Access Point'), [all]);
  const wsRows = useMemo(
    () => all.filter((r) => r.type !== 'IP Camera' && r.type !== 'Access Point'),
    [all]
  );

  const pool = tab === 'cam' ? camRows : tab === 'ap' ? apRows : wsRows;

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return pool;
    return pool.filter((r) =>
      [r.computerName, r.name, r.department, r.model, r.os, r.ssid, r.ip]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [pool, q]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(curPage * PAGE_SIZE, curPage * PAGE_SIZE + PAGE_SIZE);

  // Summary stats (across all devices, regardless of tab).
  const wsOnline = wsRows.filter((r) => normStatus(r) === 'active').length;
  const camRec = camRows.filter((r) => normStatus(r) === 'rec').length;
  const issues = all.filter((r) => ['paused', 'nodata', 'offline'].includes(normStatus(r))).length;
  const ready = !isLoading;

  const wsChart = chartPaths(WS_ONLINE, 48);
  const camChart = chartPaths(CAM_REC, 48);

  const setTab = (t: DeviceTab) => {
    setSearch('');
    setPage(0);
    navigate({ to: '/dashboard', search: { tab: t } });
  };

  const cards = [
    { label: 'Workstations', value: ready ? wsRows.length : '—', foot: 'Account + Office floors', dot: '' },
    { label: 'Online now', value: ready ? wsOnline : '—', foot: ready ? `of ${wsRows.length} workstations` : '', dot: 'var(--ok)' },
    { label: 'Needs attention', value: ready ? issues : '—', foot: 'paused · no data · offline', dot: 'var(--warn)' },
    { label: 'Cameras recording', value: ready ? camRec : '—', foot: ready ? `of ${camRows.length} cameras · NVR-03` : '', dot: 'var(--bad)' },
  ];

  const doDelete = () => {
    if (!confirm) return;
    const name = confirm.computerName;
    del.mutate(confirm.id, {
      onSuccess: () => toast.success(`${name} deleted`),
      onError: (e: Error) => toast.error(e.message),
    });
    setConfirm(null);
  };

  return (
    <div className="flex max-w-[1280px] flex-col gap-4 p-[18px]">
      {/* Stat cards */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-[14px]">
        {cards.map((c) => (
          <div
            key={c.label}
            className="flex flex-col gap-[6px] rounded-xl border border-line bg-surface p-[16px_18px] shadow-[var(--shadow)]"
          >
            <div className="text-[12.5px] font-medium text-ink2">{c.label}</div>
            <div className="text-[27px] font-bold leading-[1.1] tracking-[-0.02em] tabular-nums">
              {c.value}
            </div>
            <div className="flex items-center gap-[6px] text-[11.5px] text-ink3">
              {c.dot && (
                <span className="size-[7px] rounded-full" style={{ background: c.dot }} />
              )}
              {c.foot}
            </div>
          </div>
        ))}
      </div>

      {/* Availability chart */}
      <div className="rounded-xl border border-line bg-surface p-[18px_18px_12px] shadow-[var(--shadow)]">
        <div className="flex flex-wrap items-baseline gap-[12px]">
          <div>
            <div className="text-[14.5px] font-bold">Device availability</div>
            <div className="mt-[2px] text-[12px] text-ink3">Devices online over the last 24 hours</div>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-[14px] text-[11.5px] text-ink2">
            <span className="flex items-center gap-[6px]">
              <span className="size-2 rounded-[2px] bg-brand" />
              Workstations online
            </span>
            <span className="flex items-center gap-[6px]">
              <span className="size-2 rounded-[2px] bg-bad" />
              Cameras recording
            </span>
          </div>
        </div>
        <svg viewBox="0 0 800 230" preserveAspectRatio="none" className="mt-3 block h-[210px] w-full">
          <defs>
            <linearGradient id="gWs" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563EB" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#2563EB" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id="gCam" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#D6454F" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#D6454F" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {[57, 114, 171].map((y) => (
            <line key={y} x1="0" y1={y} x2="800" y2={y} style={{ stroke: 'var(--line2)', strokeWidth: 1 }} />
          ))}
          <path d={wsChart.area} fill="url(#gWs)" />
          <path d={wsChart.line} fill="none" style={{ stroke: 'var(--brand)', strokeWidth: 2 }} vectorEffect="non-scaling-stroke" />
          <path d={camChart.area} fill="url(#gCam)" />
          <path d={camChart.line} fill="none" style={{ stroke: 'var(--bad)', strokeWidth: 2 }} vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="flex justify-between px-[2px] pb-[2px] pt-[6px] text-[10.5px] tabular-nums text-ink3">
          <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
        </div>
      </div>

      {/* Inventory table */}
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow)]">
        <div className="flex flex-wrap items-center gap-[10px] border-b border-line p-[13px_16px]">
          <div className="flex items-center gap-[3px] rounded-[9px] border border-line bg-bg p-[3px]">
            {TABS.map((t) => {
              const active = tab === t.key;
              const count = t.key === 'ws' ? wsRows.length : t.key === 'cam' ? camRows.length : apRows.length;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    'whitespace-nowrap rounded-md px-[13px] py-[5px] text-[12.5px] font-semibold transition-colors',
                    active ? 'bg-surface text-ink shadow-[var(--shadow)]' : 'text-ink2 hover:text-ink'
                  )}
                >
                  {t.label} {ready ? count : ''}
                </button>
              );
            })}
          </div>
          <div className="relative min-w-[160px] max-w-[280px] flex-1">
            <Search size={13} className="absolute left-[10px] top-1/2 -translate-y-1/2 text-ink3" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder="Filter devices…"
              className="h-[33px] w-full rounded-lg border border-line bg-bg pl-[30px] pr-[10px] text-[12.5px] outline-none focus:border-brand"
            />
          </div>
          <div className="flex-1" />
          {canCrud && (
            <button
              onClick={() => setDialog({ device: null })}
              className="flex h-[33px] items-center gap-[7px] rounded-lg bg-ink px-[14px] text-[12.5px] font-semibold text-bg"
            >
              <Plus size={12} strokeWidth={2.4} />
              {tab === 'cam' ? 'Add camera' : tab === 'ap' ? 'Add access point' : 'Add workstation'}
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-3 p-[14px_16px]">
            {['88%', '76%', '92%', '70%', '84%', '64%'].map((w, i) => (
              <div key={i} className="h-[13px] animate-pulse rounded-md bg-line" style={{ width: w }} />
            ))}
          </div>
        ) : (
          <DeviceTable
            tab={tab}
            rows={pageRows}
            canCrud={canCrud}
            floorLabel={floorLabel}
            onEdit={(d) => setDialog({ device: d })}
            onDelete={(d) => setConfirm(d)}
            onOpen={(d) => {
              const fl = d.floorId ? floorById.get(d.floorId) : undefined;
              const to = fl?.kind === 'cctv' ? '/cctv' : '/workstation';
              navigate({ to, search: { floor: d.floorId ?? undefined, focus: d.computerName } });
            }}
          />
        )}

        {ready && filtered.length === 0 && (
          <div className="p-[26px_16px] text-center text-[12.5px] text-ink3">
            {all.length === 0 ? 'No devices for this property.' : 'No devices match your filter.'}
          </div>
        )}

        {ready && filtered.length > 0 && (
          <div className="flex items-center gap-[10px] border-t border-line p-[11px_16px]">
            <span className="text-[12px] text-ink3">
              Showing {curPage * PAGE_SIZE + 1}–{Math.min(filtered.length, (curPage + 1) * PAGE_SIZE)} of{' '}
              {filtered.length}
            </span>
            <div className="flex-1" />
            <PageBtn disabled={curPage === 0} onClick={() => setPage(curPage - 1)}>
              ← Prev
            </PageBtn>
            <PageBtn disabled={curPage >= pageCount - 1} onClick={() => setPage(curPage + 1)}>
              Next →
            </PageBtn>
          </div>
        )}
      </div>

      <DeviceDialog
        open={!!dialog}
        onOpenChange={(v) => !v && setDialog(null)}
        hotelId={activeHotelId}
        tab={tab}
        device={dialog?.device ?? null}
        floors={floors}
      />

      <AlertDialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirm?.computerName}?</AlertDialogTitle>
            <AlertDialogDescription>
              The device is removed from {activeHotel?.name ?? 'this property'}'s inventory and its floor-map pin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={doDelete}
              className="bg-bad text-white hover:bg-bad/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PageBtn({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="h-[30px] rounded-lg border border-line bg-surface px-3 text-[12px] font-semibold text-ink2 hover:bg-surface2 disabled:pointer-events-none disabled:opacity-45"
    >
      {children}
    </button>
  );
}

const HEADERS: Record<DeviceTab, string[]> = {
  ws: ['Computer', 'User', 'Department', 'Floor', 'Type', 'OS'],
  cam: ['Camera', 'Model', 'Zone', 'IP address', 'Resolution'],
  ap: ['AP', 'Model', 'SSID', 'IP address', 'Channel', 'Floor'],
};

function cellsFor(tab: DeviceTab, r: Device, floorLabel: (id: string | null) => string) {
  const dash = (v: string | null | undefined) => v || '—';
  if (tab === 'cam')
    return [
      { t: r.computerName, mono: true, strong: true },
      { t: dash(r.model) },
      { t: dash(r.department) },
      { t: dash(r.ip), mono: true },
      { t: dash(r.resolution) },
    ];
  if (tab === 'ap')
    return [
      { t: r.computerName, mono: true, strong: true },
      { t: dash(r.model) },
      { t: dash(r.ssid) },
      { t: dash(r.ip), mono: true },
      { t: dash(r.channel), mono: true },
      { t: floorLabel(r.floorId) },
    ];
  return [
    { t: r.computerName, mono: true, strong: true },
    { t: dash(r.name), strong: true },
    { t: dash(r.department) },
    { t: floorLabel(r.floorId) },
    { t: dash(r.type) },
    { t: dash(r.os) },
  ];
}

function DeviceTable({
  tab,
  rows,
  canCrud,
  floorLabel,
  onEdit,
  onDelete,
  onOpen,
}: {
  tab: DeviceTab;
  rows: Device[];
  canCrud: boolean;
  floorLabel: (id: string | null) => string;
  onEdit: (d: Device) => void;
  onDelete: (d: Device) => void;
  onOpen: (d: Device) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse">
        <thead>
          <tr>
            {HEADERS[tab].map((h) => (
              <th
                key={h}
                className="whitespace-nowrap border-b border-line px-[16px] py-[9px] text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-ink3"
              >
                {h}
              </th>
            ))}
            <th className="border-b border-line px-[16px] py-[9px] text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-ink3">
              Status
            </th>
            <th className="w-[84px] border-b border-line px-[16px] py-[9px]" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              onClick={() => onOpen(r)}
              title="Open on floor plan"
              className="cursor-pointer hover:bg-surface2"
            >
              {cellsFor(tab, r, floorLabel).map((cell, i) => (
                <td
                  key={i}
                  className={cn(
                    'max-w-[220px] truncate border-b border-line2 px-[16px] py-[10px] text-[12.5px]',
                    cell.mono && 'font-mono',
                    cell.strong ? 'font-semibold text-ink' : 'text-ink2'
                  )}
                >
                  {cell.t}
                </td>
              ))}
              <td className="whitespace-nowrap border-b border-line2 px-[16px] py-[10px]">
                <StatusBadge device={r} />
              </td>
              <td className="whitespace-nowrap border-b border-line2 px-[12px] py-[10px]">
                {canCrud && (
                  <div className="flex justify-end gap-[4px]">
                    <button
                      title="Edit"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(r);
                      }}
                      className="flex size-[28px] items-center justify-center rounded-[7px] text-ink3 hover:bg-surface2 hover:text-ink"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      title="Delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(r);
                      }}
                      className="flex size-[28px] items-center justify-center rounded-[7px] text-ink3 hover:bg-bad-soft hover:text-bad"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
