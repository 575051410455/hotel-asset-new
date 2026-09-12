import type { ComponentType } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  LayoutGrid,
  MapPin,
  Cctv,
  Wifi,
  Monitor,
  QrCode,
  User,
  ShieldCheck,
  Layers,
  LogOut,
  ChevronsUpDown,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { HotelSwitcher } from './hotel-switcher';
import { useAuth } from '@/lib/auth';
import { useFloors } from '@/lib/devices';
import { avatarColor, initials } from '@/lib/types';

type Icon = ComponentType<{ size?: number | string; strokeWidth?: number | string }>;
type NavItem = {
  label: string;
  icon: Icon;
  to: string;
  search?: Record<string, string>;
  active: boolean;
};

function NavGroup({ label, items, onNavigate }: { label?: string; items: NavItem[]; onNavigate?: () => void }) {
  if (items.length === 0) return null;
  return (
    <SidebarGroup>
      {label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
      <SidebarMenu>
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <SidebarMenuItem key={item.label}>
              <SidebarMenuButton asChild isActive={item.active} tooltip={item.label}>
                <Link to={item.to} search={item.search} onClick={onNavigate}>
                  <Icon strokeWidth={1.6} />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}

export function AppSidebar() {
  const { activeHotelId, can } = useAuth();
  const { data: floors = [] } = useFloors(activeHotelId);
  const { location } = useRouterState();
  const path = location.pathname;
  const tab = (location.search as { tab?: string }).tab ?? 'ws';
  const floorParam = (location.search as { floor?: string }).floor;

  // ── Floor group — fully data-driven off GET /api/floors (zero code per floor)
  const floorItems: NavItem[] = floors.map((f) => {
    const isCctv = f.kind === 'cctv';
    const to = isCctv ? '/cctv' : '/workstation';
    return {
      label: f.short,
      icon: isCctv ? Cctv : MapPin,
      to,
      search: { floor: f.id },
      active: path === to && floorParam === f.id,
    };
  });

  const dashboardItem: NavItem[] = [
    { label: 'Dashboard', icon: LayoutGrid, to: '/dashboard', search: undefined, active: path === '/dashboard' },
  ];

  const equipmentItems: NavItem[] = [
    { label: 'Workstations', icon: Monitor, to: '/dashboard', search: { tab: 'ws' }, active: path === '/dashboard' && tab === 'ws' },
    { label: 'CCTV cameras', icon: Cctv, to: '/dashboard', search: { tab: 'cam' }, active: path === '/dashboard' && tab === 'cam' },
    { label: 'Wi-Fi access points', icon: Wifi, to: '/dashboard', search: { tab: 'ap' }, active: path === '/dashboard' && tab === 'ap' },
    { label: 'Asset stickers', icon: QrCode, to: '/stickers', search: undefined, active: path === '/stickers' },
  ];

  const adminItems: NavItem[] = [
    ...(can('floors', 'read')
      ? [
          {
            label: 'Manage floors',
            icon: Layers,
            to: '/floors',
            search: undefined,
            active: path === '/floors',
          } as NavItem,
        ]
      : []),
    { label: 'My profile', icon: User, to: '/profile', search: undefined, active: path === '/profile' },
    { label: 'Access control', icon: ShieldCheck, to: '/access', search: undefined, active: path === '/access' },
  ];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <HotelSwitcher />
      </SidebarHeader>

      <SidebarContent>
        <NavGroup items={dashboardItem} />
        <NavGroup label="Floor" items={floorItems} />
        <NavGroup label="Equipment" items={equipmentItems} />
        <NavGroup label="Administration" items={adminItems} />
      </SidebarContent>

      <SidebarFooter>
        <UserMenu />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <span
                className="flex aspect-square size-8 items-center justify-center rounded-full text-[11px] font-bold text-white"
                style={{ background: user ? avatarColor(user.email) : 'var(--ink3)' }}
              >
                {user ? initials(user.name) : '·'}
              </span>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-[12px] font-semibold">{user?.name ?? 'Not signed in'}</span>
                <span className="truncate text-[10.5px] text-ink3">{user?.email ?? ''}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 text-ink3" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[220px]" align="end" side="right" sideOffset={4}>
            <DropdownMenuItem onClick={logout} className="text-bad focus:text-bad">
              <LogOut className="size-4" />
              Sign out
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
