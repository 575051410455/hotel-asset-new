import { useEffect, useState } from 'react';
import { createFileRoute, useNavigate, redirect } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap, hasSession } from '@/lib/api';
import { Button } from '@/components/ui/button';
import type { LoginResponse } from '@/lib/types';

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    if (await hasSession()) throw redirect({ to: '/dashboard' });
  },
  component: LoginPage,
});

const BRAND_HOTELS = [
  { code: 'RH2', name: 'Richmond Hotel 2', city: 'Nonthaburi' },
  { code: 'RH3', name: 'Richmond Stylish 3', city: 'Bangkok' },
  { code: 'RBR', name: 'Richmond Beach Resort', city: 'Pattaya' },
];

function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [pwd, setPwd] = useState('');
  const [error, setError] = useState('');

  // Is "Continue with Google" available on this server?
  const { data: providers } = useQuery<{ google: boolean }>({
    queryKey: ['auth-providers'],
    queryFn: () => api.auth.providers.$get().then(unwrap),
    staleTime: Infinity,
    retry: false,
  });

  // Handle the return trip from the Google callback: the backend redirects to
  // /login#signed-in on success or /login#error=… on failure.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const params = new URLSearchParams(hash);
    const err = params.get('error');
    // Clear the fragment so a refresh doesn't re-trigger this.
    history.replaceState(null, '', window.location.pathname + window.location.search);
    if (hash === 'signed-in') {
      navigate({ to: '/dashboard' });
    } else if (err) {
      setError(err);
    }
  }, [navigate]);

  const login = useMutation({
    mutationFn: (vars: { email: string; password: string }) =>
      api.auth.login.$post({ json: vars }).then(unwrap) as Promise<LoginResponse>,
    onSuccess: (data) => {
      queryClient.setQueryData(['me'], { user: data.user, hotels: data.hotels });
      navigate({ to: '/dashboard' });
    },
    onError: (e: Error) => setError(e.message || 'Sign in failed.'),
  });

  const submit = () => {
    if (login.isPending) return;
    setError('');
    login.mutate({ email: email.trim(), password: pwd });
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') submit();
  };

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-ink">
      {/* Brand panel */}
      <div
        className="hidden w-[42%] min-w-[360px] flex-col justify-between p-[42px_44px] text-[#E8EFF8] md:flex"
        style={{ background: 'linear-gradient(160deg, #122643 0%, #0B1626 70%)' }}
      >
        <div className="flex items-center gap-[11px]">
          <div className="flex size-[34px] items-center justify-center rounded-[9px] bg-brand text-brand-foreground">
            <RadarIcon />
          </div>
          <div className="text-[16px] font-bold tracking-[-0.01em]">Ops Monitor</div>
        </div>

        <div>
          <div className="max-w-[380px] text-[30px] font-bold leading-[1.25] tracking-[-0.02em] text-pretty">
            Every workstation, camera and access point — across all properties.
          </div>
          <div className="mt-[26px] flex flex-col gap-[10px]">
            {BRAND_HOTELS.map((h) => (
              <div
                key={h.code}
                className="flex items-center gap-[12px] rounded-[11px] border border-white/10 bg-white/[0.06] px-[14px] py-[11px]"
              >
                <span className="flex h-[26px] w-[34px] items-center justify-center rounded-[6px] bg-white/[0.12] font-mono text-[10.5px] font-bold tracking-[0.04em]">
                  {h.code}
                </span>
                <span className="flex-1 text-[13.5px] font-semibold">{h.name}</span>
                <span className="text-[11.5px] text-[rgba(232,239,248,0.55)]">{h.city}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="text-[11.5px] leading-[1.5] text-[rgba(232,239,248,0.45)]">
          Access is granted per property — directly or through groups. Ask IT Operations for an account.
        </div>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
        <div className="w-[400px] max-w-full">
          <div className="text-[22px] font-bold tracking-[-0.01em]">Sign in</div>
          <div className="mt-[5px] text-[13px] text-ink2">Use your Ops Monitor account to continue.</div>

          <div className="mt-[20px] flex flex-col gap-[13px]">
            <label className="flex flex-col gap-[6px]">
              <span className="text-[12px] font-semibold text-ink2">Email</span>
              <input
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError('');
                }}
                onKeyDown={onKey}
                placeholder="you@company.com"
                autoFocus
                className="h-10 rounded-[10px] border border-line bg-surface px-[13px] text-[13.5px] outline-none focus:border-brand"
              />
            </label>
            <label className="flex flex-col gap-[6px]">
              <span className="text-[12px] font-semibold text-ink2">Password</span>
              <input
                type="password"
                value={pwd}
                onChange={(e) => {
                  setPwd(e.target.value);
                  setError('');
                }}
                onKeyDown={onKey}
                placeholder="••••••••"
                className="h-10 rounded-[10px] border border-line bg-surface px-[13px] text-[13.5px] outline-none focus:border-brand"
              />
            </label>
            {error && (
              <div className="rounded-[9px] bg-bad-soft px-[13px] py-[9px] text-[12.5px] font-semibold text-bad">
                {error}
              </div>
            )}
            <button
              onClick={submit}
              disabled={login.isPending}
              className="h-[42px] rounded-[10px] bg-brand text-[14px] font-bold text-brand-foreground transition-opacity disabled:opacity-70"
            >
              {login.isPending ? 'Signing in…' : 'Sign in'}
            </button>

            {providers?.google && (
              <>
                <div className="flex items-center gap-[10px]">
                  <div className="h-px flex-1 bg-line" />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">
                    or
                  </span>
                  <div className="h-px flex-1 bg-line" />
                </div>
                <Button
                  asChild
                  variant="outline"
                  className="h-[42px] w-full gap-[10px] rounded-[10px] text-[14px] font-semibold"
                >
                  <a href="/api/auth/google/start">
                    <GoogleIcon />
                    Continue with Google
                  </a>
                </Button>
              </>
            )}
          </div>

          <div className="mt-[26px] text-center text-[11px] text-ink3">
            Accounts are issued by IT Operations. Contact your administrator for access.
          </div>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.92v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.92a9 9 0 0 0 0 8.1l3.06-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .92 4.95l3.06 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

function RadarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2" fill="currentColor" />
      <circle cx="8" cy="8" r="4.6" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.3" />
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.2" />
    </svg>
  );
}
