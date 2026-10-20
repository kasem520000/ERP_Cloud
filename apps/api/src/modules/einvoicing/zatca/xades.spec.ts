import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey, createVerify } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { canonicalInvoiceForHash, canonicalizeXml, hashCanonicalInvoice } from './canonical.js';
import { decodeQrPayload, hashInvoiceXml } from './qr.js';
import { GENESIS_PIH, buildInvoiceXml, type ZatcaInvoiceInput } from './ubl.js';
import { certificateInfo, signInvoiceXml } from './xades.js';

/**
 * 🧾 التوقيع والتطبيع — يُقاس هنا ما يمكن قياسه بلا هيئة:
 *
 * 1. البصمة تُحسب على المستند **بعد** حذف `UBLExtensions` و`cac:Signature` ومرجع QR،
 *    وبعد التطبيع؛ فإدخال التوقيع وQR لا يغيّر بصمة الفاتورة.
 * 2. الختم الرقمي (ECDSA secp256k1) يتحقق منه المفتاح العام، ويُكتب في QR نصّاً base64.
 * 3. الوسمان ٨ و٩ يُستخرجان من الشهادة نفسها: المفتاح العام وتوقيع المُصدِر.
 * 4. الشهادة تُقرأ (المُصدِر، الرقم التسلسلي، البصمة)، ورمز المحاكاة الاصطناعي لا يُقرأ
 *    كشهادة — فلا تُدّعى كتلة توقيع عند غيابها.
 */
