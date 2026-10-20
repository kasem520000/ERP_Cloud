/**
 * 🧾 توقيع المستند — XAdES-B-B enveloped داخل `ext:UBLExtensions`.
 *
 * هذا هو البند الذي كان يمنع الإنتاج: كل ما بنيناه قبل اليوم (UBL، البصمة، السلسلة، QR)
 * كان صحيحاً لكن المستند نفسه **غير موقَّع**، والهيئة ترفض في الإنتاج مستنداً بلا توقيع.
 *
 * الشكل يتبع مواصفة ZATCA للأمن (Security Features Implementation Standards) وبنية
 * `UBLExtensions` التي تنتجها مراجعها:
 *
 * ```
 * ext:UBLExtensions
 *   ext:UBLExtension
 *     ext:ExtensionURI  urn:oasis:names:specification:ubl:dsig:enveloped:xades
 *     ext:ExtensionContent
 *       sig:UBLDocumentSignatures
 *         sac:SignatureInformation
 *           cbc:ID  urn:oasis:names:specification:ubl:signature:1
 *           sbc:ReferencedSignatureID  urn:oasis:names:specification:ubl:signature:Invoice
 *           ds:Signature Id="signature"
 *             ds:SignedInfo           (مرجعان: المستند · الخصائص الموقَّعة)
 *             ds:SignatureValue       (الختم الرقمي: ECDSA على بصمة الفاتورة)
 *             ds:KeyInfo/X509Data/X509Certificate
 *             ds:Object/xades:QualifyingProperties/xades:SignedProperties
 * ```
 *
 * ثلاث حقائق تحكم هذا الملف:
 *
 * 1. **البصمة تُحسب قبل إدخال التوقيع وQR** — الفاتورة المُوقَّعة تُطبَّع بعد حذف
 *    `ext:UBLExtensions` و`cac:Signature` ومرجع `QR`، ثم تُجزَّأ بـSHA-256. ولذلك
 *    تُحسب أولاً، ثم يُبنى `ds:Signature` وQR، ثم يُعاد بناء المستند بهما.
 * 2. **الختم (`SignatureValue`) هو ECDSA على بايتات البصمة** لا على نصّها، والختم نفسه هو
 *    الوسم ٧ في QR — الهيئة تقارن الاثنين.
 * 3. **الوسم ٩** هو توقيع الجهة المُصدِرة على الشهادة (CA signature)، والوسم ٨ مفتاح
 *    المنشأة العام — كلاهما يُستخرج من شهادة CSID نفسها لا من ملفٍّ خارجي.
 *
 * ما لا يفعله هذا الملف ولا ينبغي أن يفعله: لا يتصل بالهيئة، ولا يخمّن شهادةً غير موجودة.
 * غياب الشهادة يعني مستنداً غير موقَّع وحالةً `prepared` صريحة — لا توقيعاً وهمياً.
 */
import { X509Certificate, createHash, createPrivateKey, createPublicKey, createSign, type KeyObject } from 'node:crypto';

import { hashCanonicalInvoice } from './canonical.js';
import { buildQrPayload } from './qr.js';

/** شهادة الجهاز كما تُقرأ من `einvoice_credentials`: DER مُرمَّز base64 بلا أسطر PEM. */
export type CertificateInfo = {
  /** الشهادة نفسها بلا أسطر PEM — ما يُكتب في `ds:X509Certificate`. */
  base64: string;
  /** SHA-256 على DER الشهادة — يُقارَن في `xades:CertDigest`. */
  digestBase64: string;
  /** اسم المُصدِر بصيغة RFC 2253 كما يُكتب في `ds:X509IssuerName`. */
  issuer: string;
  /** الرقم التسلسلي بالنظام العشري — `ds:X509SerialNumber`. */
  serialDecimal: string;
  /** المفتاح العام الخام (نقطة المنحنى) — الوسم ٨ في QR. */
  publicKeyRaw: Buffer;
  /** توقيع المُصدِر على الشهادة — الوسم ٩ في QR. */
  issuerSignature: Buffer;
};

export type SignatureMaterial = {
  privateKeyPem: string;
  /** شهادة CSID base64 — إمّا `binarySecurityToken` كما جاءت أو PEM كامل. */
  certificate: string;
};

