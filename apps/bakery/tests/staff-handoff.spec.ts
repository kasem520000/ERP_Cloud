import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  HANDOFF_NOTES_AR,
  STAFF_DESTINATIONS,
  STAFF_URL_ENV,
  destinationsOf,
  handoffHref,
  handoffPlan,
  staffBaseUrl,
} from '../lib/staff-handoff';

/** شجرةُ لوحة staff نفسها — فالمسارُ «الحقيقيّ» يُقاس عليها لا على ما نذكره منها. */
const staffAppDir = fileURLToPath(new URL('../../staff/app', import.meta.url));

function pagesUnder(relative: string): string[] {
  return readdirSync(join(staffAppDir, relative), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `/${relative}/${entry.name}`)
    .filter((path) => existsSync(join(staffAppDir, relative, path.split('/').pop() ?? '', 'page.tsx')))
    .sort();
}

/**
 * ما في لوحة staff من خزينةٍ ولا يُعرض من واجهة المخابز — **مُعلنٌ ومثبَّت**: فإسقاطُ
 * شاشةٍ صمتًا هو الوجه الآخر للرابط الميت (يبحث المستخدمُ عن مطابقة البنك هنا ولا يجدها
 * ولا يُقال له أين هي). والسبب: تكاملُ البنوك ومطابقتُها مسارُ عملٍ مصرفيّ لا يلمس نقدَ
 * الخطّ، ووجهتُه قائمةُ اللوحة نفسها.
 */
const TREASURY_NOT_LISTED = ['bank-accounts', 'bank-reconciliation', 'bank-statements', 'banks'];

