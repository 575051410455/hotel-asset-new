import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { QRCodeSVG } from 'qrcode.react';
import { Search, Printer } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useDevices } from '@/lib/devices';
import type { Device } from '@/lib/types';
import { useSetPageHeader } from '@/components/app-shell/page-header';
import { BrandMark } from '@/components/app-shell/brand-mark';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_layout/stickers')({
  component: StickersPage,
});

const FLOOR_LABEL: Record<string, string> = { account: 'Account 3F', office: 'Office 2F', l4: 'Level 4' };
const QR_BASE = 'https://asset.example.com/device/';
const PAIR_BASE = 'https://asset.example.com/pair/';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars

type Kind = 'ws' | 'cam' | 'ap';
const kindOf = (d: Device): Kind => (d.type === 'IP Camera' ? 'cam' : d.type === 'Access Point' ? 'ap' : 'ws');

function nameOf(d: Device): string {
  const k = kindOf(d);
  if (k === 'cam') return d.model && d.model !== '—' ? d.model : 'IP Camera';
  if (k === 'ap') return `${d.model && d.model !== '—' ? d.model : 'Access Point'} · Wi-Fi AP`;
  return `${d.name || d.computerName} · ${d.type || 'Desktop'}`;
}
const locOf = (d: Device) => `${FLOOR_LABEL[d.floorId ?? ''] ?? d.floorId ?? ''} · ${d.department ?? ''}`;

// Deterministic human-readable confirm code, grouped 3-3-4 (e.g. OWY-SPK-HUJH).
function confirmCode(id: string): string {
  let h1 = 2166136261, h2 = 5381;
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = (Math.imul(h2, 33) + c) >>> 0;
  }
  const grab = (seed: number, len: number) => {
    let h = seed >>> 0;
    let out = '';
    for (let k = 0; k < len; k++) {
      out += CODE_ALPHABET[h % 32];
      h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    }
    return out;
  };
  return `${grab(h1, 3)}-${grab(h2, 3)}-${grab((h1 ^ h2) >>> 0, 4)}`;
}

const TYPE_TABS: { key: 'all' | Kind; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'ws', label: 'Computers' },
  { key: 'cam', label: 'CCTV' },
  { key: 'ap', label: 'Wi-Fi' },
];

