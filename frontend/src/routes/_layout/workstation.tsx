import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useFloors } from '@/lib/devices';
import { FloorMapView } from '@/components/floor-map';
import { FloorTabs } from '@/components/app-shell/floor-tabs';
import { FloorDialog } from '@/components/floor-dialog';
import { useSetPageHeader } from '@/components/app-shell/page-header';
import { ReadOnlyBadge } from '@/components/app-shell/topbar';

type WsSearch = { floor?: string; focus?: string };

export const Route = createFileRoute('/_layout/workstation')({
  validateSearch: (s: Record<string, unknown>): WsSearch => ({
    floor: typeof s.floor === 'string' ? s.floor : undefined,
    focus: typeof s.focus === 'string' ? s.focus : undefined,
  }),
  component: WorkstationMap,
});

function WorkstationMap() {
  const { floor, focus } = Route.useSearch();
  const navigate = useNavigate();
  const { activeHotelId, can } = useAuth();
  const { data: floors = [], isLoading, isError, refetch } = useFloors(activeHotelId, 'workstation');
  const canCrud = can('floors', 'crud');
  const readOnly = !canCrud && can('floors', 'read');
  const [addOpen, setAddOpen] = useState(false);

  // Active floor: the one in the URL, else the first available.
  const activeFloorId = floors.find((f) => f.id === floor)?.id ?? floors[0]?.id ?? '';

  useSetPageHeader(
    {
      title: 'Workstation map',
      badge: readOnly ? <ReadOnlyBadge /> : undefined,
      actions: (
        <div className="flex items-center gap-2">
          <FloorTabs floors={floors} activeFloorId={activeFloorId} to="/workstation" />
          {canCrud && (
            <button
              onClick={() => setAddOpen(true)}
              className="flex h-[30px] items-center gap-[6px] rounded-lg border border-line bg-surface px-[11px] text-[12px] font-semibold text-ink2 hover:text-ink"
            >
              <Plus size={14} />
              Add floor
            </button>
          )}
        </div>
      ),
    },
    [floors.map((f) => f.id).join(','), activeFloorId, readOnly, canCrud]
  );

  return (
    <>
      <FloorMapView
        kind="workstation"
        hotelId={activeHotelId}
        canEdit={can('floors', 'crud') && can('devices', 'crud')}
        floors={floors}
        activeFloorId={activeFloorId}
        focus={focus}
        isLoading={isLoading}
        isError={isError}
        onRefresh={() => refetch()}
      />
      <FloorDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        hotelId={activeHotelId}
        defaultKind="workstation"
        onCreated={(f) => navigate({ to: '/workstation', search: { floor: f.id } })}
      />
    </>
  );
}
