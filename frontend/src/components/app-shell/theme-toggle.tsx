import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === 'dark';
  return (
    <button
      type="button"
      title="Toggle dark mode"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="flex size-8 flex-none items-center justify-center rounded-lg border border-line bg-surface text-ink2 transition-colors hover:bg-surface2 hover:text-ink"
    >
      {isDark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}
