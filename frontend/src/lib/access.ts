import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './api';
import type { PermLevel } from './types';

export type RolePerms = { devices: PermLevel; floors: PermLevel; cctv: PermLevel; access: PermLevel };

export type AccessUser = {
  id: number;
  email: string;
  name: string;
  phone: string | null;
  title: string | null;
  department: string | null;
  status: string;
  lastLogin: string | null;
  assignments: { hotelId: string; roleId: string }[];
  groupIds: number[];
  effective: Record<string, { roleId: string; roleName: string; sources: string[] }>;
};

export type AccessRole = {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  perms: RolePerms;
  usage: { direct: number; groups: number };
};

export type AccessGroup = {
  id: number;
  name: string;
  roleId: string;
  roleName: string;
  hotelIds: string[];
  memberIds: number[];
};

export type AccessHotel = { id: string; code: string; name: string; city: string; sortOrder: number };

export function useAccessUsers() {
  return useQuery<AccessUser[]>({ queryKey: ['access', 'users'], queryFn: () => api.access.users.$get().then(unwrap) });
}
export function useAccessRoles() {
  return useQuery<AccessRole[]>({ queryKey: ['access', 'roles'], queryFn: () => api.access.roles.$get().then(unwrap) });
}
export function useAccessGroups() {
  return useQuery<AccessGroup[]>({ queryKey: ['access', 'groups'], queryFn: () => api.access.groups.$get().then(unwrap) });
}
export function useAccessHotels() {
  return useQuery<AccessHotel[]>({ queryKey: ['access', 'hotels'], queryFn: () => api.access.hotels.$get().then(unwrap) });
}

// Any access mutation can ripple across users/roles/groups, so invalidate all.
function useAccessMutation<TArgs>(fn: (a: TArgs) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['access'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

const uid = (id: number) => ({ id: String(id) });

// ── Users ──
export const useCreateUser = () =>
  useAccessMutation((body: Record<string, unknown>) => api.access.users.$post({ json: body }).then(unwrap));
export const useUpdateUser = () =>
  useAccessMutation(({ id, patch }: { id: number; patch: Record<string, unknown> }) =>
    api.access.users[':id'].$patch({ param: uid(id), json: patch }).then(unwrap)
  );
export const useDeleteUser = () =>
  useAccessMutation((id: number) => api.access.users[':id'].$delete({ param: uid(id) }).then(unwrap));
export const useResetPassword = () =>
  useAccessMutation((id: number) =>
    api.access.users[':id']['reset-password'].$post({ param: uid(id), json: {} }).then(unwrap)
  );
export const useSetAssignments = () =>
  useAccessMutation(({ id, assignments }: { id: number; assignments: { hotelId: string; roleId: string }[] }) =>
    api.access.users[':id'].assignments.$put({ param: uid(id), json: { assignments } }).then(unwrap)
  );
export const useSetMemberships = () =>
  useAccessMutation(({ id, groupIds }: { id: number; groupIds: number[] }) =>
    api.access.users[':id'].groups.$put({ param: uid(id), json: { groupIds } }).then(unwrap)
  );

// ── Roles ──
export const useCreateRole = () =>
  useAccessMutation((body: Record<string, unknown>) => api.access.roles.$post({ json: body }).then(unwrap));
export const useUpdateRole = () =>
  useAccessMutation(({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
    api.access.roles[':id'].$patch({ param: { id }, json: patch }).then(unwrap)
  );
export const useDeleteRole = () =>
  useAccessMutation((id: string) => api.access.roles[':id'].$delete({ param: { id } }).then(unwrap));

// ── Groups ──
export const useCreateGroup = () =>
  useAccessMutation((body: Record<string, unknown>) => api.access.groups.$post({ json: body }).then(unwrap));
export const useUpdateGroup = () =>
  useAccessMutation(({ id, patch }: { id: number; patch: Record<string, unknown> }) =>
    api.access.groups[':id'].$patch({ param: uid(id), json: patch }).then(unwrap)
  );
export const useDeleteGroup = () =>
  useAccessMutation((id: number) => api.access.groups[':id'].$delete({ param: uid(id) }).then(unwrap));
