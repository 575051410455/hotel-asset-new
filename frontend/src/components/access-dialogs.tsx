import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  useCreateUser,
  useUpdateUser,
  useCreateRole,
  useUpdateRole,
  useCreateGroup,
  useUpdateGroup,
  type AccessUser,
  type AccessRole,
  type AccessGroup,
  type AccessHotel,
  type RolePerms,
} from '@/lib/access';
import { initials, avatarColor, type PermLevel } from '@/lib/types';
import { cn } from '@/lib/utils';

const inputCls =
  'h-[34px] rounded-lg border border-line bg-bg px-[10px] text-[12.5px] text-ink outline-none focus:border-brand';
const errorBox = 'mt-3 rounded-lg bg-bad-soft px-3 py-2 text-[12px] font-semibold text-bad';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-[5px]">
      <span className="text-[11.5px] font-semibold text-ink2">{label}</span>
      {children}
    </label>
  );
}

// ── User dialog ───────────────────────────────────────────────────────────────
export function UserDialog({ open, user, onClose }: { open: boolean; user: AccessUser | null; onClose: () => void }) {
  const isEdit = !!user;
  const create = useCreateUser();
  const update = useUpdateUser();
  const [f, setF] = useState({
    name: user?.name ?? '',
    email: user?.email ?? '',
    phone: user?.phone ?? '',
    title: user?.title ?? '',
    department: user?.department ?? '',
    password: '',
  });
  const [error, setError] = useState('');
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const pending = create.isPending || update.isPending;

  const submit = () => {
    setError('');
    if (!f.name.trim()) return setError('Name is required.');
    if (!/^[^@\s]+@[^@\s]+$/.test(f.email.trim())) return setError('Enter a valid email address.');
    const common = { name: f.name.trim(), phone: f.phone || null, title: f.title || null, department: f.department || null };
    if (isEdit && user) {
      update.mutate(
        { id: user.id, patch: { ...common, email: f.email.trim() } },
        { onSuccess: () => { toast.success('Profile saved'); onClose(); }, onError: (e: Error) => setError(e.message) }
      );
    } else {
      create.mutate(
        { ...common, email: f.email.trim(), password: f.password || 'changeme123' },
        { onSuccess: () => { toast.success('User created'); onClose(); }, onError: (e: Error) => setError(e.message) }
      );
    }
  };

  const fields: { key: keyof typeof f; label: string; ph: string }[] = [
    { key: 'name', label: 'Full name', ph: 'e.g. Nok F.' },
    { key: 'email', label: 'Email', ph: 'name@company.com' },
    { key: 'phone', label: 'Phone', ph: '08x-xxx-xxxx' },
    { key: 'title', label: 'Job title', ph: 'e.g. Accountant' },
    { key: 'department', label: 'Department', ph: 'e.g. Account' },
  ];
  if (!isEdit) fields.push({ key: 'password', label: 'Temp password', ph: 'changeme123' });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-[15.5px]">{isEdit ? 'Edit profile' : 'Add user'}</DialogTitle>
        </DialogHeader>
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-[10px]">
          {fields.map((fl) => (
            <Field key={fl.key} label={fl.label}>
              <input value={f[fl.key]} onChange={(e) => set(fl.key, e.target.value)} placeholder={fl.ph} className={inputCls} />
            </Field>
          ))}
        </div>
        {error && <div className={errorBox}>{error}</div>}
        <DialogFooter className="mt-[18px]">
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending}>{isEdit ? 'Save changes' : 'Create user'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Role dialog ───────────────────────────────────────────────────────────────
export function RoleDialog({
  open,
  role,
  resources,
  onClose,
}: {
  open: boolean;
  role: AccessRole | null;
  resources: { key: keyof RolePerms; label: string }[];
  onClose: () => void;
}) {
  const isEdit = !!role;
  const create = useCreateRole();
  const update = useUpdateRole();
  const [name, setName] = useState(role?.name ?? '');
  const [desc, setDesc] = useState(role?.description ?? '');
  const [perms, setPerms] = useState<RolePerms>(
    role?.perms ?? { devices: 'read', floors: 'read', cctv: 'read', access: 'none' }
  );
  const [error, setError] = useState('');
  const pending = create.isPending || update.isPending;

  const submit = () => {
    setError('');
    if (!name.trim()) return setError('Role name is required.');
    const body = { name: name.trim(), description: desc, perms };
    if (isEdit && role) {
      update.mutate({ id: role.id, patch: body }, { onSuccess: () => { toast.success('Role saved'); onClose(); }, onError: (e: Error) => setError(e.message) });
    } else {
      create.mutate(body, { onSuccess: () => { toast.success('Role created'); onClose(); }, onError: (e: Error) => setError(e.message) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-[15.5px]">{isEdit ? 'Edit role' : 'Create role'}</DialogTitle>
        </DialogHeader>
        <div className="mt-3 flex flex-col gap-[11px]">
          <Field label="Role name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Auditor" className={inputCls} />
          </Field>
          <Field label="Description">
            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What can this role do?" className={inputCls} />
          </Field>
          <div className="flex flex-col gap-2">
            {resources.map((res) => (
              <div key={res.key} className="flex items-center gap-[10px] rounded-[9px] border border-line bg-surface2 p-[8px_12px]">
                <span className="flex-1 text-[12.5px] font-semibold">{res.label}</span>
                <select
                  value={perms[res.key]}
                  onChange={(e) => setPerms((p) => ({ ...p, [res.key]: e.target.value as PermLevel }))}
                  className="h-7 rounded-[7px] border border-line bg-surface px-[7px] text-[11.5px] text-ink"
                >
                  <option value="none">None</option>
                  <option value="read">Read</option>
                  <option value="crud">Full (CRUD)</option>
                </select>
              </div>
            ))}
          </div>
        </div>
        {error && <div className={errorBox}>{error}</div>}
        <DialogFooter className="mt-[18px]">
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending}>{isEdit ? 'Save changes' : 'Create role'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Group dialog ──────────────────────────────────────────────────────────────
export function GroupDialog({
  open,
  group,
  roles,
  hotels,
  users,
  onClose,
}: {
  open: boolean;
  group: AccessGroup | null;
  roles: AccessRole[];
  hotels: AccessHotel[];
  users: AccessUser[];
  onClose: () => void;
}) {
  const isEdit = !!group;
  const create = useCreateGroup();
  const update = useUpdateGroup();
  const [name, setName] = useState(group?.name ?? '');
  // Roles are created and deleted by users, so no role id may be assumed to
  // exist — a database bootstrapped for production carries only `admin`.
  // Defaulting to a literal left the select showing the one real option while
  // the state still held the literal, so the request sent a role that wasn't
  // there. Start from what the server actually returned instead.
  const [roleId, setRoleId] = useState(() => {
    const current = group?.roleId;
    if (current && roles.some((r) => r.id === current)) return current;
    return roles[0]?.id ?? '';
  });
  const [hotelIds, setHotelIds] = useState<string[]>(group?.hotelIds ?? []);
  const [memberIds, setMemberIds] = useState<number[]>(group?.memberIds ?? []);
  const [error, setError] = useState('');
  const pending = create.isPending || update.isPending;

  const toggleHotel = (id: string) => setHotelIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const toggleMember = (id: number) => setMemberIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const submit = () => {
    setError('');
    if (!name.trim()) return setError('Group name is required.');
    if (!roleId) return setError('No roles exist yet — create a role first.');
    if (hotelIds.length === 0) return setError('Pick at least one property.');
    const body = { name: name.trim(), roleId, hotelIds, memberIds };
    if (isEdit && group) {
      update.mutate({ id: group.id, patch: body }, { onSuccess: () => { toast.success('Group saved'); onClose(); }, onError: (e: Error) => setError(e.message) });
    } else {
      create.mutate(body, { onSuccess: () => { toast.success('Group created'); onClose(); }, onError: (e: Error) => setError(e.message) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-[15.5px]">{isEdit ? 'Edit group' : 'Create group'}</DialogTitle>
        </DialogHeader>
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-[10px]">
          <Field label="Group name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Night Audit" className={inputCls} />
          </Field>
          <Field label="Role">
            <select value={roleId} onChange={(e) => setRoleId(e.target.value)} className={inputCls}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="mt-[13px] text-[11.5px] font-semibold text-ink2">Properties</div>
        <div className="mt-[7px] flex flex-wrap gap-[6px]">
          {hotels.map((h) => {
            const on = hotelIds.includes(h.id);
            return (
              <button
                key={h.id}
                onClick={() => toggleHotel(h.id)}
                className={cn(
                  'rounded-full border px-[12px] py-[6px] text-[11.5px] font-semibold',
                  on ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface text-ink3'
                )}
              >
                {h.code} — {h.name}
              </button>
            );
          })}
        </div>

        <div className="mt-[13px] text-[11.5px] font-semibold text-ink2">Members</div>
        <div className="mt-[7px] max-h-[170px] overflow-y-auto rounded-[10px] border border-line bg-surface2 p-[6px]">
          {users.map((u) => {
            const on = memberIds.includes(u.id);
            return (
              <button
                key={u.id}
                onClick={() => toggleMember(u.id)}
                className={cn('flex w-full items-center gap-[9px] rounded-[7px] p-[6px_8px] text-left', on ? 'bg-brand-soft' : 'bg-transparent hover:bg-surface')}
              >
                <span className="flex size-6 flex-none items-center justify-center rounded-full text-[9.5px] font-bold text-white" style={{ background: avatarColor(u.email) }}>
                  {initials(u.name)}
                </span>
                <span className="flex-1 text-[12.5px] font-medium text-ink">
                  {u.name} — {u.title || u.department || ''}
                </span>
                {on && <span className="text-[12px] font-bold text-brand">✓</span>}
              </button>
            );
          })}
        </div>

        {error && <div className={errorBox}>{error}</div>}
        <DialogFooter className="mt-[18px]">
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending}>{isEdit ? 'Save changes' : 'Create group'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
