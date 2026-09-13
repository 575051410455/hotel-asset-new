import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Search, Plus, Minus, Maximize, RotateCw, RotateCcw, X, Crosshair,
  Cctv, Wifi, Monitor, Pencil, Trash2, Copy, Check,
} from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { DeviceDialog, type DeviceTab } from '@/components/device-dialog';
import {
  placementState,
  placementOptionsToRender,
  placementHint,
  type PlacementTab,
} from '@/lib/floor-placement';
import { useDeleteDevice } from '@/lib/devices';
import { buildPinConfig } from '@/lib/pin-config';
import { statusMeta, type Device, type FloorWithPins } from '@/lib/types';
import { cn } from '@/lib/utils';

type View = { x: number; y: number; z: number };
type Kind = 'workstation' | 'cctv';

// Live monitoring auto-refreshes the floor data on a fixed cadence (matches the
// prototype's auto-refresh interval indicator).
const AUTO_REFRESH_SEC = 60;

function normPinStatus(d: Device | undefined, isCam: boolean): string {
  if (d && statusMeta(d.status) && ['active', 'paused', 'nodata', 'rec', 'offline'].includes(d.status))
    return d.status;
  return isCam ? 'offline' : 'nodata';
}

export function FloorMapView({
  kind,
  hotelId,
  canEdit = false,
  floors,
  activeFloorId,
  focus,
  isLoading,
  isFetching,
  isError,
  onRefresh,
}: {
  kind: Kind;
  hotelId: string | null;
  canEdit?: boolean;
  floors: FloorWithPins[];
  activeFloorId: string;
  focus?: string;
  isLoading: boolean;
  // True during background refetches too (React Query keeps isLoading false once
  // data is cached). Drives the auto-refresh indicator; falls back to isLoading.
  isFetching?: boolean;
  isError: boolean;
  onRefresh: () => void;
}) {
  const fetching = isFetching ?? isLoading;
  const isCam = kind === 'cctv';
  const floor = useMemo(
    () => floors.find((f) => f.id === activeFloorId) ?? floors[0],
    [floors, activeFloorId]
  );
  const aspect = floor?.aspect ?? 0.75;

  const canvasRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ cw: 0, ch: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, z: 1 });
  const [fitZ, setFitZ] = useState(1);
  const [animating, setAnimating] = useState(false);
  const userZoomed = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const aspectRef = useRef(aspect);
  aspectRef.current = aspect;

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // ── pin editing (floors:crud / cctv:crud) ──────────────────────────────────
  const queryClient = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  // Coordinates captured when Edit mode is entered — drives the "N moved"
  // counter and Reset (revert this session's moves to where they started).
  const [baseline, setBaseline] = useState<Record<string, { x: number; y: number }>>({});
  const [copied, setCopied] = useState(false);
  const [editDevice, setEditDevice] = useState<Device | null>(null);
  const deleteDevice = useDeleteDevice(hotelId);
  // Live + optimistic positions, applied on top of server data while a PATCH
  // is in flight so the pin never snaps back.
  const [livePos, setLivePos] = useState<Record<string, { x: number; y: number }>>({});
  const livePosRef = useRef(livePos);
  livePosRef.current = livePos;
  const dragRef = useRef<{ id: number; name: string; moved: boolean } | null>(null);

  // ── click-to-place new devices (devices:crud) ───────────────────────────────
  const [placeType, setPlaceType] = useState<DeviceTab | null>(null);
  const [placePos, setPlacePos] = useState<{ x: number; y: number } | null>(null);
  const [placeOpen, setPlaceOpen] = useState(false);
  const placeTypeRef = useRef(placeType);
  placeTypeRef.current = placeType;

  // What you can drop on this floor, and why you can't — decided in lib so the
  // rule is testable and cannot drift between screens.
  const placement = placementState(floor, canEdit);
  const canPlace = placement.canPlace;
  const PLACE_ICON: Record<PlacementTab, typeof Cctv> = { cam: Cctv, ws: Monitor, ap: Wifi };
  const placeOptions = placementOptionsToRender(floor, canEdit);
  const placeNoun = placeOptions.find((o) => o.tab === placeType)?.noun ?? 'a device';

  // ── auto-refresh (live countdown + "last updated") ──────────────────────────
  const [countdown, setCountdown] = useState(AUTO_REFRESH_SEC);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const movePin = useMutation({
    mutationFn: (v: { id: number; name: string; x: number; y: number }) =>
      api.devices[':id'].$patch({ param: { id: String(v.id) }, json: { x: v.x, y: v.y } }).then(unwrap),
    onSuccess: async (_d, v) => {
      if (hotelId) await queryClient.invalidateQueries({ queryKey: ['floors', hotelId] });
      setLivePos((prev) => {
        const next = { ...prev };
        delete next[v.name];
        return next;
      });
    },
    onError: (_e, v) => {
      toast.error('Could not move pin');
      setLivePos((prev) => {
        const next = { ...prev };
        delete next[v.name];
        return next;
      });
    },
  });

  const startPinDrag = useCallback(
    (e: React.PointerEvent, pin: Device) => {
      if (!editMode) return;
      e.stopPropagation();
      dragRef.current = { id: pin.id, name: pin.computerName, moved: false };
      const onMove = (ev: PointerEvent) => {
        const d = dragRef.current;
        const node = canvasRef.current;
        if (!d || !node) return;
        const rect = node.getBoundingClientRect();
        const v = viewRef.current;
        const { cw } = sizeRef.current;
        const a = aspectRef.current;
        const fx = Math.min(1, Math.max(0, (ev.clientX - rect.left - v.x) / (cw * v.z)));
        const fy = Math.min(1, Math.max(0, (ev.clientY - rect.top - v.y) / (cw * a * v.z)));
        d.moved = true;
        setLivePos((prev) => ({ ...prev, [d.name]: { x: +(fx * 100).toFixed(1), y: +(fy * 100).toFixed(1) } }));
      };
      const onUp = () => {
        const d = dragRef.current;
        dragRef.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (d?.moved) {
          const pos = livePosRef.current[d.name];
          if (pos) movePin.mutate({ id: d.id, name: d.name, x: pos.x, y: pos.y });
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [editMode, movePin]
  );

  // Leaving edit mode (or losing the permission) clears any selection.
  useEffect(() => {
    if (!editMode) return;
    setSelectedId(null);
    setDrawerOpen(false);
  }, [editMode]);
  useEffect(() => {
    if (!canEdit && editMode) setEditMode(false);
  }, [canEdit, editMode]);

  // Snapshot pin positions when entering Edit mode (or switching floor while in
  // it) so "N moved" and Reset have a baseline to compare/revert against.
  useEffect(() => {
    if (!editMode) {
      setBaseline({});
      return;
    }
    const snap: Record<string, { x: number; y: number }> = {};
    (floor?.pins ?? []).forEach((p) => {
      if (p.x != null && p.y != null) snap[p.computerName] = { x: p.x, y: p.y };
    });
    setBaseline(snap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, floor?.id]);

  // Convert a click on the canvas to %-coords on the plan, then open the
  // pre-filled device dialog so the new pin lands exactly where you clicked.
  const placeAt = useCallback((clientX: number, clientY: number) => {
    const node = canvasRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const v = viewRef.current;
    const { cw } = sizeRef.current;
    const a = aspectRef.current;
    if (!cw) return;
    const fx = Math.min(1, Math.max(0, (clientX - rect.left - v.x) / (cw * v.z)));
    const fy = Math.min(1, Math.max(0, (clientY - rect.top - v.y) / (cw * a * v.z)));
    setPlacePos({ x: +(fx * 100).toFixed(1), y: +(fy * 100).toFixed(1) });
    setPlaceOpen(true);
  }, []);

  // Esc cancels place mode; losing edit rights cancels it too.
  useEffect(() => {
    if (!placeType) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPlaceType(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [placeType]);
  // Switching to a floor that can't take pins (no plan yet) cancels place mode
  // too, so a stray click can't drop one after the buttons have gone disabled.
  useEffect(() => {
    if (!canPlace) setPlaceType(null);
  }, [canPlace]);

  // Stamp the last-updated time and reset the countdown whenever a fetch settles.
  const wasFetchingRef = useRef(false);
  useEffect(() => {
    const settled = !fetching && !isError;
    if ((wasFetchingRef.current && settled) || (settled && lastUpdated === null)) {
      setLastUpdated(Date.now());
      setCountdown(AUTO_REFRESH_SEC);
    }
    wasFetchingRef.current = fetching;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetching, isError]);

  // Tick the countdown down each second — paused while hidden, fetching, dragging
  // a pin, or with the place dialog open.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.hidden || fetching || isError || dragRef.current || placeOpen) return;
      setCountdown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [fetching, isError, placeOpen]);

  // When the countdown elapses, refetch and reset it.
  useEffect(() => {
    if (countdown === 0 && !fetching && !isError) {
      setCountdown(AUTO_REFRESH_SEC);
      onRefresh();
    }
  }, [countdown, fetching, isError, onRefresh]);

  const pins = floor?.pins ?? [];
  const byName = useMemo(() => {
    const m = new Map<string, Device>();
    pins.forEach((p) => m.set(p.computerName, p));
    return m;
  }, [pins]);

  // Pins whose position changed since Edit mode was entered.
  const movedPins = pins.filter((p) => {
    const b = baseline[p.computerName];
    return b && p.x != null && p.y != null && (Math.abs(b.x - p.x) > 0.05 || Math.abs(b.y - p.y) > 0.05);
  });
  const movedCount = movedPins.length;

  // Copy the floor's pin layout as a paste-ready config block.
  const copyConfig = async () => {
    try {
      await navigator.clipboard.writeText(buildPinConfig(pins, isCam));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  // Revert this session's moves back to where they were when Edit mode started.
  const resetMoves = async () => {
    if (movedPins.length === 0) return;
    const n = movedPins.length;
    if (!window.confirm(`Revert ${n} pin${n > 1 ? 's' : ''} to ${n > 1 ? 'their' : 'its'} position when Edit mode started?`)) return;
    try {
      await Promise.all(
        movedPins.map((p) =>
          api.devices[':id'].$patch({ param: { id: String(p.id) }, json: baseline[p.computerName] }).then(unwrap)
        )
      );
      if (hotelId) await queryClient.invalidateQueries({ queryKey: ['floors', hotelId] });
      toast.success(`Reverted ${n} move${n > 1 ? 's' : ''}`);
    } catch {
      toast.error('Could not reset positions');
    }
  };

  // Delete a pin (and its device row) from the detail drawer.
  const deleteSelected = (d: Device) => {
    if (!window.confirm(`Delete ${d.computerName}? It is removed from the inventory and the map.`)) return;
    deleteDevice.mutate(d.id, {
      onSuccess: () => {
        toast.success(`${d.computerName} deleted`);
        setDrawerOpen(false);
        setSelectedId(null);
      },
      onError: (e: Error) => toast.error(e.message),
    });
  };

  // Tab for the edit dialog: cameras on a cctv floor, else AP vs workstation.
  const editTab: DeviceTab = isCam ? 'cam' : editDevice?.isAp ? 'ap' : 'ws';

  // ── view math (ported from the prototype) ──────────────────────────────────
  const applyView = useCallback((v: View, animate: boolean, nextFit?: number) => {
    setView(v);
    if (nextFit !== undefined) setFitZ(nextFit);
    if (animate) {
      setAnimating(true);
      window.setTimeout(() => setAnimating(false), 420);
    } else {
      setAnimating(false);
    }
  }, []);

  const measure = useCallback(() => {
    const node = canvasRef.current;
    if (!node) return;
    const r = node.getBoundingClientRect();
    if (r.width < 5 || r.height < 5) return;
    const a = aspectRef.current;
    const f = Math.min(1, r.height / (r.width * a));
    setSize({ cw: r.width, ch: r.height });
    setFitZ(f);
    if (!userZoomed.current) {
      setView({ x: (r.width - r.width * f) / 2, y: (r.height - r.width * a * f) / 2, z: f });
      setAnimating(false);
    }
  }, []);

  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(node);
    measure();
    return () => ro.disconnect();
  }, [measure]);

  // Re-fit when the floor (and thus aspect) changes.
  useEffect(() => {
    userZoomed.current = false;
    setSelectedId(null);
    setDrawerOpen(false);
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor?.id]);

  // Wheel zoom (non-passive).
  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = node.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const v = viewRef.current;
      const z2 = Math.min(9, Math.max(fitZ * 0.5, v.z * Math.exp(-e.deltaY * 0.0016)));
      const k = z2 / v.z;
      userZoomed.current = true;
      applyView({ x: mx - (mx - v.x) * k, y: my - (my - v.y) * k, z: z2 }, false);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [fitZ, applyView]);

  const zoomBy = (f: number) => {
    const v = viewRef.current;
    const { cw, ch } = sizeRef.current;
    const z2 = Math.min(9, Math.max(fitZ * 0.5, v.z * f));
    const k = z2 / v.z;
    userZoomed.current = true;
    applyView({ x: cw / 2 - (cw / 2 - v.x) * k, y: ch / 2 - (ch / 2 - v.y) * k, z: z2 }, true);
  };

  const fitView = () => {
    userZoomed.current = false;
    const { cw, ch } = sizeRef.current;
    if (!cw || !ch) return;
    const a = aspectRef.current;
    const z = Math.min(1, ch / (cw * a));
    applyView({ x: (cw - cw * z) / 2, y: (ch - cw * a * z) / 2, z }, true, z);
  };

  const focusPin = useCallback(
    (id: string) => {
      const pin = byName.get(id);
      const { cw, ch } = sizeRef.current;
      if (!pin || pin.x == null || pin.y == null || !cw) return;
      const a = aspectRef.current;
      const z = Math.max(fitZ * 2.1, 1.0);
      userZoomed.current = true;
      applyView(
        { x: cw / 2 - (pin.x / 100) * cw * z, y: ch / 2 - (pin.y / 100) * cw * a * z, z },
        true
      );
    },
    [byName, fitZ, applyView]
  );

  // Pan with pointer.
  const panState = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const onCanvasDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const v = viewRef.current;
    panState.current = { sx: e.clientX, sy: e.clientY, ox: v.x, oy: v.y, moved: false };
    const onMove = (ev: PointerEvent) => {
      const p = panState.current;
      if (!p) return;
      const dx = ev.clientX - p.sx;
      const dy = ev.clientY - p.sy;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) p.moved = true;
      if (p.moved) {
        userZoomed.current = true;
        applyView({ ...viewRef.current, x: p.ox + dx, y: p.oy + dy }, false);
      }
    };
    const onUp = () => {
      const p = panState.current;
      panState.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (p && !p.moved) {
        if (placeTypeRef.current) {
          placeAt(p.sx, p.sy); // a click in place mode drops a new pin here
        } else {
          setSelectedId(null);
          setDrawerOpen(false);
        }
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Focus-on-load from a deep link (dashboard "open on floor plan").
  const focusedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focus || isLoading || !floor) return;
    if (focusedRef.current === focus) return;
    if (!byName.has(focus)) return;
    focusedRef.current = focus;
    setSelectedId(focus);
    setDrawerOpen(true);
    const t = window.setTimeout(() => focusPin(focus), 140);
    return () => window.clearTimeout(t);
  }, [focus, isLoading, floor, byName, focusPin]);

  // ── derived ────────────────────────────────────────────────────────────────
  const norm = (d: Device | undefined) => normPinStatus(d, isCam);
  const counts = { total: pins.length, active: 0, paused: 0, nodata: 0, rec: 0, offline: 0 };
  pins.forEach((p) => {
    counts[norm(p) as keyof typeof counts]++;
  });

  const q = search.trim().toLowerCase();
  const matches = (p: Device) => {
    const st = norm(p);
    if (statusFilter !== 'all' && st !== statusFilter) return false;
    if (!q) return true;
    return [p.name, p.computerName, p.department, p.model].filter(Boolean).join(' ').toLowerCase().includes(q);
  };

  const departments = floor?.departments ?? [];
  const groups = departments
    .map((dept) => ({
      dept,
      items: pins.filter((p) => p.department === dept && matches(p)),
    }))
    .filter((g) => g.items.length > 0);

  const autoLabels = view.z >= Math.max(0.9, fitZ * 1.5);
  const pinScale = Math.min(1.7, Math.max(0.55, 1 / view.z));

  const selected = selectedId ? byName.get(selectedId) : undefined;

  const statChips = isCam
    ? [
        { label: 'Cameras', count: counts.total, color: '' },
        { label: 'Online', count: counts.active, color: 'var(--ok)' },
        { label: 'Recording', count: counts.rec, color: 'var(--bad)' },
        { label: 'Offline', count: counts.offline, color: 'var(--offline)' },
      ]
    : [
        { label: 'Total', count: counts.total, color: '' },
        { label: 'Online', count: counts.active, color: 'var(--ok)' },
        { label: 'Paused', count: counts.paused, color: 'var(--warn)' },
        { label: 'No data', count: counts.nodata, color: 'var(--nodata)' },
      ];

  const filterDefs = isCam
    ? [{ key: 'all', label: `All ${counts.total || ''}` }, { key: 'active', label: 'Online' }, { key: 'rec', label: 'REC' }, { key: 'offline', label: 'Offline' }]
    : [{ key: 'all', label: `All ${counts.total || ''}` }, { key: 'active', label: 'Online' }, { key: 'paused', label: 'Paused' }, { key: 'nodata', label: 'No data' }];

  const legendRows = isCam
    ? [{ label: 'Online', color: 'var(--ok)' }, { label: 'Recording', color: 'var(--bad)' }, { label: 'Offline', color: 'var(--offline)' }]
    : [{ label: 'Online', color: 'var(--ok)' }, { label: 'Paused', color: 'var(--warn)' }, { label: 'No data', color: 'var(--nodata)' }];

  const select = (id: string) => {
    setSelectedId(id);
    setDrawerOpen(true);
    focusPin(id);
  };

  const ready = !isLoading && !isError;
  const isEmpty = ready && pins.length === 0;

  const secsAgo = lastUpdated !== null ? Math.floor((Date.now() - lastUpdated) / 1000) : null;
  const lastUpdatedText =
    secsAgo === null
      ? ''
      : secsAgo < 5
        ? 'Updated just now'
        : secsAgo < 60
          ? `Updated ${secsAgo}s ago`
          : `Updated ${Math.floor(secsAgo / 60)}m ago`;
  const countdownText = fetching ? 'Refreshing…' : `Auto-refresh in ${countdown}s`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Summary strip */}
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2">
        {statChips.map((c) => (
          <div
            key={c.label}
            className="flex items-center gap-[7px] whitespace-nowrap rounded-full border border-line bg-surface2 px-3 py-[5px] text-[12.5px] text-ink2"
          >
            {c.color && <span className="size-2 rounded-full" style={{ background: c.color }} />}
            <span>{c.label}</span>
            <strong className="font-bold text-ink">{ready ? c.count : '—'}</strong>
          </div>
        ))}
        <div className="flex-1" />
        {lastUpdated !== null && (
          <div className="flex items-center gap-2 whitespace-nowrap text-[12px] text-ink3">
            {lastUpdatedText && <span className="hidden sm:inline">{lastUpdatedText}</span>}
            {lastUpdatedText && <span className="hidden sm:inline">·</span>}
            <span className="tabular-nums">{countdownText}</span>
          </div>
        )}
        {canEdit && (
          <>
            {placeOptions.map((o) => {
              const on = placeType === o.tab;
              const Icon = PLACE_ICON[o.tab];
              return (
                <button
                  key={o.tab}
                  onClick={() => {
                    setEditMode(false);
                    setPlaceType((t) => (t === o.tab ? null : o.tab));
                  }}
                  // Shown but disabled without a floor plan: a pin placed on
                  // blank space is measured against a placeholder aspect ratio
                  // and moves once the real plan arrives.
                  disabled={!canPlace}
                  title={placementHint(floor, canEdit, o)}
                  className={cn(
                    'flex h-[30px] items-center gap-[6px] rounded-lg border px-[11px] text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-50',
                    on ? 'border-brand bg-brand text-brand-foreground' : 'border-line bg-surface text-ink2 hover:text-ink'
                  )}
                >
                  <Icon size={13} />
                  {o.label}
                </button>
              );
            })}
            <button
              onClick={() => {
                setPlaceType(null);
                setEditMode((v) => !v);
              }}
              title="Reposition pins on the floor plan"
              className={cn(
                'flex h-[30px] items-center gap-[6px] rounded-lg border px-[11px] text-[12px] font-semibold',
                editMode ? 'border-brand bg-brand text-brand-foreground' : 'border-line bg-surface text-ink2 hover:text-ink'
              )}
            >
              {editMode ? <Check size={13} /> : <Pencil size={13} />}
              {editMode ? 'Done' : 'Edit pins'}
            </button>
          </>
        )}
        <button
          onClick={onRefresh}
          title="Refresh now"
          className="flex size-[30px] items-center justify-center rounded-lg border border-line bg-surface text-ink2 hover:bg-surface2 hover:text-ink"
        >
          <RotateCw size={14} className={fetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Body: list + map + drawer */}
      <div className="relative flex min-h-0 flex-1">
        {/* List panel */}
        <div className="hidden w-[296px] flex-none flex-col border-r border-line bg-surface lg:flex">
          <div className="flex flex-col gap-2 p-[12px_12px_8px]">
            <div className="relative">
              <Search size={14} className="absolute left-[10px] top-1/2 -translate-y-1/2 text-ink3" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, computer, dept…"
                className="h-[34px] w-full rounded-lg border border-line bg-bg pl-[31px] pr-[10px] text-[12.5px] outline-none focus:border-brand"
              />
            </div>
            <div className="flex gap-[5px]">
              {filterDefs.map((f) => {
                const active = statusFilter === f.key;
                return (
                  <button
                    key={f.key}
                    onClick={() => setStatusFilter(f.key)}
                    className={cn(
                      'flex-1 whitespace-nowrap rounded-[7px] border px-[2px] py-[5px] text-[11px] font-semibold',
                      active ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface text-ink2'
                    )}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-3">
            {groups.map((g) => (
              <div key={g.dept}>
                <div className="flex items-baseline gap-[6px] px-[14px] pb-[5px] pt-3">
                  <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink3">{g.dept}</span>
                  <span className="text-[10.5px] font-semibold text-ink3/75">{g.items.length}</span>
                </div>
                {g.items.map((p) => {
                  const meta = statusMeta(norm(p));
                  const sel = selectedId === p.computerName;
                  return (
                    <div
                      key={p.id}
                      onClick={() => select(p.computerName)}
                      className={cn(
                        'mx-2 mb-[2px] flex cursor-pointer items-center gap-[9px] rounded-lg border px-[9px] py-[7px]',
                        sel ? 'border-brand bg-brand-soft' : 'border-transparent hover:bg-surface2'
                      )}
                    >
                      <span className="size-[9px] flex-none rounded-full" style={{ background: meta.color }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-ink">
                          {isCam ? p.computerName : p.name || p.computerName}
                        </span>
                        <span className="block truncate font-mono text-[10.5px] text-ink3">
                          {isCam ? p.model || '—' : p.computerName}
                        </span>
                      </span>
                      <span className="flex-none text-[10px] font-bold tracking-[0.04em]" style={{ color: meta.color }}>
                        {meta.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
            {ready && groups.length === 0 && (
              <div className="px-4 py-7 text-center text-[12.5px] text-ink3">
                Nothing to show — adjust the search or filter.
              </div>
            )}
          </div>
        </div>

        {/* Map canvas */}
        <div
          className="relative min-w-0 flex-1 overflow-hidden"
          style={{ backgroundImage: 'radial-gradient(var(--line) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
        >
          <div
            ref={canvasRef}
            onPointerDown={onCanvasDown}
            className="absolute inset-0 overflow-hidden"
            style={{ cursor: placeType ? 'crosshair' : 'grab', touchAction: 'none' }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: `${size.cw}px`,
                height: `${size.cw * aspect}px`,
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
                transformOrigin: '0 0',
                transition: animating ? 'transform 0.4s cubic-bezier(0.2,0.8,0.2,1)' : 'none',
                willChange: 'transform',
              }}
            >
              <div className="absolute inset-0 overflow-hidden rounded-md border border-line bg-white shadow-[var(--shadow)]">
                {floor?.image && (
                  <img
                    src={floor.image}
                    alt={`${floor.name} plan`}
                    draggable={false}
                    className="pointer-events-none size-full select-none"
                  />
                )}
              </div>
              {ready &&
                pins.map((p) => {
                  const live = livePos[p.computerName];
                  const px = live ? live.x : p.x;
                  const py = live ? live.y : p.y;
                  if (px == null || py == null) return null;
                  const st = norm(p);
                  const meta = statusMeta(st);
                  const isAp = p.isAp;
                  const sel = selectedId === p.computerName;
                  const hov = hoveredId === p.computerName;
                  const visible = matches(p);
                  const dragging = !!live;
                  const showLabel = editMode || sel || hov || autoLabels;
                  const ping = editMode || st === 'nodata' || st === 'offline' ? 'none' : st;
                  return (
                    <Pin
                      key={p.id}
                      x={px}
                      y={py}
                      scale={pinScale}
                      z={dragging || sel || hov ? 6 : 2}
                      opacity={visible ? 1 : 0.22}
                      color={meta.color}
                      isCam={isCam}
                      isAp={isAp}
                      dir={p.dir ?? 0}
                      coneVisible={isCam && visible}
                      rangeVisible={isAp && visible}
                      ping={ping}
                      selected={sel}
                      editMode={editMode}
                      interactive={!placeType}
                      showLabel={showLabel}
                      label={isCam ? p.computerName : p.name || p.computerName}
                      onEnter={() => setHoveredId(p.computerName)}
                      onLeave={() => setHoveredId(null)}
                      onDragStart={(e) => startPinDrag(e, p)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!editMode) select(p.computerName);
                      }}
                    />
                  );
                })}
            </div>
          </div>

          {/* Zoom controls */}
          <div className="absolute right-[14px] top-[14px] z-30 flex flex-col gap-[6px]">
            <ZoomBtn title="Zoom in" onClick={() => zoomBy(1.45)}>
              <Plus size={14} />
            </ZoomBtn>
            <ZoomBtn title="Zoom out" onClick={() => zoomBy(1 / 1.45)}>
              <Minus size={14} />
            </ZoomBtn>
            <ZoomBtn title="Fit to view" onClick={fitView}>
              <Maximize size={14} />
            </ZoomBtn>
          </div>

          {/* Legend */}
          <div className="absolute bottom-[14px] left-[14px] z-30 flex flex-col gap-[7px] rounded-[10px] border border-line bg-surface p-[10px_13px] shadow-[var(--shadow)]">
            <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink3">Pin status</div>
            {legendRows.map((lr) => (
              <div key={lr.label} className="flex items-center gap-2 text-[12px] text-ink2">
                <span className="size-[9px] flex-none rounded-full" style={{ background: lr.color }} />
                {lr.label}
              </div>
            ))}
            <div className="max-w-[150px] border-t border-line2 pt-[7px] text-[10.5px] leading-[1.45] text-ink3">
              {editMode ? 'Drag a pin to reposition it' : 'Scroll to zoom · drag to pan · click a pin for specs'}
            </div>
          </div>

          {/* Edit-mode toolbar */}
          {editMode && (
            <div className="absolute bottom-[14px] left-1/2 z-[35] flex max-w-[calc(100%-28px)] -translate-x-1/2 flex-wrap items-center justify-center gap-[8px] rounded-xl border-[1.5px] border-brand bg-surface p-[7px_12px] shadow-[var(--shadow)]">
              <span className="whitespace-nowrap text-[12px] font-semibold text-ink">
                Edit mode — drag pins to reposition
              </span>
              <span className="whitespace-nowrap text-[11.5px] tabular-nums text-ink3">{movedCount} moved</span>
              <span className="h-4 w-px bg-line" />
              <button
                onClick={copyConfig}
                title="Copy this floor's pin layout as a config block"
                className="flex h-[28px] items-center gap-[5px] rounded-[7px] border border-line bg-surface px-[10px] text-[11.5px] font-semibold text-ink2 hover:text-ink"
              >
                {copied ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
                {copied ? 'Copied' : 'Copy config'}
              </button>
              <button
                onClick={resetMoves}
                disabled={movedCount === 0}
                title="Revert this session's moves"
                className="flex h-[28px] items-center gap-[5px] rounded-[7px] border border-line bg-surface px-[10px] text-[11.5px] font-semibold text-ink2 hover:text-ink disabled:opacity-45"
              >
                <RotateCcw size={13} />
                Reset
              </button>
            </div>
          )}

          {/* Place-mode banner */}
          {placeType && !placeOpen && (
            <div className="absolute bottom-[14px] left-1/2 z-[35] flex -translate-x-1/2 items-center gap-[8px] rounded-xl border-[1.5px] border-brand bg-surface p-[8px_14px] shadow-[var(--shadow)]">
              <Crosshair size={14} className="text-brand" />
              <span className="whitespace-nowrap text-[12px] font-semibold text-ink">
                Click on the map to place {placeNoun}
              </span>
              <span className="whitespace-nowrap text-[11.5px] text-ink3">Esc to cancel</span>
            </div>
          )}

          {/* Overlays */}
          {isLoading && (
            <Overlay>
              <RotateCw size={22} className="animate-spin text-brand" />
              <div className="text-[13px] font-semibold text-ink">Loading {isCam ? 'cameras' : 'workstations'}…</div>
            </Overlay>
          )}
          {isError && (
            <Overlay>
              <div className="text-[13.5px] font-bold text-ink">Couldn't load floor data</div>
              <button
                onClick={onRefresh}
                className="mt-1 h-8 rounded-lg bg-brand px-[18px] text-[12.5px] font-semibold text-brand-foreground"
              >
                Retry
              </button>
            </Overlay>
          )}
          {isEmpty && (
            <Overlay>
              <div className="text-[13.5px] font-bold text-ink">No {isCam ? 'cameras' : 'devices'} on this floor</div>
              {/* Two different situations that used to share one misleading
                  message: the floor genuinely has no plan yet, or it has one
                  and simply nothing placed. They need different next steps. */}
              <div className="max-w-[280px] text-center text-[12px] text-ink3">
                {floor && !floor.image
                  ? 'Upload a floor plan for this floor, then place pins on it.'
                  : `Use ${isCam ? 'Add camera' : 'Add workstation'} to place the first pin.`}
              </div>
            </Overlay>
          )}
        </div>

        {/* Detail drawer */}
        {drawerOpen && selected && floor && (
          <DetailDrawer
            device={selected}
            floor={floor}
            isCam={isCam}
            canEdit={canEdit}
            onClose={() => {
              setDrawerOpen(false);
              setSelectedId(null);
            }}
            onFocus={() => focusPin(selected.computerName)}
            onEdit={() => setEditDevice(selected)}
            onDelete={() => deleteSelected(selected)}
          />
        )}

        {/* Click-to-place dialog (pre-filled with the clicked spot) */}
        {floor && (
          <DeviceDialog
            open={placeOpen}
            onOpenChange={(v) => {
              setPlaceOpen(v);
              if (!v) setPlacePos(null);
            }}
            hotelId={hotelId}
            tab={placeType ?? 'ws'}
            device={null}
            floors={floors}
            placement={placePos ? { floorId: floor.id, x: placePos.x, y: placePos.y } : null}
          />
        )}

        {/* Edit-pin dialog (from the detail drawer) */}
        {editDevice && (
          <DeviceDialog
            open={!!editDevice}
            onOpenChange={(v) => {
              if (!v) setEditDevice(null);
            }}
            hotelId={hotelId}
            tab={editTab}
            device={editDevice}
            floors={floors}
          />
        )}
      </div>
    </div>
  );
}

function ZoomBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="flex size-[34px] items-center justify-center rounded-[9px] border border-line bg-surface text-ink2 shadow-[var(--shadow)] hover:text-ink"
    >
      {children}
    </button>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-[38] flex items-center justify-center backdrop-blur-[2px]">
      <div className="flex flex-col items-center gap-[10px] rounded-[14px] border border-line bg-surface p-[22px_30px] shadow-[var(--shadow)]">
        {children}
      </div>
    </div>
  );
}

function Pin(props: {
  x: number;
  y: number;
  scale: number;
  z: number;
  opacity: number;
  color: string;
  isCam: boolean;
  isAp: boolean;
  dir: number;
  coneVisible: boolean;
  rangeVisible: boolean;
  ping: string;
  selected: boolean;
  editMode: boolean;
  interactive: boolean;
  showLabel: boolean;
  label: string;
  onEnter: () => void;
  onLeave: () => void;
  onDragStart: (e: React.PointerEvent) => void;
  onClick: (e: React.PointerEvent) => void;
}) {
  const { color } = props;
  const isDot = !props.isCam && !props.isAp;
  return (
    <div
      onClick={props.onClick as unknown as React.MouseEventHandler}
      onPointerDown={(e) => {
        if (props.editMode) props.onDragStart(e);
        else e.stopPropagation();
      }}
      onMouseEnter={props.onEnter}
      onMouseLeave={props.onLeave}
      style={{
        position: 'absolute',
        left: `${props.x}%`,
        top: `${props.y}%`,
        width: 0,
        height: 0,
        transform: `scale(${props.scale.toFixed(3)})`,
        transformOrigin: '0 0',
        zIndex: props.z,
        opacity: props.opacity,
        cursor: props.editMode ? 'move' : 'pointer',
        transition: 'opacity 0.2s',
        touchAction: props.editMode ? 'none' : undefined,
        pointerEvents: props.interactive ? undefined : 'none',
      }}
    >
      <div style={{ position: 'relative', width: 26, height: 26, margin: '-13px 0 0 -13px' }}>
        {props.coneVisible && (
          <svg
            width="96"
            height="96"
            viewBox="0 0 96 96"
            style={{ position: 'absolute', left: -35, top: -35, transform: `rotate(${props.dir}deg)`, pointerEvents: 'none' }}
          >
            <path d="M48 48 L90 26 A48 48 0 0 1 90 70 Z" style={{ fill: color, opacity: 0.17 }} />
          </svg>
        )}
        {props.rangeVisible && (
          <span
            style={{ position: 'absolute', inset: -16, borderRadius: '50%', background: color, opacity: 0.13, pointerEvents: 'none' }}
          />
        )}
        {props.ping !== 'none' && (
          <span
            className="om-ping"
            style={{ position: 'absolute', inset: 4, borderRadius: '50%', background: color }}
          />
        )}
        {/* Selection ring sits on the always-white plan, so it uses a fixed
            neutral dark (not the theme-inverting --brand) to stay visible. */}
        {props.selected && (
          <span style={{ position: 'absolute', inset: -2, borderRadius: '50%', border: '2px solid oklch(0.205 0 0)' }} />
        )}
        {isDot && (
          <span
            style={{
              position: 'absolute',
              inset: 5,
              borderRadius: '50%',
              background: color,
              border: '2.5px solid #fff',
              boxSizing: 'border-box',
              boxShadow: '0 1px 4px rgba(16,24,40,0.35)',
            }}
          />
        )}
        {props.isCam && (
          <span
            style={{
              position: 'absolute',
              inset: 2,
              borderRadius: 7,
              background: color,
              border: '2px solid #fff',
              boxSizing: 'border-box',
              boxShadow: '0 1px 4px rgba(16,24,40,0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Cctv size={12} color="#fff" />
          </span>
        )}
        {props.isAp && (
          <span
            style={{
              position: 'absolute',
              inset: 2,
              borderRadius: '50%',
              background: color,
              border: '2px solid #fff',
              boxSizing: 'border-box',
              boxShadow: '0 1px 4px rgba(16,24,40,0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Wifi size={12} color="#fff" />
          </span>
        )}
        {props.showLabel && (
          <span
            style={{
              position: 'absolute',
              top: 27,
              left: '50%',
              transform: 'translateX(-50%)',
              whiteSpace: 'nowrap',
              background: props.selected ? 'var(--brand)' : 'var(--surface)',
              color: props.selected ? 'var(--brand-foreground)' : 'var(--ink)',
              fontSize: 11,
              fontWeight: 600,
              padding: '3px 8px',
              borderRadius: 6,
              border: '1px solid var(--line)',
              boxShadow: 'var(--shadow)',
            }}
          >
            {props.label}
          </span>
        )}
      </div>
    </div>
  );
}

function specRowsFor(d: Device, floor: FloorWithPins, isCam: boolean) {
  const dash = (v: string | null | undefined) => v || '—';
  if (d.isAp)
    return [
      ['Access point', d.computerName],
      ['Floor', floor.name],
      ['Model', dash(d.model)],
      ['IP address', dash(d.ip)],
      ['SSID', dash(d.ssid)],
      ['Band', dash(d.band)],
      ['Channel', dash(d.channel)],
      ['Active clients', dash(d.clients)],
    ];
  if (isCam)
    return [
      ['Camera', d.computerName],
      ['Zone', dash(d.department)],
      ['Floor', floor.name],
      ['Model', dash(d.model)],
      ['IP address', dash(d.ip)],
      ['Resolution', dash(d.resolution)],
      ['Lens', dash(d.lens)],
      ['Retention', dash(d.retention)],
      ['Recorder', dash(d.nvr)],
    ];
  return [
    ['Computer', d.computerName],
    ['User', dash(d.name)],
    ['Department', dash(d.department)],
    ['Floor', floor.name],
    ['Type', dash(d.type)],
    ['OS', dash(d.os)],
    ['CPU', dash(d.cpu)],
    ['RAM', dash(d.ram)],
    ['Motherboard', dash(d.motherboard)],
    ['Graphics', dash(d.graphics)],
    ['Storage', dash(d.storage)],
    ['Monitor', dash(d.monitor)],
  ];
}

function DetailDrawer({
  device,
  floor,
  isCam,
  canEdit,
  onClose,
  onFocus,
  onEdit,
  onDelete,
}: {
  device: Device;
  floor: FloorWithPins;
  isCam: boolean;
  canEdit: boolean;
  onClose: () => void;
  onFocus: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const st = normPinStatus(device, isCam);
  const meta = statusMeta(st);
  const rows = specRowsFor(device, floor, isCam);
  const offline = st === 'offline';

  return (
    <div className="absolute inset-y-0 right-0 z-40 flex w-full flex-col border-l border-line bg-surface shadow-[-12px_0_32px_rgba(16,24,40,0.12)] sm:w-[340px]">
      <div className="border-b border-line p-[16px_18px_14px]">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-[6px] rounded-full px-[10px] py-[3px] text-[10.5px] font-bold tracking-[0.05em]"
            style={{ background: meta.soft, color: meta.color }}
          >
            <span className="size-[7px] rounded-full bg-current" />
            {meta.label}
          </span>
          <div className="flex-1" />
          <button
            onClick={onClose}
            title="Close"
            className="flex size-[28px] items-center justify-center rounded-[7px] text-ink3 hover:bg-surface2 hover:text-ink"
          >
            <X size={13} />
          </button>
        </div>
        <div className="mt-[10px] font-mono text-[18px] font-bold tracking-[-0.01em]">{device.computerName}</div>
        <div className="mt-[3px] text-[13px] text-ink2">
          {(isCam ? device.model : device.name) || '—'} · {device.department || '—'} · {floor.name}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-[6px_18px_12px]">
        {isCam && (
          <div
            className="relative mb-[6px] mt-[12px] aspect-video overflow-hidden rounded-[10px] border border-line"
            style={{ background: 'linear-gradient(135deg, #17212D 0%, #0A0F15 100%)' }}
          >
            <div
              className="absolute inset-0"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(0deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 1px, transparent 1px, transparent 4px)',
              }}
            />
            {!offline && (
              <div className="absolute left-[10px] top-[10px] flex items-center gap-[6px] rounded-[5px] bg-black/45 px-[9px] py-[3px] text-[10px] font-bold tracking-[0.1em] text-[#FF5C5C]">
                <span className="size-[7px] rounded-full bg-[#FF5C5C]" />
                LIVE
              </div>
            )}
            <div className="absolute right-[10px] top-[10px] font-mono text-[10.5px] text-white/75">{device.computerName}</div>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/40">
              <Cctv size={26} />
              <span className="text-[10.5px] font-semibold tracking-[0.14em]">
                {offline ? 'NO SIGNAL' : 'LIVE PREVIEW'}
              </span>
            </div>
          </div>
        )}
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="grid grid-cols-[112px_1fr] items-baseline gap-[10px] border-b border-line2 py-[9px]"
          >
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-ink3">{k}</span>
            <span className="font-mono text-[12px] leading-[1.5] text-ink [overflow-wrap:anywhere]">{v}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-2 border-t border-line p-[12px_18px]">
        <button
          onClick={onFocus}
          className="flex h-9 flex-1 items-center justify-center gap-[7px] rounded-[9px] bg-brand text-[13px] font-semibold text-brand-foreground"
        >
          <Crosshair size={14} />
          Focus on map
        </button>
        {canEdit && (
          <button
            onClick={onEdit}
            title="Edit details"
            className="flex size-9 items-center justify-center rounded-[9px] border border-line bg-surface text-ink2 hover:text-ink"
          >
            <Pencil size={15} />
          </button>
        )}
        {canEdit && (
          <button
            onClick={onDelete}
            title="Delete"
            className="flex size-9 items-center justify-center rounded-[9px] border border-line bg-surface text-ink2 hover:border-bad hover:text-bad"
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