function StickersPage() {
  const { activeHotelId } = useAuth();
  const { data: devices } = useDevices(activeHotelId);
  const all = useMemo(() => devices ?? [], [devices]);

  const [style, setStyle] = useState<'asset' | 'verify'>('asset');
  const [tab, setTab] = useState<'all' | Kind>('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Record<string, boolean> | null>(null);

  // Default: everything selected once devices load.
  const selected = sel ?? Object.fromEntries(all.map((d) => [d.computerName, true]));

  const query = q.trim().toLowerCase();
  const filtered = all.filter((d) => {
    if (tab !== 'all' && kindOf(d) !== tab) return false;
    if (!query) return true;
    return `${d.computerName} ${nameOf(d)} ${locOf(d)}`.toLowerCase().includes(query);
  });
  const selectedRows = all.filter((d) => selected[d.computerName]);
  const isVerify = style === 'verify';
  const unit = isVerify ? 'card' : 'sticker';

  useSetPageHeader(
    {
      title: 'Asset stickers',
      subtitle: isVerify ? '40 × 40 mm · pairing sticker' : '60 × 40 mm · thermal-transfer',
      actions: (
        <>
          <div className="hidden items-center gap-[3px] rounded-[9px] border border-line bg-bg p-[3px] sm:flex">
            {([['asset', 'Asset label'], ['verify', 'Verify card']] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setStyle(k)}
                className={cn(
                  'whitespace-nowrap rounded-md px-[12px] py-[5px] text-[12px] font-semibold',
                  style === k ? 'bg-surface text-ink shadow-[var(--shadow)]' : 'text-ink2 hover:text-ink'
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="hidden text-[12px] text-ink3 lg:inline">
            {selectedRows.length} {unit}
            {selectedRows.length === 1 ? '' : 's'} selected
          </span>
          <button
            onClick={() => window.print()}
            className="flex h-8 items-center gap-[7px] rounded-lg bg-ink px-3 text-[12.5px] font-semibold text-bg"
          >
            <Printer size={13} /> Print / PDF
          </button>
        </>
      ),
    },
    [isVerify, style, selectedRows.length]
  );

  const toggle = (id: string) => setSel({ ...selected, [id]: !selected[id] });
  const selectShown = () => {
    const next = { ...selected };
    filtered.forEach((d) => (next[d.computerName] = true));
    setSel(next);
  };

  return (
    <div className="flex h-full min-h-0">
      {/* Device picker */}
      <div className="no-print hidden w-[300px] flex-none flex-col border-r border-line bg-surface md:flex">
        <div className="flex flex-col gap-2 p-[12px_12px_8px]">
          <div className="flex gap-[5px]">
            {TYPE_TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    'flex-1 whitespace-nowrap rounded-[7px] border px-[2px] py-[5px] text-[11px] font-semibold',
                    active ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface text-ink2'
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-[10px] top-1/2 -translate-y-1/2 text-ink3" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search id, name, location…"
              className="h-[33px] w-full rounded-lg border border-line bg-bg pl-[30px] pr-[10px] text-[12.5px] outline-none focus:border-brand"
            />
          </div>
          <div className="flex gap-[6px]">
            <button onClick={selectShown} className="h-7 flex-1 rounded-[7px] border border-line bg-surface2 text-[11.5px] font-semibold text-ink2">
              Select shown
            </button>
            <button onClick={() => setSel({})} className="h-7 flex-1 rounded-[7px] border border-line bg-surface2 text-[11.5px] font-semibold text-ink2">
              Clear all
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-[2px_8px_12px]">
          {filtered.map((d) => {
            const on = !!selected[d.computerName];
            return (
              <button
                key={d.id}
                onClick={() => toggle(d.computerName)}
                className={cn(
                  'mb-[2px] flex w-full items-center gap-[9px] rounded-lg p-[7px_9px] text-left',
                  on ? 'bg-brand-soft' : 'bg-transparent hover:bg-surface2'
                )}
              >
                <span
                  className="flex size-4 flex-none items-center justify-center rounded-[5px] border-[1.5px]"
                  style={{ borderColor: on ? 'var(--brand)' : 'var(--ink3)', background: on ? 'var(--brand)' : 'transparent' }}
                >
                  {on && (
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                      <path d="M3 8.5 L6.5 12 L13 4.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-[12.5px] font-semibold text-ink">{d.computerName}</span>
                  <span className="block truncate text-[10.5px] text-ink3">{nameOf(d)} — {locOf(d)}</span>
                </span>
              </button>
            );
          })}
          {all.length > 0 && filtered.length === 0 && (
            <div className="p-[24px_12px] text-center text-[12px] text-ink3">No devices match.</div>
          )}
        </div>
        <div className="border-t border-line p-[10px_14px] text-[10.5px] leading-[1.5] text-ink3">
          Print at 100% scale (no fit-to-page). Scan-test one sticker before a large batch.
        </div>
      </div>

      {/* Sticker preview / print area */}
      <div className="sticker-scroll flex-1 overflow-y-auto p-[22px]">
        <div className="sticker-grid flex flex-wrap content-start gap-[18px]">
          {selectedRows.map((d) => {
            const id = d.computerName;
            const code = confirmCode(id);
            return isVerify ? (
              <div key={id} className="sticker-wrap is-verify flex-none">
                <VerifyCard id={id} code={code} />
              </div>
            ) : (
              <div key={id} className="sticker-wrap flex-none">
                <AssetLabel id={id} name={nameOf(d)} location={locOf(d)} />
              </div>
            );
          })}
        </div>
        {all.length > 0 && selectedRows.length === 0 && (
          <div className="no-print p-[40px_20px] text-center text-[13px] text-ink3">
            Select devices on the left to generate their stickers.
          </div>
        )}
        {all.length === 0 && (
          <div className="no-print p-[40px_20px] text-center text-[13px] text-ink3">
            No devices for this property.
          </div>
        )}
      </div>
    </div>
  );
}

function AssetLabel({ id, name, location }: { id: string; name: string; location: string }) {
  return (
    <div
      className="sticker sticker-asset box-border flex items-center gap-[1.8mm] overflow-hidden bg-white p-[2mm_2.5mm_2mm_2mm] text-black"
      style={{ width: '60mm', height: '40mm', fontFamily: "'IBM Plex Sans Thai', Arial, sans-serif" }}
    >
      <QRCodeSVG value={QR_BASE + id} level="M" size={160} style={{ width: '27mm', height: '27mm', flex: 'none' }} />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-[1.7mm]">
        <LabelField k="ASSET ID" v={id} mono big />
        <LabelField k="NAME" v={name} />
        <LabelField k="LOCATION" v={location} />
      </div>
    </div>
  );
}

function LabelField({ k, v, mono, big }: { k: string; v: string; mono?: boolean; big?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: '4.6pt', fontWeight: 700, letterSpacing: '0.1em', lineHeight: 1.2 }}>{k}</div>
      <div
        style={{
          fontSize: big ? '8.6pt' : '6.8pt',
          fontWeight: big ? 700 : 600,
          lineHeight: 1.18,
          maxHeight: big ? undefined : '2.4em',
          overflow: 'hidden',
          whiteSpace: big ? 'nowrap' : undefined,
          overflowWrap: 'anywhere',
          fontFamily: mono ? "'IBM Plex Mono', monospace" : undefined,
        }}
      >
        {v}
      </div>
    </div>
  );
}

function VerifyCard({ id, code }: { id: string; code: string }) {
  return (
    <div
      className="sticker sticker-verify box-border flex flex-col items-center justify-center gap-[1.4mm] overflow-hidden bg-white p-[2.6mm] text-black"
      style={{ width: '40mm', height: '40mm', borderRadius: '3mm', boxShadow: '0 0.8mm 4mm rgba(16,24,40,0.16)', fontFamily: "'IBM Plex Sans Thai', Arial, sans-serif" }}
    >
      <div style={{ position: 'relative', width: '22mm', height: '22mm' }}>
        <QRCodeSVG value={`${PAIR_BASE}${id}?c=${code}`} level="H" size={140} style={{ width: '22mm', height: '22mm', display: 'block' }} />
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '5.2mm',
            height: '5.2mm',
            borderRadius: '1.5mm',
            background: '#fff',
            boxShadow: '0 0 0 0.7mm #fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ width: '4mm', height: '4mm', borderRadius: '50%', background: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <BrandMark size={9} color="#fff" />
          </div>
        </div>
      </div>
      <div style={{ fontSize: '4.6pt', textAlign: 'center', lineHeight: 1.3, color: '#2A3744', maxWidth: '34mm' }}>
        Scan the QR code and confirm that the codes match to log in.
      </div>
      <div style={{ fontSize: '8.6pt', fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.03em', color: '#15222F', whiteSpace: 'nowrap' }}>
        {code}
      </div>
    </div>
  );
}
