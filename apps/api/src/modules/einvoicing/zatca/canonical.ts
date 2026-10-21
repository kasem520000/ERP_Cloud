/**
 * 🧾 التطبيع القانوني (Canonical XML) — C14N 1.0/1.1 لما تُصدره ZATCA.
 *
 * بصمة الفاتورة ليست SHA-256 على النصّ كما نكتبه، بل على المستند بعد **التطبيع**: تُحذف
 * عُقد `ext:UBLExtensions` و`cac:Signature` ومرجع `QR`، ثم يُعاد ترتيب سمات كل عنصر
 * وإعلانات namespace حسب القاعدة، وتُكتب العناصر الفارغة بصيغة `<x></x>`، وتُهرَّب
 * المحارف في النصوص بالقدر الذي تطلبه المواصفة فقط.
 *
 * لماذا تطبيعٌ كامل بدل «نكتب المستند مضغوطاً فيكون هو التطبيع»؟ لأن الهيئة تُطبّع
 * **ما يصلها** لا ما نوينا إرساله: أي إعادة تنسيق على الطريق تُبقي البصمة صحيحة ما دام
 * التطبيع مطبَّقاً على الوجهين. والمستند الذي نبنيه هنا صغير (فاتورة واحدة، سمات قليلة)
 * فتطبيعه في الذاكرة رخيص.
 *
 * ما لا نطبّعه: لا `xml:base` ولا `xml:id` في مستنداتنا، ولا تعليقات ولا تعليمات معالجة،
 * فالفارق بين C14N 1.0 و1.1 لا يظهر — ولذلك يصلح هذا المُطبِّع للمقارنة مع ما تحسبه
 * الهيئة بمواصفة 1.1.
 */
import { createHash } from 'node:crypto';

import { DOMParser } from '@xmldom/xmldom';

/** الأنماط التي تُحذف قبل حساب البصمة: التوقيع نفسه ومرمّز QR. */
export const STRIPPED_BEFORE_HASH = {
  /** `ext:UBLExtensions` — يحمل `ds:Signature` كاملاً. */
  extensions: 'ext:UBLExtensions',
  /** `cac:Signature` — الصيغة الأخرى لحمل التوقيع في UBL. */
  signature: 'cac:Signature',
  /** مرجع QR داخل `cac:AdditionalDocumentReference` (يُعرَّف بـ`cbc:ID>QR`). */
  qrReference: 'QR',
} as const;

/**
 * A structural view of the DOM nodes we touch. Declared locally rather than pulled from
 * `lib.dom`: this is a Node package, and the linter has no browser globals — the shapes
 * below are the only ones `@xmldom/xmldom` guarantees here.
 */
type XmlAttribute = { name: string; value: string };
type XmlNode = {
  nodeType: number;
  nodeName: string;
  nodeValue?: string | null;
  textContent?: string | null;
  parentNode?: XmlNode | null;
  documentElement?: XmlNode | null;
  childNodes: { length: number; item(index: number): XmlNode | null };
  attributes?: { length: number; item(index: number): XmlAttribute | null };
  getElementsByTagName(name: string): { length: number; item(index: number): XmlNode | null };
  removeChild(node: XmlNode): XmlNode;
};

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\r', '&#13;');
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\t', '&#9;')
    .replaceAll('\n', '&#10;')
    .replaceAll('\r', '&#13;');
}

/** True when a `cac:AdditionalDocumentReference` carries `<cbc:ID>QR</cbc:ID>`. */
function isQrReference(element: XmlNode): boolean {
  const children = element.childNodes;
  for (let index = 0; index < children.length; index += 1) {
    const child = children.item(index);
    if (!child || child.nodeType !== 1) continue;
    if (child.nodeName === 'cbc:ID' && (child.textContent ?? '').trim() === STRIPPED_BEFORE_HASH.qrReference) return true;
  }
  return false;
}

