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

type CctvSearch = { floor?: string; focus?: string };

export const Route = createFileRoute('/_layout/cctv')({
  validateSearch: (s: Record<string, unknown>): CctvSearch => ({
    floor: typeof s.floor === 'string' ? s.floor : undefined,
    focus: typeof s.focus === 'string' ? s.focus : undefined,
  }),
  component: CctvMap,
});

function CctvMap() {
  const { floor, focus } = Route.useSearch();
  const navigate = useNavigate();
  const { activeHotelId, can } = useAuth();
  const { data: floors = [], isLoading, isFetching, isError, refetch } = useFloors(activeHotelId, 'cctv');
  // Creating a floor (and uploading its plan) is a `floors:crud` capability
  // server-side, even for CCTV-kind floors.
  const canCrud = can('floors', 'crud');
  const readOnly = !can('cctv', 'crud') && can('cctv', 'read');
  const [addOpen, setAddOpen] = useState(false);

  const activeFloorId = floors.find((f) => f.id === floor)?.id ?? floors[0]?.id ?? '';

  useSetPageHeader(
    {
      title: 'CCTV map',
      subtitle: 'Camera coverage & live status',
      badge: readOnly ? <ReadOnlyBadge /> : undefined,
      actions: (
        <div className="flex items-center gap-2">
          <FloorTabs floors={floors} activeFloorId={activeFloorId} to="/cctv" />
          {canCrud && (
            <button
              onClick={() => setAddOpen(true)}
              className="flex h-[30px] items-center gap-[6px] rounded-lg border border-line bg-surface px-[11px] text-[12px] font-semibold text-ink2 hover:text-ink"
            >
              <Plus size={14} />
              Add CCTV floor
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
        kind="cctv"
        hotelId={activeHotelId}
        canEdit={can('cctv', 'crud') && can('devices', 'crud')}
        floors={floors}
        activeFloorId={activeFloorId}
        focus={focus}
        isLoading={isLoading}
        isFetching={isFetching}
        isError={isError}
        onRefresh={() => refetch()}
      />
      <FloorDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        hotelId={activeHotelId}
        defaultKind="cctv"
        onCreated={(f) => navigate({ to: '/cctv', search: { floor: f.id } })}
      />
    </>
  );
}
