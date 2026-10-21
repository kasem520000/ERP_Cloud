/**
 * Theme resolution — the one mechanism shared by staff, platform-admin and
 * marketing (Design v3 §2.2.1).
 *
 * Storage: a single `localStorage` key, `erp.theme`, holding `light | dark`.
 * «تتبّع النظام» was removed by product decision (2026-10): the visitor picks an
 * appearance and gets exactly that. A legacy stored `system` value is resolved
 * once, at boot, and rewritten as `light` or `dark`. There are deliberately **no** per-app or
 * per-context sub-keys (§8.11) — switching the theme on one surface and
 * opening another must not produce two answers.
 */

/** The one storage key. Never fork it. */
export const THEME_STORAGE_KEY = 'erp.theme';

/** What the visitor asked for. */
export type ThemeChoice = 'light' | 'dark';

/** The retired third option. Only ever read, never offered. */
const LEGACY_SYSTEM = 'system';

/** What the page is actually painted with. */
export type ResolvedTheme = 'light' | 'dark';

/** Event dispatched on `window` whenever the stored choice changes. */
export const THEME_EVENT = 'erp:theme-change';

const CHOICES: readonly ThemeChoice[] = ['light', 'dark'];

/** `localStorage` is absent in SSR, in private modes that block it, and in
 *  some embedded webviews — every read below is therefore defensive. */
function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === 'string' && (CHOICES as readonly string[]).includes(value);
}

export function readThemeChoice(fallback: ThemeChoice = 'light'): ThemeChoice {
  const storage = safeStorage();
  if (!storage) return fallback;
  const stored = storage.getItem(THEME_STORAGE_KEY);
  if (isThemeChoice(stored)) return stored;
  // A visitor who chose «تتبّع النظام» before it was retired keeps the appearance
  // they were already seeing: resolve it once against the OS and store the answer.
  if (stored === LEGACY_SYSTEM) {
    const resolved: ThemeChoice = systemPrefersDark() ? 'dark' : 'light';
    try {
      storage.setItem(THEME_STORAGE_KEY, resolved);
    } catch {
      /* a full or blocked storage must not break the boot */
    }
    return resolved;
  }
  return fallback;
}

export function writeThemeChoice(choice: ThemeChoice): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    /* a full or blocked storage must not break the toggle */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<ThemeChoice>(THEME_EVENT, { detail: choice }));
  }
}

/** The stored choice *is* the painted theme; nothing is resolved behind it. */
export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  return choice;
}

export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Paint the document. The class goes on `<html>` so a portal, a dialog or a
 * toast rendered at the body root still inherits the flip.
 */
export function applyTheme(resolved: ResolvedTheme, root?: HTMLElement): void {
  const element = root ?? (typeof document === 'undefined' ? null : document.documentElement);
  if (!element) return;
  element.classList.toggle('dark', resolved === 'dark');
  element.style.colorScheme = resolved;
  element.dataset.theme = resolved;
}

/** Cycle light → dark → light, for the compact icon toggle. */
export function nextThemeChoice(choice: ThemeChoice): ThemeChoice {
  return choice === 'dark' ? 'light' : 'dark';
}

/**
 * The blocking micro-script that runs in `<head>` before React hydrates
 * (§2.2.3). It is a few hundred bytes, has no dependency on the bundle, and
 * exists for exactly one reason: a visitor in dark mode must never see a
 * white flash. It also removes a `dark` class left over by a previous paint
 * when the stored choice is light.
 */
export function themeInitScript(fallback: ThemeChoice = 'light'): string {
  return (
    `(function(){try{` +
    `var k=${JSON.stringify(THEME_STORAGE_KEY)};` +
    `var v=null;try{v=window.localStorage.getItem(k)}catch(e){}` +
    `if(v==='system'){v=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';try{window.localStorage.setItem(k,v)}catch(e){}}` +
    `if(v!=='light'&&v!=='dark'){v=${JSON.stringify(fallback)}}` +
    `var d=v==='dark';` +
    `var r=document.documentElement;` +
    `r.classList.toggle('dark',d);` +
    `r.style.colorScheme=d?'dark':'light';` +
    `r.dataset.theme=d?'dark':'light';` +
    `}catch(e){}})();`
  );
}
