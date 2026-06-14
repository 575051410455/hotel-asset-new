import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useCreateDevice, useUpdateDevice } from '@/lib/devices';
import type { Device } from '@/lib/types';

export type DeviceTab = 'ws' | 'cam' | 'ap';
type FloorOpt = { id: string; short: string; kind: string };

type Field = { key: string; label: string; mono?: boolean };

const FIELDS: Record<DeviceTab, Field[]> = {
  ws: [
    { key: 'name', label: 'User' },
    { key: 'department', label: 'Department' },
    { key: 'type', label: 'Type' },
    { key: 'os', label: 'OS' },
    { key: 'cpu', label: 'CPU' },
    { key: 'ram', label: 'RAM' },
    { key: 'motherboard', label: 'Motherboard' },
    { key: 'graphics', label: 'Graphics' },
    { key: 'storage', label: 'Storage' },
    { key: 'monitor', label: 'Monitor' },
  ],
  cam: [
    { key: 'model', label: 'Model' },
    { key: 'department', label: 'Zone' },
    { key: 'ip', label: 'IP address', mono: true },
    { key: 'resolution', label: 'Resolution' },
    { key: 'lens', label: 'Lens' },
    { key: 'retention', label: 'Retention' },
    { key: 'nvr', label: 'Recorder' },
  ],
  ap: [
    { key: 'model', label: 'Model' },
    { key: 'ip', label: 'IP address', mono: true },
    { key: 'ssid', label: 'SSID' },
    { key: 'band', label: 'Band' },
    { key: 'channel', label: 'Channel', mono: true },
  ],
};

// A workstation/AP belongs on a workstation-kind floor; a camera on a cctv floor.
const floorKindFor = (tab: DeviceTab) => (tab === 'cam' ? 'cctv' : 'workstation');

const STATUS_OPTS: Record<DeviceTab, { value: string; label: string }[]> = {
  ws: [
    { value: 'active', label: 'Online' },
    { value: 'paused', label: 'Paused' },
    { value: 'nodata', label: 'No data' },
  ],
  cam: [
    { value: 'rec', label: 'Recording' },
    { value: 'active', label: 'Live' },
    { value: 'offline', label: 'Offline' },
  ],
  ap: [
    { value: 'active', label: 'Online' },
    { value: 'paused', label: 'Paused' },
    { value: 'nodata', label: 'No data' },
  ],
};

const inputCls =
  'h-[34px] rounded-lg border border-line bg-bg px-[10px] text-[12.5px] text-ink outline-none focus:border-brand';

