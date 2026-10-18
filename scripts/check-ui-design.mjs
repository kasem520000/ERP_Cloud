#!/usr/bin/env node
/** Incremental drift gate for the shared CSS contract. Existing app-local exceptions
 * remain in the migration backlog; this gate protects the migrated portal layer. */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

let errors = 0;
function check(ok, message) {
  if (!ok) { console.error(`FAIL: ${message}`); errors++; }
}
for (const app of ['staff', 'bakery', 'platform-admin', 'marketing', 'customer-portal']) {
  const css = readFileSync(`apps/${app}/app/globals.css`, 'utf8');
  check(css.includes("@import '@erp/ui/tokens.css';"), `${app} does not import shared tokens`);
  check(!/:root\s*\{[^}]*--bg\s*:/.test(css), `${app} overrides the central page background in :root`);
}
const portal = readFileSync('apps/customer-portal/app/globals.css', 'utf8');
check(!/(?:#[\da-f]{3,8}|rgba?\s*\()/i.test(portal), 'portal CSS still contains a literal color');
check(portal.includes('var(--surface)') && portal.includes('var(--ui-type-body)'), 'portal surfaces/type bypass tokens');
check(/aria-current=['"]page['"]/.test(portal), 'portal active navigation state has no semantic selector');
for (const app of ['staff', 'platform-admin']) {
  const screen = readFileSync(`apps/${app}/components/screen.tsx`, 'utf8');
  check(screen.includes('PageFrame') && screen.includes('PageHeader'), `${app} page chrome bypasses shared anatomy`);
}
const marketingPostcss = readFileSync('apps/marketing/postcss.config.mjs', 'utf8');
check(marketingPostcss.includes('@tailwindcss/postcss'), 'marketing does not compile shared utilities');
const layout = readFileSync('apps/customer-portal/app/layout.tsx', 'utf8');
check(layout.includes('<ThemeScript') && layout.includes('<ThemeProvider'), 'portal missing shared light/dark mechanism');
try { execFileSync('node', ['scripts/ui-screen-registry.mjs', '--check'], { stdio: 'inherit' }); }
catch { errors++; }
if (errors) process.exit(1);
console.log('Design contract gate passed (5 token imports; portal semantic layer; registry freshness).');
