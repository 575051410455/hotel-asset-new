import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { api, unwrap } from '@/lib/api';
import { avatarColor, initials, type AuthUser } from '@/lib/types';
import { useSetPageHeader } from '@/components/app-shell/page-header';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_layout/profile')({
  component: ProfilePage,
});

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator',
  manager: 'IT Manager',
  viewer: 'Viewer',
};

const EVENTS = [
  { key: 'deviceOffline', label: 'A workstation goes offline / no data' },
  { key: 'cameraStops', label: 'A camera stops recording' },
  { key: 'apOffline', label: 'A Wi-Fi access point goes offline' },
  { key: 'weekly', label: 'Weekly inventory summary (Mon 09:00)' },
];

const inputCls =
  'h-[34px] rounded-lg border border-line bg-bg px-[10px] text-[12.5px] text-ink outline-none focus:border-brand';
const card = 'rounded-xl border border-line bg-surface p-[18px_20px] shadow-[var(--shadow)]';
const darkBtn = 'h-[34px] rounded-lg bg-ink px-[16px] text-[12.5px] font-semibold text-bg';

function ProfilePage() {
  const { user, hotels } = useAuth();
  useSetPageHeader({ title: 'My profile', subtitle: 'Personal details, password & notifications' });

  if (!user) return null;

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 p-[20px_18px_28px]">
      <IdentityCard user={user} hotelsCount={hotels.length} />
      <PasswordCard />
      <PropertyAccessCard
        hotels={hotels.map((h) => ({ name: h.name, code: h.code, roleId: h.roleId, sources: h.sources }))}
      />
      <NotificationsCard userId={user.id} />
    </div>
  );
}

