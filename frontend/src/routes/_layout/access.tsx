import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Search, Plus, Pencil, Trash2, X, ShieldOff } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import {
  useAccessUsers,
  useAccessRoles,
  useAccessGroups,
  useAccessHotels,
  useArchiveUser,
  useRestoreUser,
  useUpdateUser,
  useSetAssignments,
  useSetMemberships,
  useDeleteRole,
  useDeleteGroup,
  type AccessUser,
  type AccessRole,
  type AccessGroup,
  type AccessHotel,
} from '@/lib/access';
import { avatarColor, initials } from '@/lib/types';
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
import { UserDialog, RoleDialog, GroupDialog } from '@/components/access-dialogs';

export const Route = createFileRoute('/_layout/access')({
  component: AccessPage,
});

const RESOURCES: { key: keyof AccessRole['perms']; label: string }[] = [
  { key: 'devices', label: 'Dashboard & devices' },
  { key: 'floors', label: 'Floor plans & pins' },
  { key: 'cctv', label: 'CCTV & cameras' },
  { key: 'userManagement', label: 'Users & access control' },
];

const LEVEL_PILL: Record<string, { label: string; color: string; bg: string }> = {
  none: { label: 'None', color: 'var(--ink3)', bg: 'var(--surface2)' },
  read: { label: 'Read', color: 'var(--warn)', bg: 'var(--warn-soft)' },
  crud: { label: 'Full', color: 'var(--ok)', bg: 'var(--ok-soft)' },
};
const STATUS_PILL: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: 'ACTIVE', color: 'var(--ok)', bg: 'var(--ok-soft)' },
  suspended: { label: 'SUSPENDED', color: 'var(--bad)', bg: 'var(--bad-soft)' },
  archived: { label: 'ARCHIVED', color: 'var(--ink3)', bg: 'var(--surface2)' },
};

type Tab = 'users' | 'roles' | 'groups' | 'hotels';
type Confirm = { type: 'user' | 'role' | 'group'; id: number | string; label: string };
type Dialog =
  | { kind: 'user'; user: AccessUser | null }
  | { kind: 'role'; role: AccessRole | null }
  | { kind: 'group'; group: AccessGroup | null };

