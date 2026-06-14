import { useState } from 'react';
import { createFileRoute, useNavigate, redirect } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, unwrap, TOKEN_KEY } from '@/lib/api';
import type { LoginResponse } from '@/lib/types';

export const Route = createFileRoute('/login')({
  beforeLoad: () => {
    if (localStorage.getItem(TOKEN_KEY)) throw redirect({ to: '/dashboard' });
  },
  component: LoginPage,
});

const BRAND_HOTELS = [
  { code: 'RH2', name: 'Richmond Hotel 2', city: 'Nonthaburi' },
  { code: 'RH3', name: 'Richmond Stylish 3', city: 'Bangkok' },
  { code: 'RBR', name: 'Richmond Beach Resort', city: 'Pattaya' },
];

const DEMOS = [
  { label: 'Administrator', email: 'chai@richmond.local', pwd: 'admin123', note: 'All 3 properties', color: 'var(--brand)' },
  { label: 'IT Manager', email: 'smart@richmond.local', pwd: 'manager123', note: 'RH2 + RH3', color: 'var(--ok)' },
  { label: 'Viewer (read-only)', email: 'gift@richmond.local', pwd: 'user123', note: 'RH2 only', color: 'var(--warn)' },
];

function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [pwd, setPwd] = useState('');
  const [error, setError] = useState('');

  const login = useMutation({
    mutationFn: (vars: { email: string; password: string }) =>
      api.auth.login.$post({ json: vars }).then(unwrap) as Promise<LoginResponse>,
    onSuccess: (data) => {
      localStorage.setItem(TOKEN_KEY, data.token);
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
                placeholder="you@richmond.local"
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
          </div>

          <div className="mt-[26px]">
            <div className="flex items-center gap-[10px]">
              <div className="h-px flex-1 bg-line" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">
                Demo accounts
              </span>
              <div className="h-px flex-1 bg-line" />
            </div>
            <div className="mt-[12px] flex flex-col gap-[7px]">
              {DEMOS.map((d) => (
                <button
                  key={d.email}
                  onClick={() => {
                    setEmail(d.email);
                    setPwd(d.pwd);
                    setError('');
                  }}
                  className="flex items-center gap-[10px] rounded-[10px] border border-line bg-surface px-[12px] py-[9px] text-left transition-colors hover:border-brand hover:bg-brand-soft"
                >
                  <span className="size-2 flex-none rounded-full" style={{ background: d.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-semibold text-ink">{d.label}</span>
                    <span className="block font-mono text-[11px] text-ink3">{d.email}</span>
                  </span>
                  <span className="whitespace-nowrap text-[11px] text-ink3">{d.note}</span>
                </button>
              ))}
            </div>
            <div className="mt-[16px] text-center text-[11px] text-ink3">
              Signed accounts are stored on the Ops Monitor server.
            </div>
          </div>
        </div>
      </div>
    </div>
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