export type SignedDocument = {
  /** البصمة التي تسير في السلسلة وتُقارَن بالوسم ٦. */
  invoiceHash: string;
  /** حمولة QR — وسوم ١–٩ مع شهادة، و١–٨ بلا شهادة. */
  qrPayload: string;
  /** الختم الرقمي base64 — هو نفسه `ds:SignatureValue` والوسم ٧. */
  stamp: string;
  /**
   * كتلة `ext:UBLExtensions` جاهزة للإدراج قبل `cbc:ProfileID`، أو `null` حين لا شهادة
   * حقيقية (بوابة المحاكاة تُصدر رمزاً اصطناعياً لا شهادة X.509). المستند حينها **غير
   * موقَّع** ويُقال ذلك صراحةً في حالة الإرسال.
   */
  extensionBlock: string | null;
  /** معلومات شهادة الجهاز متى قُرئت. */
  certificate: CertificateInfo | null;
  /** منحنى المفتاح — `secp256k1` لما تُصدره ZATCA. */
  curve: string;
};

// ── قراءة DER ────────────────────────────────────────────────────────────────────────────

type DerNode = { tag: number; start: number; contentStart: number; contentEnd: number; next: number };

/** Reads one DER TLV. Lengths are definite (BER indefinite is not used by X.509). */
function readDer(buffer: Buffer, offset: number): DerNode | null {
  if (offset + 2 > buffer.length) return null;
  const tag = buffer[offset]!;
  let cursor = offset + 1;
  let length = buffer[cursor]!;
  if (length & 0x80) {
    const bytes = length & 0x7f;
    if (bytes === 0 || bytes > 4 || cursor + 1 + bytes > buffer.length) return null;
    length = 0;
    for (let index = 0; index < bytes; index += 1) length = (length << 8) | buffer[cursor + 1 + index]!;
    cursor += 1 + bytes;
  } else {
    cursor += 1;
  }
  if (cursor + length > buffer.length) return null;
  return { tag, start: offset, contentStart: cursor, contentEnd: cursor + length, next: cursor + length };
}

function derChildren(buffer: Buffer, node: DerNode): DerNode[] {
  const children: DerNode[] = [];
  let cursor = node.contentStart;
  while (cursor < node.contentEnd) {
    const child = readDer(buffer, cursor);
    if (!child || child.next <= cursor) break;
    children.push(child);
    cursor = child.next;
  }
  return children;
}

/** Strips the unused-bits count from a BIT STRING's contents. */
function bitStringBytes(buffer: Buffer, node: DerNode): Buffer {
  const unusedBits = buffer[node.contentStart] ?? 0;
  return unusedBits === 0 ? buffer.subarray(node.contentStart + 1, node.contentEnd) : buffer.subarray(node.contentStart + 1, node.contentEnd);
}

/**
 * Extracts the two buffers ZATCA wants in QR tags 8 and 9 from the certificate itself:
 * the subject's public key (the `subjectPublicKey` BIT STRING inside `SubjectPublicKeyInfo`)
 * and the CA's signature over the certificate (the outer `signatureValue` BIT STRING).
 */
function derExtras(der: Buffer): { publicKeyRaw: Buffer; issuerSignature: Buffer } | null {
  const certificate = readDer(der, 0);
  if (!certificate || certificate.tag !== 0x30) return null;
  const parts = derChildren(der, certificate);
  if (parts.length < 3) return null;
  const tbs = parts[0]!;
  const signature = parts[2]!;
  if (signature.tag !== 0x03 || tbs.tag !== 0x30) return null;

  const tbsChildren = derChildren(der, tbs);
  const spki = tbsChildren.find((child) => {
    if (child.tag !== 0x30) return false;
    const inner = derChildren(der, child);
    return inner.length === 2 && inner[0]!.tag === 0x30 && inner[1]!.tag === 0x03;
  });
  if (!spki) return null;
  const spkiChildren = derChildren(der, spki);
  const publicKeyBitString = spkiChildren[1]!;

  return {
    publicKeyRaw: bitStringBytes(der, publicKeyBitString),
    issuerSignature: bitStringBytes(der, signature),
  };
}