describe('zatca xades — التوقيع والتطبيع', () => {
  let directory = '';
  let certificate = '';
  let privateKey = '';
  let publicKeyPem = '';

  const input = (overrides: Partial<ZatcaInvoiceInput> = {}): ZatcaInvoiceInput => ({
    number: 'SI-1',
    uuid: '8d487816-70b8-4ade-a618-9d620b73814a',
    issuedAt: new Date('2026-10-20T09:15:00.000Z'),
    kind: 'sale',
    profile: 'standard',
    currency: 'SAR',
    seller: {
      nameAr: 'مؤسسة الأفق للتجارة',
      nameEn: 'Al Ofoq Trading',
      vatNo: '310000000000003',
      crNo: '1010000000',
      street: 'طريق الملك فهد',
      buildingNumber: '1234',
      district: 'العليا',
      city: 'الرياض',
      postalZone: '12345',
      countryCode: 'SA',
    },
    buyer: { nameAr: 'مؤسسة النخبة', vatNo: '311111111111113', city: 'جدة', street: 'TST', buildingNumber: '1234', district: 'TST', postalZone: '1224', countryCode: 'SA' },
    lines: [{ lineNo: 1, name: 'أرز بسمتي', unitCode: 'PCE', quantity: '2', unitPrice: '27.5', net: '55', discount: '0', tax: '8.25', taxRate: '15' }],
    invoiceDiscount: '0',
    subtotal: '55',
    taxTotal: '8.25',
    total: '63.25',
    paymentMeansCode: '10',
    counter: 7,
    previousHash: GENESIS_PIH,
    ...overrides,
  });

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'zatca-xades-'));
    try {
      execFileSync('openssl', ['ecparam', '-name', 'secp256k1', '-genkey', '-noout', '-out', join(directory, 'key.pem')], { stdio: 'ignore' });
      execFileSync(
        'openssl',
        ['req', '-new', '-x509', '-key', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'), '-days', '3650', '-subj', '/C=SA/O=ERP Cloud Test/CN=ZATCA Test CSID', '-sha256'],
        { stdio: 'ignore' },
      );
    } catch {
      throw new Error('openssl is required to build the test certificate for the XAdES suite');
    }
    privateKey = readFileSync(join(directory, 'key.pem'), 'utf8');
    publicKeyPem = execFileSync('openssl', ['ec', '-in', join(directory, 'key.pem'), '-pubout']).toString();
    certificate = readFileSync(join(directory, 'cert.pem'), 'utf8');
  });

  afterAll(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it('hashes the canonical document, ignoring the signature and QR nodes', () => {
    const compact = buildInvoiceXml(input());
    // التطبيع يُسقط إعلان XML ويُرتّب السمات؛ ولا يغيّر النصّ.
    const canonical = canonicalizeXml(compact);
    expect(canonical.startsWith('<Invoice ')).toBe(true);
    expect(canonicalizeXml(canonical)).toBe(canonical);

    const signed = buildInvoiceXml({
      ...input(),
      qrPayload: 'QRDATA',
      extensionBlock: '<ext:UBLExtensions><x>signature</x></ext:UBLExtensions>',
    });
    // إدخال التوقيع وQR لا يغيّر البصمة: كلاهما يُحذف قبل الحساب.
    expect(canonicalInvoiceForHash(signed)).toBe(canonicalInvoiceForHash(compact));
    expect(hashInvoiceXml(signed)).toBe(hashCanonicalInvoice(compact));
  });

  it('reads the certificate: issuer, serial, public key and the CA signature', () => {
    const info = certificateInfo(certificate);
    expect(info).not.toBeNull();
    expect(info!.issuer).toBe('CN=ZATCA Test CSID, O=ERP Cloud Test, C=SA');
    expect(info!.serialDecimal).toMatch(/^\d+$/);
    expect(info!.digestBase64).toBe(createHash('sha256').update(Buffer.from(info!.base64, 'base64')).digest('base64'));
    expect(info!.publicKeyRaw.length).toBeGreaterThan(30);
    expect(info!.issuerSignature.length).toBeGreaterThan(30);
    // المفتاح الخام هو ذيل SPKI بعد ترويسة الخوارزمية — أي أنه مفتاح الشهادة نفسه.
    const spki = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' }) as Buffer;
    expect(spki.includes(info!.publicKeyRaw)).toBe(true);
    expect(certificateInfo('WkFUQ0EtU0lNLUNPTlRPT0w=')).toBeNull();
  });

  it('signs the invoice hash, builds a 9-tag QR and a real UBLExtensions block', () => {
    const unsigned = buildInvoiceXml(input());
    const signed = signInvoiceXml({
      xml: unsigned,
      material: { privateKeyPem: privateKey, certificate },
      qr: { sellerName: 'مؤسسة الأفق للتجارة', vatNo: '310000000000003', timestamp: '2026-10-20T09:15:00Z', grandTotal: '63.25', vatTotal: '8.25' },
      signingTime: new Date('2026-10-20T09:15:00.000Z'),
    });
    expect(signed).not.toBeNull();
    expect(signed!.invoiceHash).toBe(hashCanonicalInvoice(unsigned));
    expect(signed!.extensionBlock).toContain('<ds:Signature');
    expect(signed!.extensionBlock).toContain('<xades:SignedProperties');
    expect(signed!.extensionBlock).toContain(signed!.invoiceHash); // DigestValue للمستند

    const tags = decodeQrPayload(signed!.qrPayload);
    expect(tags.map((tag) => tag.tag)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(tags[5]!.value.toString('utf8')).toBe(signed!.invoiceHash);
    expect(tags[6]!.value.toString('utf8')).toBe(signed!.stamp);

    // الختم يُتحقق منه بالمفتاح العام على بايتات البصمة المفكوكة (لا على نصّها).
    const verifier = createVerify('SHA256');
    verifier.update(Buffer.from(signed!.invoiceHash, 'base64'));
    expect(verifier.verify(publicKeyPem, Buffer.from(signed!.stamp, 'base64'))).toBe(true);

    const info = certificateInfo(certificate)!;
    expect(tags[7]!.value.equals(info.publicKeyRaw)).toBe(true);
    expect(tags[8]!.value.equals(info.issuerSignature)).toBe(true);
  });

  it('rebuilds the document with the QR inside it, and the hash stays the same', () => {
    const unsigned = buildInvoiceXml(input());
    const signed = signInvoiceXml({
      xml: unsigned,
      material: { privateKeyPem: privateKey, certificate },
      qr: { sellerName: 'مؤسسة الأفق للتجارة', vatNo: '310000000000003', timestamp: '2026-10-20T09:15:00Z', grandTotal: '63.25', vatTotal: '8.25' },
      signingTime: new Date('2026-10-20T09:15:00.000Z'),
    })!;
    const rebuilt = buildInvoiceXml({ ...input(), qrPayload: signed.qrPayload, extensionBlock: signed.extensionBlock! });
    expect(rebuilt).toContain('<cbc:ID>QR</cbc:ID>');
    expect(rebuilt).toContain(signed.qrPayload);
    expect(rebuilt.indexOf('<ext:UBLExtensions>')).toBeLessThan(rebuilt.indexOf('<cbc:ProfileID>'));
    expect(hashInvoiceXml(rebuilt)).toBe(signed.invoiceHash);
  });

  it('degrades honestly: a private key without a certificate stamps but claims no signature', () => {
    const unsigned = buildInvoiceXml(input());
    const signed = signInvoiceXml({
      xml: unsigned,
      material: { privateKeyPem: privateKey, certificate: '' },
      qr: { sellerName: 'مؤسسة الأفق للتجارة', vatNo: '310000000000003', timestamp: '2026-10-20T09:15:00Z', grandTotal: '63.25', vatTotal: '8.25' },
    });
    expect(signed).not.toBeNull();
    expect(signed!.extensionBlock).toBeNull();
    expect(signed!.certificate).toBeNull();
    const tags = decodeQrPayload(signed!.qrPayload);
    expect(tags.map((tag) => tag.tag)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
