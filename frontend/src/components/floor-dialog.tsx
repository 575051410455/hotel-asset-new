import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ImageUp,
  Loader2,
  Monitor,
  Cctv,
  X,
  Check,
  Plus,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useCreateFloor, useUpdateFloor, uploadFloorImage } from '@/lib/devices';
import { cn } from '@/lib/utils';
import type { Floor, FloorWithPins } from '@/lib/types';

type Kind = 'workstation' | 'cctv';

// A plan image is either freshly uploaded (carries width/height) or the floor's
// existing image (URL + aspect only) when editing.
type PlanImage = { url: string; aspect: number; width?: number; height?: number };

const inputCls =
  'h-[34px] rounded-lg border border-line bg-bg px-[10px] text-[12.5px] text-ink outline-none focus:border-brand';

// Backend slug rule: /^[a-z0-9][a-z0-9-]{0,30}$/
const slugRe = /^[a-z0-9][a-z0-9-]{0,30}$/;
function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 31);
}

const STEPS = ['Details', 'Floor plan', 'Departments'] as const;

export function FloorDialog({
  open,
  onOpenChange,
  hotelId,
  defaultKind,
  floor = null,
  onCreated,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  hotelId: string | null;
  defaultKind: Kind;
  /** When set, the dialog edits this floor instead of creating a new one. */
  floor?: FloorWithPins | null;
  onCreated?: (floor: FloorWithPins) => void;
  onSaved?: (floor: Floor) => void;
}) {
  const create = useCreateFloor(hotelId);
  const update = useUpdateFloor(hotelId);
  const isEdit = !!floor;
  const pending = create.isPending || update.isPending;

  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<Kind>(defaultKind);
  const [name, setName] = useState('');
  const [short, setShort] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [image, setImage] = useState<PlanImage | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [departments, setDepartments] = useState<string[]>([]);
  const [deptInput, setDeptInput] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const isCctv = kind === 'cctv';
  const deptNoun = isCctv ? 'zone' : 'department';

  // Reset everything each time the dialog opens — prefilled from `floor` when editing.
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setKind(floor ? (floor.kind as Kind) : defaultKind);
    setName(floor?.name ?? '');
    setShort(floor?.short ?? '');
    setSlug(floor?.id ?? '');
    setSlugTouched(false);
    setImage(floor?.image ? { url: floor.image, aspect: floor.aspect } : null);
    setUploading(false);
    setUploadError('');
    setDepartments(floor?.departments ?? []);
    setDeptInput('');
    setError('');
  }, [open, defaultKind, floor]);

  // Auto-derive the slug from the name until the user edits it directly.
  const onName = (v: string) => {
    setName(v);
    if (!slugTouched) setSlug(slugify(v));
  };

  const slugValid = slugRe.test(slug);
  const step1Valid = name.trim().length > 0 && short.trim().length > 0 && slugValid;

  const pickFile = async (file: File) => {
    setUploadError('');
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setUploadError('Only PNG or JPG images are allowed.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('Image exceeds the 10 MB limit.');
      return;
    }
    setUploading(true);
    try {
      const up = await uploadFloorImage(file);
      setImage(up);
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const addDept = () => {
    const v = deptInput.trim().slice(0, 40);
    if (!v) return;
    if (departments.some((d) => d.toLowerCase() === v.toLowerCase())) {
      setDeptInput('');
      return;
    }
    setDepartments((d) => [...d, v]);
    setDeptInput('');
  };

  const submit = () => {
    setError('');
    const onError = (e: Error) => {
      setError(e.message);
      setStep(0); // a 409 slug clash / validation error lives on step 1
    };

    // Edit: slug & kind are immutable; PATCH the rest.
    if (isEdit && floor) {
      update.mutate(
        {
          id: floor.id,
          patch: {
            name: name.trim(),
            short: short.trim(),
            image: image?.url ?? null,
            aspect: image?.aspect,
            departments,
          },
        },
        {
          onSuccess: (saved: Floor) => {
            toast.success(`Floor "${saved.short}" saved`);
            onOpenChange(false);
            onSaved?.(saved);
          },
          onError,
        }
      );
      return;
    }

    create.mutate(
      {
        id: slug,
        name: name.trim(),
        short: short.trim(),
        kind,
        route: `/${slug}`,
        image: image?.url ?? null,
        aspect: image?.aspect,
        departments,
      },
      {
        onSuccess: (created: FloorWithPins) => {
          toast.success(`Floor "${created.short}" created`);
          onOpenChange(false);
          onCreated?.(created);
        },
        onError,
      }
    );
  };

  const last = step === STEPS.length - 1;
  const canNext = step === 0 ? step1Valid : step === 1 ? !uploading : true;
  // Step indicators are clickable: always go back; jump forward only once valid.
  const canJump = (i: number) => i <= step || (step1Valid && !uploading);
  const goStep = (i: number) => {
    if (canJump(i)) setStep(i);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] gap-0">
        <DialogHeader>
          <DialogTitle className="text-[15.5px]">{isEdit ? 'Edit floor' : 'Add a floor'}</DialogTitle>
          <DialogDescription className="text-[12px]">
            {isEdit
              ? 'Update this floor’s details, plan image and departments.'
              : 'Floors are scoped to the current property and power the maps & navigation.'}
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <div className="mt-[14px] flex items-center gap-2">
          {STEPS.map((label, i) => (
            <div key={label} className="flex flex-1 items-center gap-2">
              <button
                type="button"
                onClick={() => goStep(i)}
                disabled={!canJump(i)}
                className="flex items-center gap-2 disabled:cursor-not-allowed"
              >
                <span
                  className={cn(
                    'flex size-[22px] flex-none items-center justify-center rounded-full text-[11px] font-bold',
                    i < step
                      ? 'bg-brand text-brand-foreground'
                      : i === step
                        ? 'bg-brand-soft text-brand ring-1 ring-brand'
                        : 'bg-surface2 text-ink3'
                  )}
                >
                  {i < step ? <Check size={12} /> : i + 1}
                </span>
                <span
                  className={cn(
                    'text-[11.5px] font-semibold',
                    i === step ? 'text-ink' : 'text-ink3'
                  )}
                >
                  {label}
                </span>
              </button>
              {i < STEPS.length - 1 && <span className="h-px flex-1 bg-line" />}
            </div>
          ))}
        </div>

        <div className="mt-[18px] min-h-[228px]">
          {/* ── Step 1 — Details ── */}
          {step === 0 && (
            <div className="flex flex-col gap-[14px]">
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { v: 'workstation', label: 'Workstation floor', sub: 'Computers & Wi-Fi APs', Icon: Monitor },
                    { v: 'cctv', label: 'CCTV zone', sub: 'Cameras & coverage', Icon: Cctv },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => !isEdit && setKind(opt.v)}
                    disabled={isEdit}
                    title={isEdit ? "A floor's type can't be changed after creation" : undefined}
                    className={cn(
                      'flex items-start gap-[10px] rounded-xl border p-[11px_12px] text-left',
                      kind === opt.v ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:bg-surface2',
                      isEdit && 'cursor-not-allowed',
                      isEdit && kind !== opt.v && 'opacity-45'
                    )}
                  >
                    <opt.Icon size={17} className={kind === opt.v ? 'text-brand' : 'text-ink3'} strokeWidth={1.7} />
                    <span className="flex flex-col">
                      <span className="text-[12.5px] font-semibold text-ink">{opt.label}</span>
                      <span className="text-[11px] text-ink3">{opt.sub}</span>
                    </span>
                  </button>
                ))}
              </div>

              <label className="flex flex-col gap-[5px]">
                <span className="text-[11.5px] font-semibold text-ink2">Floor name</span>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => onName(e.target.value)}
                  placeholder="e.g. Accounting Floor (3F)"
                  className={inputCls}
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-[5px]">
                  <span className="text-[11.5px] font-semibold text-ink2">Short label</span>
                  <input
                    value={short}
                    onChange={(e) => setShort(e.target.value)}
                    placeholder="e.g. 3F · Accounts"
                    className={inputCls}
                  />
                  <span className="text-[10.5px] text-ink3">Shown in the sidebar & floor tabs.</span>
                </label>
                <label className="flex flex-col gap-[5px]">
                  <span className="text-[11.5px] font-semibold text-ink2">Slug</span>
                  <input
                    value={slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setSlug(e.target.value.toLowerCase());
                    }}
                    readOnly={isEdit}
                    placeholder="accounting-3f"
                    className={cn(
                      inputCls,
                      'font-mono',
                      isEdit && 'cursor-not-allowed opacity-60',
                      slug && !slugValid && 'border-bad'
                    )}
                  />
                  <span className={cn('text-[10.5px]', slug && !slugValid ? 'text-bad' : 'text-ink3')}>
                    {isEdit
                      ? 'The slug is permanent.'
                      : slug && !slugValid
                        ? 'Lowercase letters, numbers, hyphens.'
                        : 'Unique URL id within this property.'}
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* ── Step 2 — Floor plan ── */}
          {step === 1 && (
            <div className="flex flex-col gap-[12px]">
              {!image ? (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0];
                    if (f) pickFile(f);
                  }}
                  className="flex h-[200px] flex-col items-center justify-center gap-[10px] rounded-xl border-2 border-dashed border-line bg-surface2 text-ink3 hover:border-brand hover:text-brand"
                >
                  {uploading ? (
                    <>
                      <Loader2 size={26} className="animate-spin" />
                      <span className="text-[12.5px] font-semibold">Uploading…</span>
                    </>
                  ) : (
                    <>
                      <ImageUp size={26} strokeWidth={1.6} />
                      <span className="text-[12.5px] font-semibold">Click or drop a floor-plan image</span>
                      <span className="text-[11px]">PNG or JPG · up to 10 MB</span>
                    </>
                  )}
                </button>
              ) : (
                <div className="relative overflow-hidden rounded-xl border border-line bg-white">
                  <img src={image.url} alt="Floor plan preview" className="max-h-[210px] w-full object-contain" />
                  <button
                    type="button"
                    onClick={() => setImage(null)}
                    title="Remove image"
                    className="absolute right-2 top-2 flex size-[26px] items-center justify-center rounded-lg border border-line bg-surface/90 text-ink2 hover:text-bad"
                  >
                    <X size={14} />
                  </button>
                  <div className="absolute bottom-2 left-2 rounded-md bg-black/55 px-[8px] py-[3px] font-mono text-[10.5px] text-white">
                    {image.width != null
                      ? `${image.width}×${image.height} · ratio ${image.aspect.toFixed(2)}`
                      : `Current plan · ratio ${image.aspect.toFixed(2)}`}
                  </div>
                </div>
              )}
              {uploadError && (
                <div className="rounded-lg bg-bad-soft px-3 py-2 text-[12px] font-semibold text-bad">{uploadError}</div>
              )}
              <p className="text-[11.5px] leading-[1.5] text-ink3">
                The floor plan is the map background — pins are placed on top of it. You can skip this and add a plan
                later from floor settings.
              </p>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) pickFile(f);
                  e.target.value = '';
                }}
              />
            </div>
          )}

          {/* ── Step 3 — Departments ── */}
          {step === 2 && (
            <div className="flex flex-col gap-[12px]">
              <div className="flex flex-col gap-[5px]">
                <span className="text-[11.5px] font-semibold text-ink2">
                  {isCctv ? 'Zones' : 'Departments'}
                </span>
                <div className="flex gap-2">
                  <input
                    value={deptInput}
                    onChange={(e) => setDeptInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addDept();
                      }
                    }}
                    placeholder={`Add a ${deptNoun} and press Enter`}
                    className={cn(inputCls, 'flex-1')}
                  />
                  <Button type="button" variant="outline" onClick={addDept} disabled={!deptInput.trim()}>
                    <Plus size={14} />
                    Add
                  </Button>
                </div>
                <span className="text-[10.5px] text-ink3">
                  {isCctv
                    ? 'Cameras are grouped by zone in the list panel.'
                    : 'Workstations are grouped by department in the list panel.'}
                </span>
              </div>

              <div className="flex min-h-[44px] flex-wrap gap-[6px] rounded-lg border border-line bg-surface2 p-[10px]">
                {departments.length === 0 ? (
                  <span className="text-[12px] text-ink3">No {deptNoun}s yet — add a few above (optional).</span>
                ) : (
                  departments.map((d) => (
                    <span
                      key={d}
                      className="flex items-center gap-[6px] rounded-full border border-line bg-surface px-[10px] py-[4px] text-[12px] font-semibold text-ink"
                    >
                      {d}
                      <button
                        type="button"
                        onClick={() => setDepartments((cur) => cur.filter((x) => x !== d))}
                        className="text-ink3 hover:text-bad"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))
                )}
              </div>

              {/* Review summary */}
              <div className="rounded-xl border border-line bg-surface2 p-[12px]">
                <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-ink3">Review</div>
                <div className="mt-[8px] grid grid-cols-[auto_1fr] gap-x-3 gap-y-[5px] text-[12px]">
                  <span className="text-ink3">Name</span>
                  <span className="font-semibold text-ink">{name || '—'}</span>
                  <span className="text-ink3">Type</span>
                  <span className="text-ink">{isCctv ? 'CCTV zone' : 'Workstation floor'}</span>
                  <span className="text-ink3">Slug</span>
                  <span className="font-mono text-ink">{slug || '—'}</span>
                  <span className="text-ink3">Floor plan</span>
                  <span className="text-ink">{image ? 'Uploaded' : 'None (add later)'}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-1 rounded-lg bg-bad-soft px-3 py-2 text-[12px] font-semibold text-bad">{error}</div>
        )}

        <DialogFooter className="mt-[16px] sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => (step === 0 ? onOpenChange(false) : setStep((s) => s - 1))}
            disabled={pending}
          >
            {step === 0 ? (
              'Cancel'
            ) : (
              <>
                <ArrowLeft size={14} />
                Back
              </>
            )}
          </Button>
          {last ? (
            <Button onClick={submit} disabled={pending || !step1Valid}>
              {pending ? (isEdit ? 'Saving…' : 'Creating…') : isEdit ? 'Save changes' : 'Create floor'}
            </Button>
          ) : (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
              Next
              <ArrowRight size={14} />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
