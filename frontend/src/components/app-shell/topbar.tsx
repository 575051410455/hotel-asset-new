import { ThemeToggle } from './theme-toggle';
import { usePageHeaderState } from './page-header';
import { SidebarTrigger } from '@/components/ui/sidebar';

export function Topbar() {
  const { title, subtitle, badge, actions } = usePageHeaderState();
  return (
    <div className="flex h-[54px] flex-none items-center gap-[12px] border-b border-line bg-surface px-[18px]">
      <SidebarTrigger className="-ml-2 size-[34px] flex-none rounded-lg border border-line text-ink2 hover:bg-surface2 hover:text-ink" />
      <span className="text-[14px] font-bold">{title}</span>
      {subtitle && <span className="hidden text-[12px] text-ink3 sm:inline">{subtitle}</span>}
      {badge}
      <div className="flex-1" />
      {actions}
      <ThemeToggle />
    </div>
  );
}

// Read-only pill shown when the user lacks CRUD on the current resource.
export function ReadOnlyBadge() {
  return (
    <span className="inline-flex items-center gap-[6px] rounded-full bg-warn-soft px-[10px] py-[3px] text-[10.5px] font-bold tracking-[0.05em] text-warn">
      READ-ONLY
    </span>
  );
}
