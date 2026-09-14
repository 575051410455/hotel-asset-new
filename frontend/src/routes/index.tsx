import { createFileRoute, redirect } from '@tanstack/react-router';
import { hasSession } from '@/lib/api';

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    throw redirect({ to: (await hasSession()) ? '/dashboard' : '/login' });
  },
});
