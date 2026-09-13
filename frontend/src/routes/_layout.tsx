import { createFileRoute, redirect, Outlet } from '@tanstack/react-router';
import { hasSession } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AppSidebar } from '@/components/app-shell/app-sidebar';
import { Topbar } from '@/components/app-shell/topbar';
import { PageHeaderProvider } from '@/components/app-shell/page-header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Spinner } from '@/components/ui/spinner';

export const Route = createFileRoute('/_layout')({
  beforeLoad: async () => {
    if (!(await hasSession())) {
      throw redirect({ to: '/login' });
    }
  },
  component: LayoutShell,
});

function LayoutShell() {
  const { isLoading, hotels } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg">
        <Spinner className="size-6 text-brand" />
      </div>
    );
  }

  if (hotels.length === 0) {
    return <NoAccess />;
  }

  return (
    <PageHeaderProvider>
      <SidebarProvider className="h-svh min-h-0 overflow-hidden text-ink">
        <AppSidebar />
        <SidebarInset className="flex min-h-0 flex-col overflow-hidden bg-bg">
          <Topbar />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </PageHeaderProvider>
  );
}

function NoAccess() {
  const { user, logout } = useAuth();
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-bg px-6 text-center">
      <div className="text-[18px] font-bold text-ink">No properties assigned</div>
      <div className="max-w-[380px] text-[13px] text-ink2">
        {user?.name ? `${user.name}, your` : 'Your'} account doesn't have access to any property
        yet. Ask IT Operations to grant you access.
      </div>
      <button
        onClick={logout}
        className="mt-2 h-9 rounded-lg border border-line bg-surface px-4 text-[13px] font-semibold text-ink2 hover:bg-surface2 hover:text-ink"
      >
        Sign out
      </button>
    </div>
  );
}