describe('تسليمُ الجلسة إلى لوحة staff — روابطُ حقيقيةٌ ولا رمزَ جلسةٍ في عنوان', () => {
  it('كلّ وجهةٍ مسارٌ موجودٌ فعلًا: ‏page.tsx تحت apps/staff/app', () => {
    expect(STAFF_DESTINATIONS.length).toBeGreaterThan(0);
    for (const destination of STAFF_DESTINATIONS) {
      const page = join(staffAppDir, `${destination.path.replace(/^\//, '')}/page.tsx`);
      expect(existsSync(page), `${destination.key}: ${destination.path} بلا page.tsx في اللوحة`).toBe(true);
    }
  });

  it('وجهاتُ المحاسبة تغطي **كلّ** صفحات /accounting — فلا صفحةٌ هناك بلا رابطٍ هنا', () => {
    const listed = destinationsOf('accounting')
      .map((destination) => destination.path)
      .sort();
    expect(listed).toEqual(pagesUnder('accounting'));
  });

  it('وما يُترك من /treasury مُعلن: الإسقاطُ الصامتُ ممنوع', () => {
    const listed = destinationsOf('treasury').map((destination) => destination.path.split('/').pop());
    const existing = pagesUnder('treasury').map((path) => path.split('/').pop());
    const omitted = existing.filter((name) => !listed.includes(name));
    expect(omitted.sort()).toEqual([...TREASURY_NOT_LISTED].sort());
  });

  it('الجماعةُ تطابق المسار، والمفاتيحُ فريدة', () => {
    const keys = STAFF_DESTINATIONS.map((destination) => destination.key);
    expect(new Set(keys).size, 'مفتاحٌ مكرّر يعني وجهتين تُفتحان بزرٍّ واحد').toBe(keys.length);
    for (const destination of STAFF_DESTINATIONS) {
      expect(destination.path.startsWith(`/${destination.group}/`), `${destination.key}: مساره ليس في ${destination.group}`).toBe(true);
      expect(destination.labelAr.trim().length).toBeGreaterThan(1);
      expect(destination.noteAr.trim().length, `${destination.key}: بلا سببٍ للوجهة`).toBeGreaterThan(20);
    }
  });

  it('‏`staffBaseUrl` يقبل http(s) مطلقًا ويرفض ما عداه — ولا شرطةَ أخيرة في الرابط', () => {
    expect(staffBaseUrl('http://localhost:3001')).toBe('http://localhost:3001');
    expect(staffBaseUrl('https://staff.example.com/')).toBe('https://staff.example.com');
    expect(staffBaseUrl('  https://staff.example.com  ')).toBe('https://staff.example.com');
    // نسبيٌّ أو فاسدٌ أو بلا متغيّر ⇒ `null`: فلا يُخترع `localhost` ولا يُفتح مسارٌ ميت.
    expect(staffBaseUrl('/staff')).toBeNull();
    expect(staffBaseUrl('staff.example.com')).toBeNull();
    expect(staffBaseUrl('ftp://staff.example.com')).toBeNull();
    expect(staffBaseUrl('')).toBeNull();
    expect(staffBaseUrl(undefined)).toBeNull();
  });

  it('الرابطُ يحمل رمزَ التسليم وحده: ‏?handoff=<code> — ولا token ولا refresh (‏AUD-08)', () => {
    const href = handoffHref('https://staff.example.com', '/accounting/ledger', 'code/with+special chars');
    expect(href).toBe('https://staff.example.com/accounting/ledger?handoff=code%2Fwith%2Bspecial%20chars');
    expect(href).not.toContain('token=');
    expect(href).not.toContain('refresh=');
    // مسارٌ فيه استعلامٌ أصلًا يأخذ الرمزَ بـ`&` لا بـ`?` ثانية.
    expect(handoffHref('https://staff.example.com', '/treasury/movements?all=1', 'abc')).toBe(
      'https://staff.example.com/treasury/movements?all=1&handoff=abc',
    );
    // وشرطةٌ أخيرة في العنوان لا تُنتج `//`.
    expect(handoffHref('https://staff.example.com/', '/accounting/ledger', 'abc')).toBe(
      'https://staff.example.com/accounting/ledger?handoff=abc',
    );
  });

  it('‏`handoffPlan`: بلا عنوانٍ مُهيَّأ لا يُصنع رمز، وبلا رمزٍ لا رابط', () => {
    const destination = STAFF_DESTINATIONS[0];
    expect(destination).toBeDefined();

    const noBase = handoffPlan(null, destination!, 'abc');
    expect('problemAr' in noBase).toBe(true);
    expect('problemAr' in noBase ? noBase.problemAr : '').toContain(STAFF_URL_ENV);

    const noCode = handoffPlan('https://staff.example.com', destination!, '   ');
    expect('problemAr' in noCode).toBe(true);

    const ready = handoffPlan('https://staff.example.com', destination!, 'abc');
    expect('href' in ready ? ready.href : '').toBe(`https://staff.example.com${destination?.path}?handoff=abc`);
  });

  it('اسمُ المتغيّر المُعلن هو نفسه ما تقرأه الدالّة — فلا رسالةُ خطأٍ تدلّ على غير الناقص', () => {
    expect(STAFF_URL_ENV).toBe('NEXT_PUBLIC_STAFF_URL');
    expect(handoffPlan(null, STAFF_DESTINATIONS[0]!, 'x')).toMatchObject({
      problemAr: expect.stringContaining('NEXT_PUBLIC_STAFF_URL'),
    });
  });

  it('ملاحظاتُ الآلية تقول ما في `token-bridge` — مرةٌ واحدة، ~٦٠ ثانية، وبلا رمزِ جلسة', () => {
    const notes = HANDOFF_NOTES_AR.join(' ');
    expect(notes).toContain('لمرةٍ واحدة');
    expect(notes).toContain('٦٠ ثانية');
    expect(notes).toContain('/auth/handoff');
    expect(notes).toContain('handoff=failed');
    // والجسرُ المشترك يذكر القاعدة نفسها — فلو تغيّرت الآليّةُ هناك سقط هذا الحكم.
    const bridge = readFileSync(fileURLToPath(new URL('../../../packages/web-core/src/token-bridge.tsx', import.meta.url)), 'utf8');
    expect(bridge).toContain('handoff');
    expect(bridge).toContain('/auth/handoff/redeem');
  });
});