function fmtLogin(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-CA')} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

function AccessPage() {
  const { hotels: myHotels } = useAuth();
  const canManage = myHotels.some((h) => h.perms.userManagement === 'crud');
  const canRead = myHotels.some((h) => h.perms.userManagement !== 'none');

  const [tab, setTab] = useState<Tab>('users');
  const [search, setSearch] = useState('');
  const [drawerUserId, setDrawerUserId] = useState<number | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const users = useAccessUsers();
  const roles = useAccessRoles();
  const groups = useAccessGroups();
  const hotels = useAccessHotels();

  const archiveUser = useArchiveUser();
  const deleteRole = useDeleteRole();
  const deleteGroup = useDeleteGroup();

  const primaryLabel = tab === 'users' ? 'Add user' : tab === 'roles' ? 'Create role' : tab === 'groups' ? 'Create group' : '';

  useSetPageHeader(
    {
      title: 'Access control',
      subtitle: 'Users, roles, groups & property access',
      badge: !canManage && canRead ? <ReadOnlyBadge /> : undefined,
    },
    [canManage, canRead]
  );

  if (!canRead) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex max-w-[360px] flex-col items-center gap-[10px] rounded-[14px] border border-line bg-surface p-[30px_38px] text-center shadow-[var(--shadow)]">
          <ShieldOff size={28} className="text-ink3" />
          <div className="text-[15px] font-bold">You don't have access to this page</div>
          <div className="text-[12.5px] leading-[1.55] text-ink2">
            Your role doesn't include access management. Ask an administrator to grant it.
          </div>
        </div>
      </div>
    );
  }

  const tabDefs: { key: Tab; label: string; count?: number }[] = [
    { key: 'users', label: 'Users', count: users.data?.length },
    { key: 'roles', label: 'Roles', count: roles.data?.length },
    { key: 'groups', label: 'Groups', count: groups.data?.length },
    { key: 'hotels', label: 'Properties', count: hotels.data?.length },
  ];

  const openPrimary = () => {
    if (tab === 'users') setDialog({ kind: 'user', user: null });
    else if (tab === 'roles') setDialog({ kind: 'role', role: null });
    else if (tab === 'groups') setDialog({ kind: 'group', group: null });
  };

  const doConfirm = () => {
    if (!confirm) return;
    const onErr = (e: Error) => toast.error(e.message);
    if (confirm.type === 'user') {
      archiveUser.mutate(confirm.id as number, { onError: onErr });
      setDrawerUserId(null);
    } else if (confirm.type === 'role') deleteRole.mutate(confirm.id as string, { onError: onErr });
    else deleteGroup.mutate(confirm.id as number, { onError: onErr });
    setConfirm(null);
  };

  return (
    <div className="flex max-w-[1180px] flex-col gap-[14px] p-[18px]">
      {/* Tabs + search + primary */}
      <div className="flex flex-wrap items-center gap-[10px]">
        <div className="flex items-center gap-[3px] rounded-[9px] border border-line bg-surface p-[3px]">
          {tabDefs.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => {
                  setTab(t.key);
                  setSearch('');
                }}
                className={cn(
                  'whitespace-nowrap rounded-md px-[14px] py-[6px] text-[12.5px] font-semibold',
                  active ? 'bg-brand-soft text-brand' : 'text-ink2 hover:text-ink'
                )}
              >
                {t.label} {t.count ?? ''}
              </button>
            );
          })}
        </div>
        {(tab === 'users' || tab === 'roles' || tab === 'groups') && (
          <div className="relative min-w-[150px] max-w-[270px] flex-1">
            <Search size={13} className="absolute left-[10px] top-1/2 -translate-y-1/2 text-ink3" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tab === 'users' ? 'Search name, email, dept…' : 'Search…'}
              className="h-[34px] w-full rounded-lg border border-line bg-surface pl-[30px] pr-[10px] text-[12.5px] outline-none focus:border-brand"
            />
          </div>
        )}
        <div className="flex-1" />
        {canManage && primaryLabel && (
          <button onClick={openPrimary} className="flex h-[34px] items-center gap-[7px] rounded-lg bg-ink px-[14px] text-[12.5px] font-semibold text-bg">
            <Plus size={12} strokeWidth={2.4} />
            {primaryLabel}
          </button>
        )}
      </div>

      {tab === 'users' && (
        <UsersTab
          users={users.data ?? []}
          groups={groups.data ?? []}
          search={search}
          onOpen={(id) => setDrawerUserId(id)}
        />
      )}
      {tab === 'roles' && (
        <RolesTab
          roles={roles.data ?? []}
          search={search}
          canManage={canManage}
          onEdit={(role) => setDialog({ kind: 'role', role })}
          onDelete={(role) => setConfirm({ type: 'role', id: role.id, label: role.name })}
        />
      )}
      {tab === 'groups' && (
        <GroupsTab
          groups={groups.data ?? []}
          users={users.data ?? []}
          search={search}
          canManage={canManage}
          onEdit={(group) => setDialog({ kind: 'group', group })}
          onDelete={(group) => setConfirm({ type: 'group', id: group.id, label: group.name })}
        />
      )}
      {tab === 'hotels' && <HotelsTab hotels={hotels.data ?? []} users={users.data ?? []} groups={groups.data ?? []} />}

      {/* Drawer */}
      {drawerUserId != null && (
        <UserDrawer
          user={(users.data ?? []).find((u) => u.id === drawerUserId) ?? null}
          roles={roles.data ?? []}
          groups={groups.data ?? []}
          hotels={hotels.data ?? []}
          canManage={canManage}
          onClose={() => setDrawerUserId(null)}
          onEdit={(user) => setDialog({ kind: 'user', user })}
          onDelete={(user) => setConfirm({ type: 'user', id: user.id, label: user.name })}
        />
      )}

      {/* Dialogs */}
      {dialog?.kind === 'user' && (
        <UserDialog open user={dialog.user} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'role' && (
        <RoleDialog open role={dialog.role} resources={RESOURCES} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'group' && (
        <GroupDialog
          open
          group={dialog.group}
          roles={roles.data ?? []}
          hotels={hotels.data ?? []}
          users={users.data ?? []}
          onClose={() => setDialog(null)}
        />
      )}

      <AlertDialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.type === 'user' ? 'Archive' : 'Delete'} {confirm?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.type === 'user'
                ? 'The account can no longer sign in and its sessions end. It stays in the list, keeps its email reserved, and can be restored.'
                : confirm?.type === 'group'
                  ? 'Members lose any access they received through this group.'
                  : 'The role is removed. It must have no remaining assignments.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doConfirm} className="bg-bad text-white hover:bg-bad/90">
              {confirm?.type === 'user' ? 'Archive' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Users tab ────────────────────────────────────────────────────────────────
function UsersTab({
  users,
  groups,
  search,
  onOpen,
}: {
  users: AccessUser[];
  groups: AccessGroup[];
  search: string;
  onOpen: (id: number) => void;
}) {
  const groupName = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);
  const q = search.trim().toLowerCase();
  const rows = users.filter(
    (u) => !q || `${u.name} ${u.email} ${u.title ?? ''} ${u.department ?? ''}`.toLowerCase().includes(q)
  );

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow)]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse">
          <thead>
            <tr>
              {['User', 'Title', 'Access', 'Groups', 'Status', 'Last sign-in'].map((h) => (
                <th key={h} className="whitespace-nowrap border-b border-line px-4 py-[10px] text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-ink3">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const hotelsCount = Object.keys(u.effective).length;
              const roleNames = Array.from(new Set(Object.values(u.effective).map((e) => e.roleName)));
              const access = hotelsCount
                ? `${roleNames.join(', ')} · ${hotelsCount} ${hotelsCount === 1 ? 'property' : 'properties'}`
                : 'No access';
              const grpNames = u.groupIds.map((id) => groupName.get(id)).filter(Boolean).join(', ') || '—';
              const pill = STATUS_PILL[u.status] ?? STATUS_PILL.active;
              return (
                <tr key={u.id} onClick={() => onOpen(u.id)} className="cursor-pointer hover:bg-surface2">
                  <td className="whitespace-nowrap border-b border-line2 px-4 py-[10px]">
                    <div className="flex items-center gap-[10px]">
                      <span className="flex size-[30px] flex-none items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: avatarColor(u.email) }}>
                        {initials(u.name)}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold text-ink">{u.name}</span>
                        <span className="block font-mono text-[11px] text-ink3">{u.email}</span>
                      </span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap border-b border-line2 px-4 py-[10px] text-[12.5px] text-ink2">{u.title || '—'}</td>
                  <td className="whitespace-nowrap border-b border-line2 px-4 py-[10px] text-[12.5px] text-ink2">{access}</td>
                  <td className="max-w-[180px] truncate border-b border-line2 px-4 py-[10px] text-[12.5px] text-ink2">{grpNames}</td>
                  <td className="whitespace-nowrap border-b border-line2 px-4 py-[10px]">
                    <span className="inline-flex items-center gap-[6px] rounded-full px-[10px] py-[2px] text-[10.5px] font-bold tracking-[0.04em]" style={{ background: pill.bg, color: pill.color }}>
                      <span className="size-[6px] rounded-full bg-current" />
                      {pill.label}
                    </span>
                  </td>
                  <td className="whitespace-nowrap border-b border-line2 px-4 py-[10px] text-[11.5px] tabular-nums text-ink3">{fmtLogin(u.lastLogin)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <div className="p-[26px_16px] text-center text-[12.5px] text-ink3">No users match your search.</div>}
    </div>
  );
}

// ── Roles tab ────────────────────────────────────────────────────────────────
function RolesTab({
  roles,
  search,
  canManage,
  onEdit,
  onDelete,
}: {
  roles: AccessRole[];
  search: string;
  canManage: boolean;
  onEdit: (r: AccessRole) => void;
  onDelete: (r: AccessRole) => void;
}) {
  const q = search.trim().toLowerCase();
  const shown = roles.filter((r) => !q || `${r.name} ${r.description}`.toLowerCase().includes(q));
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(310px,1fr))] gap-[14px]">
      {shown.map((r) => {
        const canDelete = canManage && !r.builtin && r.usage.direct === 0 && r.usage.groups === 0;
        return (
          <div key={r.id} className="flex flex-col gap-[10px] rounded-xl border border-line bg-surface p-[16px_18px] shadow-[var(--shadow)]">
            <div className="flex items-center gap-2">
              <span className="text-[14.5px] font-bold">{r.name}</span>
              {r.builtin && (
                <span className="rounded-full border border-line bg-surface2 px-2 py-[2px] text-[10px] font-bold tracking-[0.06em] text-ink3">BUILT-IN</span>
              )}
              <div className="flex-1" />
              {canManage && !r.builtin && (
                <>
                  <button onClick={() => onEdit(r)} title="Edit role" className="flex size-[26px] items-center justify-center rounded-[7px] text-ink3 hover:bg-surface2 hover:text-ink">
                    <Pencil size={12} />
                  </button>
                  {canDelete && (
                    <button onClick={() => onDelete(r)} title="Delete role" className="flex size-[26px] items-center justify-center rounded-[7px] text-ink3 hover:bg-bad-soft hover:text-bad">
                      <Trash2 size={12} />
                    </button>
                  )}
                </>
              )}
            </div>
            <div className="min-h-[34px] text-[12px] leading-[1.5] text-ink2">{r.description || '—'}</div>
            <div className="flex flex-col gap-[6px] border-t border-line2 pt-[10px]">
              {RESOURCES.map((res) => {
                const lv = LEVEL_PILL[r.perms[res.key] ?? 'none'];
                return (
                  <div key={res.key} className="flex items-center gap-2">
                    <span className="flex-1 text-[12px] text-ink2">{res.label}</span>
                    <span className="rounded-full px-[9px] py-[2px] text-[10.5px] font-bold" style={{ background: lv.bg, color: lv.color }}>
                      {lv.label}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="text-[11px] text-ink3">
              {r.usage.direct} direct assignment{r.usage.direct === 1 ? '' : 's'} · used by {r.usage.groups} group{r.usage.groups === 1 ? '' : 's'}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Groups tab ───────────────────────────────────────────────────────────────
function GroupsTab({
  groups,
  users,
  search,
  canManage,
  onEdit,
  onDelete,
}: {
  groups: AccessGroup[];
  users: AccessUser[];
  search: string;
  canManage: boolean;
  onEdit: (g: AccessGroup) => void;
  onDelete: (g: AccessGroup) => void;
}) {
  const userName = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users]);
  const q = search.trim().toLowerCase();
  const shown = groups.filter((g) => !q || g.name.toLowerCase().includes(q));
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow)]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] border-collapse">
          <thead>
            <tr>
              {['Group', 'Role', 'Properties', 'Members', ''].map((h, i) => (
                <th key={i} className="whitespace-nowrap border-b border-line px-4 py-[10px] text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-ink3">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((g) => (
              <tr key={g.id} className="hover:bg-surface2">
                <td className="whitespace-nowrap border-b border-line2 px-4 py-[11px] text-[13px] font-semibold text-ink">{g.name}</td>
                <td className="whitespace-nowrap border-b border-line2 px-4 py-[11px]">
                  <span className="rounded-full bg-brand-soft px-[10px] py-[2px] text-[11px] font-bold text-brand">{g.roleName}</span>
                </td>
                <td className="whitespace-nowrap border-b border-line2 px-4 py-[11px] text-[12.5px] text-ink2">{g.hotelIds.map((h) => h.toUpperCase()).join(' · ')}</td>
                <td className="max-w-[240px] truncate border-b border-line2 px-4 py-[11px] text-[12.5px] text-ink2">
                  {g.memberIds.map((id) => userName.get(id)).filter(Boolean).join(', ') || 'No members'}
                </td>
                <td className="whitespace-nowrap border-b border-line2 px-3 py-[11px]">
                  {canManage && (
                    <div className="flex justify-end gap-[4px]">
                      <button onClick={() => onEdit(g)} title="Edit group" className="flex size-[28px] items-center justify-center rounded-[7px] text-ink3 hover:bg-surface2 hover:text-ink">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => onDelete(g)} title="Delete group" className="flex size-[28px] items-center justify-center rounded-[7px] text-ink3 hover:bg-bad-soft hover:text-bad">
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
    </div>
  );
}

// ── Properties tab ───────────────────────────────────────────────────────────
function HotelsTab({ hotels, users, groups }: { hotels: AccessHotel[]; users: AccessUser[]; groups: AccessGroup[] }) {
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-[14px]">
        {hotels.map((h) => {
          const withAccess = users.filter((u) => u.effective[h.id]);
          const admins = withAccess.filter((u) => u.effective[h.id].roleId === 'admin').length;
          const grp = groups.filter((g) => g.hotelIds.includes(h.id)).length;
          return (
            <div key={h.id} className="flex flex-col gap-[12px] rounded-xl border border-line bg-surface p-[16px_18px] shadow-[var(--shadow)]">
              <div className="flex items-center gap-[11px]">
                <span className="flex h-[30px] w-[40px] flex-none items-center justify-center rounded-[7px] bg-brand-soft font-mono text-[11px] font-bold text-brand">{h.code}</span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-bold">{h.name}</span>
                  <span className="block text-[11.5px] text-ink3">{h.city}</span>
                </span>
              </div>
              <div className="flex gap-4 border-t border-line2 pt-[11px] text-[12px] text-ink2">
                <span><strong className="font-bold text-ink">{withAccess.length}</strong> users</span>
                <span><strong className="font-bold text-ink">{grp}</strong> groups</span>
                <span><strong className="font-bold text-ink">{admins}</strong> admins</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-1 text-[11.5px] text-ink3">
        Each property is a separate scope — users only see the dashboards they've been granted access to.
      </div>
    </>
  );
}

// ── Per-user drawer ──────────────────────────────────────────────────────────
function UserDrawer({
  user,
  roles,
  groups,
  hotels,
  canManage,
  onClose,
  onEdit,
  onDelete,
}: {
  user: AccessUser | null;
  roles: AccessRole[];
  groups: AccessGroup[];
  hotels: AccessHotel[];
  canManage: boolean;
  onClose: () => void;
  onEdit: (u: AccessUser) => void;
  onDelete: (u: AccessUser) => void;
}) {
  const { user: me } = useAuth();
  const setAssignments = useSetAssignments();
  const setMemberships = useSetMemberships();
  const updateUser = useUpdateUser();
  const restoreUser = useRestoreUser();

  if (!user) return null;
  const pill = STATUS_PILL[user.status] ?? STATUS_PILL.active;
  const isSelf = user.id === me?.id;
  const isArchived = user.status === 'archived';
  // The same rule the server applies: nobody changes their own access here, and
  // an archived account holds none. The explanation below is derived from it.
  const canChangeAccess = canManage && !isSelf && !isArchived;
  const accessLockedReason = !canManage
    ? null
    : isSelf
      ? 'This is your own account — another administrator must change its access.'
      : isArchived
        ? 'Restore this archived account before changing its access.'
        : null;

  const setDirectRole = (hotelId: string, roleId: string) => {
    const next = user.assignments.filter((a) => a.hotelId !== hotelId);
    if (roleId) next.push({ hotelId, roleId });
    setAssignments.mutate({ id: user.id, assignments: next }, { onError: (e: Error) => toast.error(e.message) });
  };
  const toggleGroup = (gid: number) => {
    const next = user.groupIds.includes(gid) ? user.groupIds.filter((x) => x !== gid) : [...user.groupIds, gid];
    setMemberships.mutate({ id: user.id, groupIds: next }, { onError: (e: Error) => toast.error(e.message) });
  };

  return (
    <div className="absolute inset-y-0 right-0 z-50 flex w-[380px] max-w-[92vw] flex-col border-l border-line bg-surface shadow-[-12px_0_32px_rgba(16,24,40,0.12)]">
      <div className="border-b border-line p-[16px_18px_14px]">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-[6px] rounded-full px-[10px] py-[3px] text-[10.5px] font-bold tracking-[0.05em]" style={{ background: pill.bg, color: pill.color }}>
            <span className="size-[7px] rounded-full bg-current" />
            {pill.label}
          </span>
          <div className="flex-1" />
          <button onClick={onClose} className="flex size-[28px] items-center justify-center rounded-[7px] text-ink3 hover:bg-surface2 hover:text-ink">
            <X size={13} />
          </button>
        </div>
        <div className="mt-[10px] flex items-center gap-[13px]">
          <span className="flex size-[48px] flex-none items-center justify-center rounded-full text-[17px] font-bold text-white" style={{ background: avatarColor(user.email) }}>
            {initials(user.name)}
          </span>
          <span className="min-w-0">
            <span className="block text-[17px] font-bold">{user.name}</span>
            <span className="block text-[12px] text-ink2">{user.title || '—'} · {user.department || '—'}</span>
          </span>
          <div className="flex-1" />
          {canManage && !isArchived && (
            <button onClick={() => onEdit(user)} className="h-[30px] rounded-lg border border-line bg-surface px-[11px] text-[12px] font-semibold text-ink2 hover:text-ink">
              Edit
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-[4px_18px_14px]">
        <SectionLabel>Contact</SectionLabel>
        {[
          ['Email', user.email],
          ['Phone', user.phone || '—'],
          ['Department', user.department || '—'],
          ['Last sign-in', fmtLogin(user.lastLogin)],
        ].map(([k, v]) => (
          <div key={k} className="grid grid-cols-[96px_1fr] items-baseline gap-[10px] border-b border-line2 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-ink3">{k}</span>
            <span className="text-[12.5px] text-ink [overflow-wrap:anywhere]">{v}</span>
          </div>
        ))}

        <SectionLabel>Property access</SectionLabel>
        {accessLockedReason && <div className="pb-2 text-[11.5px] leading-[1.5] text-ink3">{accessLockedReason}</div>}
        <div className="flex flex-col gap-2">
          {hotels.map((h) => {
            const direct = user.assignments.find((a) => a.hotelId === h.id);
            const eff = user.effective[h.id];
            const viaGroups = eff ? eff.sources.filter((s) => s.startsWith('group:')).map((s) => s.slice(6)) : [];
            return (
              <div key={h.id} className="flex flex-col gap-[5px] rounded-[10px] border border-line bg-surface2 p-[10px_12px]">
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-[12.5px] font-semibold">{h.name}</span>
                  <select
                    value={direct?.roleId ?? ''}
                    disabled={!canChangeAccess}
                    onChange={(e) => setDirectRole(h.id, e.target.value)}
                    className="h-7 rounded-[7px] border border-line bg-surface px-[7px] text-[11.5px] text-ink disabled:opacity-60"
                  >
                    <option value="">— No direct role</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
                {viaGroups.length > 0 && (
                  <div className="text-[10.5px] text-ink3">
                    {eff ? `Effective: ${eff.roleName} — ` : ''}via {viaGroups.join(', ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <SectionLabel>Groups</SectionLabel>
        <div className="flex flex-wrap gap-[6px]">
          {groups.map((g) => {
            const inGroup = user.groupIds.includes(g.id);
            return (
              <button
                key={g.id}
                onClick={() => canChangeAccess && toggleGroup(g.id)}
                disabled={!canChangeAccess}
                className={cn(
                  'flex items-center gap-[6px] rounded-full border px-[11px] py-[5px] text-[11.5px] font-semibold',
                  inGroup ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface text-ink3',
                  canChangeAccess ? 'cursor-pointer' : 'cursor-default'
                )}
              >
                {g.name}
                {inGroup && <span>✓</span>}
              </button>
            );
          })}
        </div>

        {canManage && (
          <div className="mt-5 flex flex-col gap-2 border-t border-line pt-[14px]">
            {isArchived ? (
              <button
                onClick={() => restoreUser.mutate(user.id, { onSuccess: () => toast.success('Account restored'), onError: (e: Error) => toast.error(e.message) })}
                className="h-[34px] rounded-[9px] border border-line bg-surface text-[12.5px] font-semibold"
                style={{ color: 'var(--ok)' }}
              >
                Restore account
              </button>
            ) : isSelf ? (
              <div className="text-[11.5px] leading-[1.5] text-ink3">You can't suspend or archive your own account.</div>
            ) : (
              <>
                <button
                  onClick={() => updateUser.mutate({ id: user.id, patch: { status: user.status === 'suspended' ? 'active' : 'suspended' } }, { onError: (e: Error) => toast.error(e.message) })}
                  className="h-[34px] rounded-[9px] border border-line bg-surface text-[12.5px] font-semibold"
                  style={{ color: user.status === 'suspended' ? 'var(--ok)' : 'var(--warn)' }}
                >
                  {user.status === 'suspended' ? 'Re-activate account' : 'Suspend account'}
                </button>
                <button onClick={() => onDelete(user)} className="h-[34px] rounded-[9px] border border-line bg-surface text-[12.5px] font-semibold text-bad">
                  Archive user
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="pb-[6px] pt-4 text-[10.5px] font-bold uppercase tracking-[0.09em] text-ink3">{children}</div>;
}
