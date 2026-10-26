export type SettingsPayload = {
  settings?: Record<string, unknown>;
  registry?: Array<{
    key: string;
    module: string;
    description: string;
    defaultValue: unknown;
  }>;
} & Record<string, unknown>;

/** استخراج قاموس الإعدادات الفعلي سواء أرجع الخادم `{ settings, registry }` أو خريطة مسطّحة. */
export function extractEffectiveSettings(payload: SettingsPayload | null | undefined): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {};
  const otherKeys = Object.keys(payload).filter((key) => key !== 'settings' && key !== 'registry');
  if (
    otherKeys.length === 0 &&
    'settings' in payload &&
    payload.settings !== null &&
    typeof payload.settings === 'object' &&
    !Array.isArray(payload.settings)
  ) {
    return Object.fromEntries(
      Object.entries(payload.settings).filter(([key]) => key !== 'settings' && key !== 'registry'),
    );
  }
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => key !== 'settings' && key !== 'registry'),
  );
}