export function DeviceDialog({
  open,
  onOpenChange,
  hotelId,
  tab,
  device,
  floors,
  placement,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  hotelId: string | null;
  tab: DeviceTab;
  device: Device | null;
  floors: FloorOpt[];
  // When set (click-to-place from a map), the new device is pinned at these
  // %-coords on this floor; the floor selector is locked to it.
  placement?: { floorId: string; x: number; y: number } | null;
}) {
  const isEdit = !!device;
  const isPlace = !isEdit && !!placement;
  const create = useCreateDevice(hotelId);
  const update = useUpdateDevice(hotelId);
  const fields = FIELDS[tab];

  // Floors this device kind can live on (data-driven off GET /api/floors).
  const floorOpts = floors.filter((f) => f.kind === floorKindFor(tab));
  const defaultFloor = placement?.floorId ?? floorOpts[0]?.id ?? '';

  const [form, setForm] = useState<Record<string, string>>({});
  const [computerName, setComputerName] = useState('');
  const [floorId, setFloorId] = useState(defaultFloor);
  const [status, setStatus] = useState(STATUS_OPTS[tab][0].value);
  const [error, setError] = useState('');

  // Reset the form whenever the dialog opens (for the current device/tab).
  useEffect(() => {
    if (!open) return;
    setError('');
    if (device) {
      const f: Record<string, string> = {};
      fields.forEach((fl) => (f[fl.key] = (device[fl.key as keyof Device] as string) ?? ''));
      setForm(f);
      setComputerName(device.computerName);
      setFloorId(device.floorId ?? defaultFloor);
      setStatus(device.status);
    } else {
      setForm({});
      setComputerName('');
      setFloorId(defaultFloor);
      setStatus(STATUS_OPTS[tab][0].value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, device]);

  const idLabel = tab === 'cam' ? 'Camera ID' : tab === 'ap' ? 'AP name' : 'Computer name';
  const noun = tab === 'cam' ? 'camera' : tab === 'ap' ? 'access point' : 'workstation';
  const pending = create.isPending || update.isPending;

  const submit = () => {
    const id = computerName.trim();
    if (!id) {
      setError(`${idLabel} is required.`);
      return;
    }
    const base: Record<string, unknown> = { floorId, status };
    fields.forEach((fl) => {
      const v = form[fl.key]?.trim();
      base[fl.key] = v ? v : null;
    });

    if (isEdit && device) {
      update.mutate(
        { id: device.id, patch: base },
        {
          onSuccess: () => {
            toast.success(`${id} updated`);
            onOpenChange(false);
          },
          onError: (e: Error) => setError(e.message),
        }
      );
    } else {
      const payload: Record<string, unknown> = {
        ...base,
        computerName: id,
        type: tab === 'cam' ? 'IP Camera' : tab === 'ap' ? 'Access Point' : form.type?.trim() || 'Desktop',
        department: tab === 'ap' ? 'Wi-Fi' : base.department,
        isAp: tab === 'ap',
        name: form.name?.trim() || (tab === 'ws' ? '' : id),
        // Drop it onto the map at the clicked spot when placing.
        ...(placement ? { x: placement.x, y: placement.y } : {}),
      };
      create.mutate(payload, {
        onSuccess: () => {
          toast.success(`${id} added`);
          onOpenChange(false);
        },
        onError: (e: Error) => setError(e.message),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px] gap-0">
        <DialogHeader>
          <DialogTitle className="text-[15.5px]">
            {isEdit ? `Edit ${device?.computerName}` : isPlace ? `Place ${noun}` : `Add ${noun}`}
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            {isEdit
              ? 'Changes are saved to the inventory and reflected on the floor-map pins.'
              : isPlace
                ? 'Dropped on the floor plan at the clicked spot — fill in the details to save it as a pin.'
                : 'New devices appear in the inventory and on the floor map once placed.'}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-[10px]">
          <label className="flex flex-col gap-[5px]">
            <span className="text-[11.5px] font-semibold text-ink2">{idLabel}</span>
            <input
              value={computerName}
              onChange={(e) => setComputerName(e.target.value)}
              disabled={isEdit}
              placeholder="e.g. ACC-AP-05"
              className={`${inputCls} font-mono disabled:opacity-60`}
            />
          </label>
          <label className="flex flex-col gap-[5px]">
            <span className="text-[11.5px] font-semibold text-ink2">Floor</span>
            <select
              value={floorId}
              onChange={(e) => setFloorId(e.target.value)}
              disabled={isPlace}
              className={`${inputCls} disabled:opacity-60`}
            >
              {floorOpts.length === 0 && <option value="">No {floorKindFor(tab)} floors</option>}
              {floorOpts.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.short}
                </option>
              ))}
            </select>
          </label>

          {fields.map((fl) => (
            <label key={fl.key} className="flex flex-col gap-[5px]">
              <span className="text-[11.5px] font-semibold text-ink2">{fl.label}</span>
              <input
                value={form[fl.key] ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, [fl.key]: e.target.value }))}
                className={`${inputCls}${fl.mono ? ' font-mono' : ''}`}
              />
            </label>
          ))}

          <label className="flex flex-col gap-[5px]">
            <span className="text-[11.5px] font-semibold text-ink2">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
              {STATUS_OPTS[tab].map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && (
          <div className="mt-3 rounded-lg bg-bad-soft px-3 py-2 text-[12px] font-semibold text-bad">
            {error}
          </div>
        )}

        <DialogFooter className="mt-[18px]">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Add device'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