function collect(document: XmlNode, tag: string): XmlNode[] {
  const nodes = document.getElementsByTagName(tag);
  // Copy first: removing while iterating a live list skips siblings.
  const found: XmlNode[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes.item(index);
    if (node) found.push(node);
  }
  return found;
}

/** Removes the nodes ZATCA excludes from the invoice hash, in place. */
export function stripNonHashedNodes(document: XmlNode): void {
  for (const tag of [STRIPPED_BEFORE_HASH.extensions, STRIPPED_BEFORE_HASH.signature]) {
    for (const node of collect(document, tag)) node.parentNode?.removeChild(node);
  }
  for (const node of collect(document, 'cac:AdditionalDocumentReference')) {
    if (isQrReference(node)) node.parentNode?.removeChild(node);
  }
}

/** Serialises one node per C14N: namespaces first (sorted by prefix), then attributes. */
function serialize(node: XmlNode): string {
  const type = node.nodeType;
  if (type === 3 /* text */ || type === 4 /* CDATA */) return escapeText(node.nodeValue ?? '');
  if (type !== 1 /* element */) return ''; // comments and processing instructions are dropped

  const name = node.nodeName;
  const attributes = node.attributes;

  const declarations: Array<{ prefix: string; uri: string }> = [];
  const plain: Array<{ name: string; value: string }> = [];
  const attributeCount = attributes?.length ?? 0;
  for (let index = 0; index < attributeCount; index += 1) {
    const attribute = attributes?.item(index);
    if (!attribute) continue;
    if (attribute.name === 'xmlns') {
      declarations.push({ prefix: '', uri: attribute.value });
    } else if (attribute.name.startsWith('xmlns:')) {
      declarations.push({ prefix: attribute.name.slice('xmlns:'.length), uri: attribute.value });
    } else {
      plain.push({ name: attribute.name, value: attribute.value });
    }
  }
  declarations.sort((left, right) => (left.prefix < right.prefix ? -1 : left.prefix > right.prefix ? 1 : 0));
  // Unqualified attributes sort by local name (their namespace URI is empty), which is the
  // order C14N requires; a namespaced attribute would sort after them, and none exist here.
  plain.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

  const renderedDeclarations = declarations
    .map((declaration) =>
      declaration.prefix === ''
        ? ` xmlns="${escapeAttribute(declaration.uri)}"`
        : ` xmlns:${declaration.prefix}="${escapeAttribute(declaration.uri)}"`,
    )
    .join('');
  const renderedAttributes = plain.map((attribute) => ` ${attribute.name}="${escapeAttribute(attribute.value)}"`).join('');

  const children: string[] = [];
  for (let index = 0; index < node.childNodes.length; index += 1) {
    const child = node.childNodes.item(index);
    if (child) children.push(serialize(child));
  }
  return `<${name}${renderedDeclarations}${renderedAttributes}>${children.join('')}</${name}>`;
}

/** Serialises a parsed document per C14N. */
export function canonicalizeDocument(document: XmlNode): string {
  const root = document.documentElement;
  if (!root) return '';
  return serialize(root);
}

/** Canonicalises an XML string, signature/QR nodes kept as they are. */
export function canonicalizeXml(xml: string): string {
  return canonicalizeDocument(new DOMParser().parseFromString(xml, 'text/xml') as unknown as XmlNode);
}

/** The canonical form of the invoice **without** the signature and QR nodes. */
export function canonicalInvoiceForHash(xml: string): string {
  const document = new DOMParser().parseFromString(xml, 'text/xml') as unknown as XmlNode;
  stripNonHashedNodes(document);
  return canonicalizeDocument(document);
}

/** Base64 SHA-256 of the canonical invoice — ZATCA's `invoiceHash`, also QR tag 6. */
export function hashCanonicalInvoice(xml: string): string {
  return createHash('sha256').update(Buffer.from(canonicalInvoiceForHash(xml), 'utf8')).digest('base64');
}
