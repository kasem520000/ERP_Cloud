import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '../src/theme/theme-provider';
import { ThemeToggle } from '../src/theme/theme-toggle';

describe('theme hydration baseline', () => {
  it('renders the same icon choice even if the browser has a stored dark preference', () => {
    const render = () => renderToStaticMarkup(
      <ThemeProvider defaultChoice="system"><ThemeToggle variant="icon" /></ThemeProvider>,
    );
    const initial = render();
    try {
      vi.stubGlobal('window', {
        localStorage: { getItem: () => 'dark' },
        matchMedia: () => ({ matches: true }),
      });
      expect(render()).toBe(initial);
      expect(initial).toContain('data-theme-choice="system"');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