/** `-----BEGIN CERTIFICATE-----` wrappers are tolerated; only the body matters. */
export function cleanCertificateBase64(token: string): string {
  return token
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * Reads everything the signature and the QR need from a CSID token.
 *
 * Returns `null` when the token is not a certificate (the 🧪 simulation gateway answers with
 * a synthetic token, not an X.509 certificate). A caller that gets `null` must fall back to
 * an unsigned document rather than invent a certificate.
 */
export function certificateInfo(token: string): CertificateInfo | null {
  const base64 = cleanCertificateBase64(token);
  if (!base64) return null;
  let der: Buffer;
  try {
    der = Buffer.from(base64, 'base64');
  } catch {
    return null;
  }
  if (der.length < 64) return null;
  let x509: X509Certificate;
  try {
    x509 = new X509Certificate(der);
  } catch {
    return null;
  }
  const extras = derExtras(der);
  if (!extras) return null;
  const issuer = x509.issuer
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse()
    .join(', ');
  return {
    base64,
    digestBase64: createHash('sha256').update(der).digest('base64'),
    issuer,
    serialDecimal: x509.serialNumber ? BigInt(`0x${x509.serialNumber}`).toString(10) : '0',
    publicKeyRaw: extras.publicKeyRaw,
    issuerSignature: extras.issuerSignature,
  };
}

// ── البصمة والتوقيع ──────────────────────────────────────────────────────────────────────

function signBytes(privateKey: KeyObject, bytes: Buffer): Buffer {
  const signer = createSign('SHA256');
  signer.update(bytes);
  signer.end();
  return signer.sign(privateKey);
}

function stampOf(privateKeyPem: string, invoiceHash: string): Buffer | null {
  let key: KeyObject;
  try {
    key = createPrivateKey(privateKeyPem);
  } catch {
    return null;
  }
  if (key.asymmetricKeyType !== 'ec') return null;
  try {
    // The stamp signs the **decoded** hash bytes — that is what the authority verifies.
    return signBytes(key, Buffer.from(invoiceHash, 'base64'));
  } catch {
    return null;
  }
}

function signingTimeOf(instant: Date): string {
  return `${instant.toISOString().slice(0, 19)}Z`;
}

/** `xades:SignedProperties` — exact characters hashed and then embedded, so they must match. */
function signedPropertiesXml(info: CertificateInfo, signingTime: string): string {
  return (
    `<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="xadesSignedProperties">` +
    `<xades:SignedSignatureProperties>` +
    `<xades:SigningTime>${signingTime}</xades:SigningTime>` +
    `<xades:SigningCertificate><xades:Cert>` +
    `<xades:CertDigest><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>` +
    `<ds:DigestValue>${info.digestBase64}</ds:DigestValue></xades:CertDigest>` +
    `<xades:IssuerSerial><ds:X509IssuerName>${escapeXml(info.issuer)}</ds:X509IssuerName>` +
    `<ds:X509SerialNumber>${info.serialDecimal}</ds:X509SerialNumber></xades:IssuerSerial>` +
    `</xades:Cert></xades:SigningCertificate>` +
    `</xades:SignedSignatureProperties></xades:SignedProperties>`
  );
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function extensionBlock(input: {
  invoiceHash: string;
  signedPropertiesHash: string;
  stamp: string;
  certificate: string;
  signedProperties: string;
}): string {
  return (
    `<ext:UBLExtensions><ext:UBLExtension>` +
    `<ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>` +
    `<ext:ExtensionContent>` +
    `<sig:UBLDocumentSignatures xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2" xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2">` +
    `<sac:SignatureInformation>` +
    `<cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID>` +
    `<sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID>` +
    `<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="signature">` +
    `<ds:SignedInfo>` +
    `<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"></ds:CanonicalizationMethod>` +
    `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"></ds:SignatureMethod>` +
    `<ds:Reference Id="invoiceSignedData" URI="">` +
    `<ds:Transforms>` +
    `<ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::ext:UBLExtensions)</ds:XPath></ds:Transform>` +
    `<ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::cac:Signature)</ds:XPath></ds:Transform>` +
    `<ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])</ds:XPath></ds:Transform>` +
    `<ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"></ds:Transform>` +
    `</ds:Transforms>` +
    `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>` +
    `<ds:DigestValue>${input.invoiceHash}</ds:DigestValue>` +
    `</ds:Reference>` +
    `<ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties">` +
    `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>` +
    `<ds:DigestValue>${input.signedPropertiesHash}</ds:DigestValue>` +
    `</ds:Reference>` +
    `</ds:SignedInfo>` +
    `<ds:SignatureValue>${input.stamp}</ds:SignatureValue>` +
    `<ds:KeyInfo><ds:X509Data><ds:X509Certificate>${input.certificate}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>` +
    `<ds:Object>` +
    `<xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Target="signature">` +
    input.signedProperties +
    `</xades:QualifyingProperties>` +
    `</ds:Object>` +
    `</ds:Signature>` +
    `</sac:SignatureInformation>` +
    `</sig:UBLDocumentSignatures>` +
    `</ext:ExtensionContent>` +
    `</ext:UBLExtension></ext:UBLExtensions>`
  );
}

/**
 * Signs the whole document: hash → stamp → QR (tags 1–9) → `ext:UBLExtensions`.
 *
 * `xml` is the **unsigned** document (no `UBLExtensions`, no QR reference). The caller
 * rebuilds the document with `qrPayload` and `extensionBlock`; the rebuild must not change
 * anything else, because the hash was taken over that exact structure.
 */
export function signInvoiceXml(input: {
  xml: string;
  material: SignatureMaterial;
  /** البيانات التي لا تأتي من الشهادة: اسم البائع ورقمه ومسامير الفاتورة. */
  qr: { sellerName: string; vatNo: string; timestamp: string; grandTotal: string; vatTotal: string };
  signingTime?: Date;
}): SignedDocument | null {
  const info = certificateInfo(input.material.certificate);
  let key: KeyObject;
  try {
    key = createPrivateKey(input.material.privateKeyPem);
  } catch {
    return null;
  }
  if (key.asymmetricKeyType !== 'ec') return null;
  const curve = String(key.asymmetricKeyDetails?.namedCurve ?? 'unknown');

  const invoiceHash = hashCanonicalInvoice(input.xml);
  const stamp = stampOf(input.material.privateKeyPem, invoiceHash);
  if (!stamp) return null;
  const stampBase64 = stamp.toString('base64');

  // بلا شهادةٍ يبقى الوسم ٨ مفتاح المنشأة نفسه (من المفتاح الخاص) — وهو ما تطلبه المرحلة
  // الثانية من فاتورةٍ مُصدَرة لم تُبلَّغ بعد. والوسم ٩ لا يُخترع: بلا شهادةٍ لا وجود له.
  let publicKeyDer = info?.publicKeyRaw;
  if (!publicKeyDer) {
    try {
      publicKeyDer = createPublicKey(key).export({ type: 'spki', format: 'der' }) as Buffer;
    } catch {
      return null;
    }
  }

  const qrPayload = buildQrPayload({
    sellerName: input.qr.sellerName,
    vatNo: input.qr.vatNo,
    timestamp: input.qr.timestamp,
    grandTotal: input.qr.grandTotal,
    vatTotal: input.qr.vatTotal,
    invoiceHash,
    signature: Buffer.from(stampBase64, 'utf8'),
    publicKeyDer,
    certificateSignature: info?.issuerSignature,
  });

  if (!info) return { invoiceHash, qrPayload, stamp: stampBase64, extensionBlock: null, certificate: null, curve };

  const signedProperties = signedPropertiesXml(info, signingTimeOf(input.signingTime ?? new Date()));
  const signedPropertiesHash = createHash('sha256').update(Buffer.from(signedProperties, 'utf8')).digest('base64');

  return {
    invoiceHash,
    qrPayload,
    stamp: stampBase64,
    extensionBlock: extensionBlock({
      invoiceHash,
      signedPropertiesHash,
      stamp: stampBase64,
      certificate: info.base64,
      signedProperties,
    }),
    certificate: info,
    curve,
  };
}
