/**
 * Tailwind v4 pipeline for the marketing site.
 *
 * The site imports `@erp/ui/tokens.css`, whose primitive palette lives in an
 * `@theme` block. `@theme` is a Tailwind at-rule: without this config the file
 * is served as plain CSS, the browser drops the unknown at-rule, and every
 * `var(--color-*)` (and anything derived from it, e.g. the `--grad` gradient
 * used by buttons and the logo) resolves to the guaranteed-invalid value.
 * The result was white-on-white primary buttons and an invisible wordmark.
 * Staff, bakery and platform-admin already ship this config; marketing was the
 * only app without it.
 */
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
