'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  applyTheme,
  readThemeChoice,
  resolveTheme,
  THEME_EVENT,
  THEME_STORAGE_KEY,
  themeInitScript,
  writeThemeChoice,
  type ResolvedTheme,
  type ThemeChoice,
} from './theme';

type ThemeContextValue = {
  /** What the visitor asked for — always exactly what is painted. */
  choice: ThemeChoice;
  /** What is painted right now. */
  resolved: ResolvedTheme;
  setChoice: (choice: ThemeChoice) => void;
  /** Convenience for a two-state switch. */
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** `useLayoutEffect` on the client, `useEffect` on the server (where layout does not exist). */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export type ThemeProviderProps = {
  children: ReactNode;
  /**
   * The choice used when nothing is stored yet. `light` for staff and
   * marketing, `dark` for the platform console (Design v3 §2.1).
   */
  defaultChoice?: ThemeChoice;
};

/**
 * Owns the single `erp.theme` value for a whole surface.
 *
 * It listens to two things so the answer can never drift between tabs or
 * between the pre-hydration script and React: the `erp:theme-change` event
 * and the `storage` event (another tab). The OS preference is consulted once,
 * only to migrate a legacy `system` value.
 */
export function ThemeProvider({ children, defaultChoice = 'light' }: ThemeProviderProps) {
  // First render must be identical on the server and in the browser. Reading
  // `localStorage`/`matchMedia` in the initialiser does the opposite: the server
  // has neither, so a returning visitor with a stored theme hydrated a different
  // tree than the one that was painted (React 418) on every page. The stored
  // answer is applied in a layout effect — before paint, after hydration.
  const [choice, setChoiceState] = useState<ThemeChoice>(defaultChoice);

  useIsomorphicLayoutEffect(() => {
    setChoiceState(readThemeChoice(defaultChoice));
  }, [defaultChoice]);

  const resolved = resolveTheme(choice);

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  // A second tab (or the pre-hydration script) may have changed the answer.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onThemeEvent = (event: Event) => {
      const detail = (event as CustomEvent<ThemeChoice>).detail;
      if (detail === 'light' || detail === 'dark') setChoiceState(detail);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
      setChoiceState(readThemeChoice(defaultChoice));
    };
    window.addEventListener(THEME_EVENT, onThemeEvent);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(THEME_EVENT, onThemeEvent);
      window.removeEventListener('storage', onStorage);
    };
  }, [defaultChoice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    writeThemeChoice(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      choice,
      resolved,
      setChoice,
      toggle: () => setChoice(resolved === 'dark' ? 'light' : 'dark'),
    }),
    [choice, resolved, setChoice],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Read the theme. Throws outside a provider on purpose: a silent default
 * here is how two mechanisms end up in one app (§2.2.1).
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>');
  return context;
}

/**
 * The blocking `<head>` script. Rendered once per surface, before hydration.
 */
export function ThemeScript({ defaultChoice = 'light' }: { defaultChoice?: ThemeChoice }) {
  return (
    // A static, build-time string with no user input in it — the whole point of
    // the pre-hydration script is that it is a fixed few hundred bytes.
    <script dangerouslySetInnerHTML={{ __html: themeInitScript(defaultChoice) }} data-theme-init="" />
  );
}
