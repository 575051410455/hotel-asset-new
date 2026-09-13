// Types shared with the backend (type-only imports across the @backend alias).
import type { Device, Floor } from '@backend/db/schema';
import type { HotelAccess } from '@backend/lib/session';

export type { Device, Floor, HotelAccess };

export type DeviceStatus = 'active' | 'paused' | 'nodata' | 'rec' | 'offline';
export type PermLevel = 'none' | 'read' | 'crud';
export type Resource = 'devices' | 'floors' | 'cctv' | 'userManagement';

export type FloorWithPins = Floor & { pins: Device[] };

export type AuthUser = {
  id: number;
  email: string;
  name: string;
  avatar: string | null;
  phone: string | null;
  title: string | null;
  department: string | null;
  status: string;
  lastLogin: string | null;
  createdAt: string | null;
};

export type MeResponse = { user: AuthUser; hotels: HotelAccess[] };
export type LoginResponse = { user: AuthUser; hotels: HotelAccess[] };

// ── Status presentation ──────────────────────────────────────────────────────
// Unified status → presentation map (ported verbatim from the Dashboard's
// STATUS_INFO). `color` is the dot/text color; `soft` is the pill background.
export type StatusMeta = { label: string; color: string; soft: string };

export const STATUS_INFO: Record<string, StatusMeta> = {
  active: { label: 'ONLINE', color: 'var(--ok)', soft: 'var(--ok-soft)' },
  paused: { label: 'PAUSED', color: 'var(--warn)', soft: 'var(--warn-soft)' },
  nodata: { label: 'NO DATA', color: 'var(--nodata)', soft: 'var(--nodata-soft)' },
  rec: { label: 'REC', color: 'var(--bad)', soft: 'var(--bad-soft)' },
  offline: { label: 'OFFLINE', color: 'var(--offline)', soft: 'var(--offline-soft)' },
};

export function isCameraDevice(d: Pick<Device, 'type'>): boolean {
  return d.type === 'IP Camera';
}

// Normalize an unknown status to a known one (cameras fall back to offline,
// everything else to no-data) — matches the prototype's `norm()`.
export function normStatus(d: Pick<Device, 'type' | 'status'>): string {
  if (STATUS_INFO[d.status]) return d.status;
  return isCameraDevice(d) ? 'offline' : 'nodata';
}

export function statusMeta(status: string): StatusMeta {
  return STATUS_INFO[status] ?? { label: status, color: 'var(--ink3)', soft: 'var(--surface2)' };
}

// Deterministic avatar color (ported from auth-config.js).
const AVATAR_COLORS = ['#2563EB', '#7C3AED', '#0D9488', '#DB2777', '#D97706', '#475569'];
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
export function initials(name: string): string {
  return String(name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
