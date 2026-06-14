import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type PageHeaderState = {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  actions?: ReactNode;
};

type Ctx = {
  header: PageHeaderState;
  setHeader: (h: PageHeaderState) => void;
};

const PageHeaderContext = createContext<Ctx | null>(null);

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [header, setHeader] = useState<PageHeaderState>({ title: '' });
  return (
    <PageHeaderContext.Provider value={{ header, setHeader }}>{children}</PageHeaderContext.Provider>
  );
}

export function usePageHeaderState(): PageHeaderState {
  const ctx = useContext(PageHeaderContext);
  return ctx?.header ?? { title: '' };
}

// Pages call this to publish their title/subtitle/actions into the top bar.
export function useSetPageHeader(header: PageHeaderState, deps: unknown[] = []) {
  const ctx = useContext(PageHeaderContext);
  useEffect(() => {
    ctx?.setHeader(header);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
