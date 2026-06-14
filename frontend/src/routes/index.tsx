import { createFileRoute, redirect } from '@tanstack/react-router';
import { TOKEN_KEY } from '@/lib/api';

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: localStorage.getItem(TOKEN_KEY) ? '/dashboard' : '/login' });
  },
});
