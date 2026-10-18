type BrowserLocation = { protocol: string; hostname: string };

/** Browser-facing support handoff: previews expose each app on its own HTTPS host. */
export function supportHandoffBase(location: BrowserLocation, configured = ''): string {
  const explicit = configured.trim().replace(/\/+$/, '');
  if (explicit) return explicit;
  const { protocol, hostname } = location;
  if (/^3003-.+\.e2b\.(app|dev)$/.test(hostname)) {
    return `${protocol}//${hostname.replace(/^3003-/, '3001-')}`;
  }
  return `${protocol}//${hostname}:3001`;
}
