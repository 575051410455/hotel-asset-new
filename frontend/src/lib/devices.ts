import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './api';
import type { Device, Floor, FloorWithPins } from './types';

export const deviceKeys = {
  all: (hotelId: string) => ['devices', hotelId] as const,
  floors: (hotelId: string, kind?: string) => ['floors', hotelId, kind ?? 'all'] as const,
};

// All devices for a property (the dashboard filters/paginates client-side).
export function useDevices(hotelId: string | null) {
  return useQuery<Device[]>({
    queryKey: deviceKeys.all(hotelId ?? ''),
    queryFn: () => api.devices.$get({ query: { hotelId } }).then(unwrap),
    enabled: !!hotelId,
  });
}

// Floors (with their map pins) for a property, optionally filtered by kind.
export function useFloors(hotelId: string | null, kind?: 'workstation' | 'cctv') {
  return useQuery<FloorWithPins[]>({
    queryKey: deviceKeys.floors(hotelId ?? '', kind),
    queryFn: () =>
      api.floors
        .$get({ query: kind ? { hotelId, kind } : { hotelId } })
        .then(unwrap),
    enabled: !!hotelId,
  });
}

function useInvalidate(hotelId: string | null) {
  const qc = useQueryClient();
  return () => {
    if (!hotelId) return;
    qc.invalidateQueries({ queryKey: ['devices', hotelId] });
    qc.invalidateQueries({ queryKey: ['floors', hotelId] });
  };
}

export function useCreateDevice(hotelId: string | null) {
  const invalidate = useInvalidate(hotelId);
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.devices.$post({ json: { ...body, hotelId } }).then(unwrap) as Promise<Device>,
    onSuccess: invalidate,
  });
}

export function useUpdateDevice(hotelId: string | null) {
  const invalidate = useInvalidate(hotelId);
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Record<string, unknown> }) =>
      api.devices[':id'].$patch({ param: { id: String(id) }, json: patch }).then(unwrap) as Promise<Device>,
    onSuccess: invalidate,
  });
}

export function useDeleteDevice(hotelId: string | null) {
  const invalidate = useInvalidate(hotelId);
  return useMutation({
    mutationFn: (id: number) =>
      api.devices[':id'].$delete({ param: { id: String(id) } }).then(unwrap),
    onSuccess: invalidate,
  });
}

// ── Floors (management) ──────────────────────────────────────────────────────

export type UploadedImage = { id: string; url: string; width: number; height: number; aspect: number };

// Upload a floor-plan image (multipart). The server computes width/height/aspect
// and returns the public /uploads URL. Requires `floors:crud`.
export async function uploadFloorImage(file: File): Promise<UploadedImage> {
  return api.uploads.$post({ form: { file } }).then(unwrap) as Promise<UploadedImage>;
}

// Create a floor for the active property (POST /api/floors). The slug (`id`) is
// unique within the property; a soft-deleted slug is revived server-side.
export function useCreateFloor(hotelId: string | null) {
  const invalidate = useInvalidate(hotelId);
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.floors.$post({ json: { ...body, hotelId } }).then(unwrap) as Promise<FloorWithPins>,
    onSuccess: invalidate,
  });
}

// Update a floor (rename, replace plan image, edit departments, reorder) for the
// active property — PATCH /api/floors/:slug?hotelId=. The slug (`id`) and kind are
// immutable; everything else in updateFloorSchema is patchable. Requires `floors:crud`.
export function useUpdateFloor(hotelId: string | null) {
  const invalidate = useInvalidate(hotelId);
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      api.floors[':id']
        .$patch({ param: { id }, query: { hotelId }, json: patch })
        .then(unwrap) as Promise<Floor>,
    onSuccess: invalidate,
  });
}

// Soft-delete a floor and detach its pins (devices stay in the inventory but lose
// their placement) — DELETE /api/floors/:slug?hotelId=. Requires `floors:crud`.
export function useDeleteFloor(hotelId: string | null) {
  const invalidate = useInvalidate(hotelId);
  return useMutation({
    mutationFn: (id: string) =>
      api.floors[':id'].$delete({ param: { id }, query: { hotelId } }).then(unwrap),
    onSuccess: invalidate,
  });
}
