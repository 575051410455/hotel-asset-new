import { Check, ChevronsUpDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar';
import { BrandMark } from './brand-mark';
import { useAuth } from '@/lib/auth';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator',
  manager: 'IT Manager',
  viewer: 'Viewer',
};

// Sidebar header. Expanded: brand mark + "Ops Monitor" + active property.
// Collapsed (icon rail): just the brand mark (the text/chevron are clipped by
// the icon-size button). When the user can see >1 property it's a dropdown.
export function HotelSwitcher() {
  const { hotels, activeHotel, setActiveHotelId } = useAuth();
  const { isMobile } = useSidebar();
  const multi = hotels.length > 1;

  const button = (
    <SidebarMenuButton
      size="lg"
      className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
    >
      <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-brand text-white">
        <BrandMark />
      </div>
      <div className="grid flex-1 text-left leading-tight">
        <span className="truncate text-[13.5px] font-bold">Ops Monitor</span>
        <span className="truncate text-[10.5px] text-ink3">{activeHotel?.name ?? '—'}</span>
      </div>
      {multi && <ChevronsUpDown className="ml-auto size-4 text-ink3" />}
    </SidebarMenuButton>
  );

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {multi ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-[248px]"
              align="start"
              side={isMobile ? 'bottom' : 'right'}
              sideOffset={4}
            >
              <DropdownMenuLabel className="text-[10.5px] uppercase tracking-[0.08em] text-ink3">
                Properties
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {hotels.map((h) => (
                <DropdownMenuItem
                  key={h.id}
                  onClick={() => setActiveHotelId(h.id)}
                  className="flex items-center gap-[10px] py-[7px]"
                >
                  <span className="flex h-[24px] w-[32px] flex-none items-center justify-center rounded-[6px] bg-brand-soft font-mono text-[10px] font-bold tracking-[0.04em] text-brand">
                    {h.code}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold text-ink">{h.name}</span>
                    <span className="block truncate text-[11px] text-ink3">
                      {h.city} · {ROLE_LABEL[h.roleId] ?? h.roleId}
                    </span>
                  </span>
                  {activeHotel?.id === h.id && <Check className="size-4 flex-none text-brand" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          button
        )}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