function IdentityCard({ user, hotelsCount }: { user: AuthUser; hotelsCount: number }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [title, setTitle] = useState(user.title ?? '');

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.auth.me.$patch({ json: body }).then(unwrap) as Promise<AuthUser>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      toast.success('Profile saved');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className={card}>
      <div className="flex items-center gap-[15px]">
        <span
          className="flex size-[56px] flex-none items-center justify-center rounded-full text-[19px] font-bold text-white"
          style={{ background: avatarColor(user.email) }}
        >
          {initials(user.name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-bold">{user.name}</span>
          <span className="mt-[2px] block text-[12.5px] text-ink2">
            {user.title || '—'} · {user.department || '—'}
          </span>
          <span className="mt-[2px] block text-[11px] text-ink3">
            Access to {hotelsCount} {hotelsCount === 1 ? 'property' : 'properties'}
          </span>
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-x-3 gap-y-[10px] border-t border-line2 pt-4 sm:grid-cols-2">
        <Field label="Full name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Email (sign-in — contact IT to change)">
          <input value={user.email} disabled className={`${inputCls} opacity-60`} />
        </Field>
        <Field label="Phone">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Job title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
        </Field>
      </div>

      <div className="mt-[14px] flex justify-end">
        <button
          onClick={() => save.mutate({ name: name.trim(), phone, title })}
          disabled={save.isPending || !name.trim()}
          className={`${darkBtn} disabled:opacity-60`}
        >
          {save.isPending ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </div>
  );
}

function PasswordCard() {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const change = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      api.auth['change-password'].$post({ json: body }).then(unwrap),
    onSuccess: () => {
      setMsg({ ok: true, text: '✓ Password updated. Use it next time you sign in.' });
      setCur('');
      setNext('');
      setConfirm('');
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });

  const submit = () => {
    setMsg(null);
    if (next.length < 8) return setMsg({ ok: false, text: 'New password must be at least 8 characters.' });
    if (next === cur) return setMsg({ ok: false, text: 'New password must be different from the current one.' });
    if (next !== confirm) return setMsg({ ok: false, text: 'New passwords do not match.' });
    change.mutate({ currentPassword: cur, newPassword: next });
  };

  return (
    <div className={card}>
      <div className="text-[14.5px] font-bold">Change password</div>
      <div className="mt-[3px] text-[12px] text-ink3">At least 8 characters. You'll stay signed in.</div>
      <div className="mt-[14px] grid grid-cols-1 gap-x-3 gap-y-[10px] sm:grid-cols-3">
        <Field label="Current password">
          <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder="••••••••" className={inputCls} />
        </Field>
        <Field label="New password">
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="min. 8 characters" className={inputCls} />
        </Field>
        <Field label="Confirm new password">
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="repeat it" className={inputCls} />
        </Field>
      </div>
      {msg && (
        <div
          className="mt-3 rounded-lg px-3 py-2 text-[12px] font-semibold"
          style={{
            background: msg.ok ? 'var(--ok-soft)' : 'var(--bad-soft)',
            color: msg.ok ? 'var(--ok)' : 'var(--bad)',
          }}
        >
          {msg.text}
        </div>
      )}
      <div className="mt-[14px] flex justify-end">
        <button onClick={submit} disabled={change.isPending} className={`${darkBtn} disabled:opacity-60`}>
          {change.isPending ? 'Updating…' : 'Update password'}
        </button>
      </div>
    </div>
  );
}

function PropertyAccessCard({
  hotels,
}: {
  hotels: { name: string; code: string; roleId: string; sources: string[] }[];
}) {
  return (
    <div className={card}>
      <div className="text-[14.5px] font-bold">Property access</div>
      <div className="mt-[3px] text-[12px] text-ink3">
        Granted per property — directly or through a group. Strongest role wins.
      </div>
      <div className="mt-[12px] flex flex-col gap-2">
        {hotels.map((h) => {
          const via = h.sources
            .map((s) => (s === 'direct' ? 'direct assignment' : s.replace('group:', 'group ')))
            .join(', ');
          return (
            <div
              key={h.code}
              className="flex items-center gap-[10px] rounded-[10px] border border-line bg-surface2 p-[10px_12px]"
            >
              <span className="flex h-[24px] w-[34px] flex-none items-center justify-center rounded-[6px] bg-brand-soft font-mono text-[10px] font-bold text-brand">
                {h.code}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-semibold">{h.name}</span>
                <span className="block text-[10.5px] text-ink3">via {via}</span>
              </span>
              <span className="rounded-full bg-brand-soft px-[10px] py-[2px] text-[11px] font-bold text-brand">
                {ROLE_LABEL[h.roleId] ?? h.roleId}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type NotifyState = {
  lineEnabled: boolean;
  lineToken: string;
  lineTarget: string;
  discordEnabled: boolean;
  discordUrl: string;
  events: Record<string, boolean>;
};
const DEFAULT_NOTIFY: NotifyState = {
  lineEnabled: false,
  lineToken: '',
  lineTarget: '',
  discordEnabled: false,
  discordUrl: '',
  events: { deviceOffline: true, cameraStops: true, apOffline: false, weekly: false },
};

function NotificationsCard({ userId }: { userId: number }) {
  const key = `om-notify-${userId}`;
  const [n, setN] = useState<NotifyState>(DEFAULT_NOTIFY);
  const [lineMsg, setLineMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [discordMsg, setDiscordMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setN({ ...DEFAULT_NOTIFY, ...JSON.parse(raw) });
    } catch {
      /* ignore */
    }
  }, [key]);

  const patch = (p: Partial<NotifyState>) => setN((cur) => ({ ...cur, ...p }));

  const save = () => {
    localStorage.setItem(key, JSON.stringify(n));
    toast.success('Notification settings saved');
  };

  const testLine = () => {
    if (!n.lineToken.trim()) return setLineMsg({ ok: false, text: 'Enter a channel access token first.' });
    if (!/^[UCR]/.test(n.lineTarget.trim())) return setLineMsg({ ok: false, text: 'Recipient ID should start with U, C or R.' });
    setLineMsg({ ok: true, text: '✓ Test message sent to LINE (simulated)' });
  };
  const testDiscord = () => {
    if (!/^https:\/\/discord(app)?\.com\/api\/webhooks\//.test(n.discordUrl.trim()))
      return setDiscordMsg({ ok: false, text: 'That does not look like a Discord webhook URL.' });
    setDiscordMsg({ ok: true, text: '✓ Test alert posted to Discord (simulated)' });
  };

  return (
    <div className={card}>
      <div className="text-[14.5px] font-bold">Notifications</div>
      <div className="mt-[3px] text-[12px] text-ink3">
        Get alerts about your properties' devices on LINE or Discord.
      </div>

      <Channel
        badge={<span className="text-[10px] font-extrabold text-white">LINE</span>}
        badgeBg="#06C755"
        title="LINE Messaging API"
        sub="Push alerts to a LINE chat via your channel token"
        enabled={n.lineEnabled}
        trackOn="#06C755"
        onToggle={() => patch({ lineEnabled: !n.lineEnabled })}
      >
        <Field label="Channel access token">
          <input value={n.lineToken} onChange={(e) => patch({ lineToken: e.target.value })} placeholder="eyJhbGciOi…" className={`${inputCls} font-mono`} />
        </Field>
        <Field label="Recipient (user / group ID)">
          <input value={n.lineTarget} onChange={(e) => patch({ lineTarget: e.target.value })} placeholder="Uxxxx or Cxxxx" className={`${inputCls} font-mono`} />
        </Field>
        <TestRow msg={lineMsg} label="Send test message" onTest={testLine} />
      </Channel>

      <Channel
        badge={<span className="text-[12px] font-extrabold text-white">D</span>}
        badgeBg="#5865F2"
        title="Discord webhook"
        sub="Post alerts into a Discord channel"
        enabled={n.discordEnabled}
        trackOn="#5865F2"
        onToggle={() => patch({ discordEnabled: !n.discordEnabled })}
      >
        <Field label="Webhook URL">
          <input value={n.discordUrl} onChange={(e) => patch({ discordUrl: e.target.value })} placeholder="https://discord.com/api/webhooks/…" className={`${inputCls} font-mono`} />
        </Field>
        <TestRow msg={discordMsg} label="Send test alert" onTest={testDiscord} />
      </Channel>

      <div className="mt-[14px] text-[11.5px] font-semibold text-ink2">Alert me when…</div>
      <div className="mt-2 grid grid-cols-1 gap-[7px] sm:grid-cols-2">
        {EVENTS.map((ev) => {
          const on = !!n.events[ev.key];
          return (
            <button
              key={ev.key}
              onClick={() => patch({ events: { ...n.events, [ev.key]: !on } })}
              className={cn(
                'flex items-center gap-[9px] rounded-[9px] border p-[9px_12px] text-left',
                on ? 'border-brand bg-brand-soft' : 'border-line bg-surface'
              )}
            >
              <span
                className="flex size-4 flex-none items-center justify-center rounded-[5px] border-[1.5px]"
                style={{
                  borderColor: on ? 'var(--brand)' : 'var(--ink3)',
                  background: on ? 'var(--brand)' : 'transparent',
                }}
              >
                {on && (
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8.5 L6.5 12 L13 4.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span className="text-[12.5px] font-medium text-ink">{ev.label}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-[14px] flex justify-end">
        <button onClick={save} className={darkBtn}>
          Save notifications
        </button>
      </div>
    </div>
  );
}

function Channel({
  badge,
  badgeBg,
  title,
  sub,
  enabled,
  trackOn,
  onToggle,
  children,
}: {
  badge: React.ReactNode;
  badgeBg: string;
  title: string;
  sub: string;
  enabled: boolean;
  trackOn: string;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-[12px] overflow-hidden rounded-[11px] border border-line">
      <div className="flex items-center gap-[11px] bg-surface2 p-[12px_14px]">
        <span className="flex size-8 flex-none items-center justify-center rounded-lg" style={{ background: badgeBg }}>
          {badge}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold">{title}</span>
          <span className="block text-[11px] text-ink3">{sub}</span>
        </span>
        <button
          onClick={onToggle}
          className="relative h-[22px] w-[38px] flex-none rounded-full transition-colors"
          style={{ background: enabled ? trackOn : 'var(--line)' }}
        >
          <span
            className="absolute top-[3px] size-4 rounded-full bg-white shadow transition-[left]"
            style={{ left: enabled ? 19 : 3 }}
          />
        </button>
      </div>
      {enabled && <div className="flex flex-col gap-[10px] p-[13px_14px]">{children}</div>}
    </div>
  );
}

function TestRow({ msg, label, onTest }: { msg: { ok: boolean; text: string } | null; label: string; onTest: () => void }) {
  return (
    <div className="flex items-center gap-[10px]">
      {msg && (
        <span className="text-[12px] font-semibold" style={{ color: msg.ok ? 'var(--ok)' : 'var(--bad)' }}>
          {msg.text}
        </span>
      )}
      <div className="flex-1" />
      <button onClick={onTest} className="h-[30px] rounded-lg border border-line bg-surface2 px-[13px] text-[12px] font-semibold text-ink">
        {label}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-[5px]">
      <span className="text-[11.5px] font-semibold text-ink2">{label}</span>
      {children}
    </label>
  );
}
