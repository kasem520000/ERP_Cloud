/*
 * Small native IndexedDB adapter for the offline till.
 *
 * We intentionally do not make Dexie a runtime dependency for a single queue: the
 * browser owns the offline copy, while the API remains the authority after replay.
 */

export type OfflineCatalogItem = {
  id: string;
  sku?: string;
  barcode?: string | null;
  nameAr?: string | null;
  nameEn?: string | null;
  categoryId?: string | null;
  baseUnitId?: string | null;
  kind?: string;
  salePrice?: string | null;
  taxGroupId?: string | null;
  trackLot?: boolean;
  trackSerial?: boolean;
  weightedScale?: boolean;
};

export type OfflineCatalog = {
  schemaVersion?: number;
  generatedAt?: string;
  expiresInSeconds?: number;
  items: OfflineCatalogItem[];
  categories?: Array<Record<string, unknown>>;
  units?: Array<Record<string, unknown>>;
  itemUnits?: Array<Record<string, unknown>>;
  barcodes?: Array<Record<string, unknown>>;
  taxes?: Array<Record<string, unknown>>;
  customers?: Array<Record<string, unknown>>;
  branches?: Array<Record<string, unknown>>;
  warehouses?: Array<Record<string, unknown>>;
  cashLocations?: Array<Record<string, unknown>>;
  priceLists?: Array<Record<string, unknown>>;
  prices?: Array<Record<string, unknown>>;
  stock?: Array<Record<string, unknown>>;
  defaults?: {
    branchId?: string | null;
    warehouseId?: string | null;
    cashLocationId?: string | null;
  };
};

export type OfflineCheckoutPayload = {
  branchId: string;
  warehouseId?: string;
  partyId?: string;
  cashCustomerName?: string;
  cashCustomerMobile?: string;
  priceIncludesVat?: boolean;
  invoiceDiscount?: string;
  orderType?: string;
  lines: Array<{
    itemId: string;
    quantity: string;
    unitPrice: string;
    taxRate?: string;
    discountAmount?: string;
    description?: string;
  }>;
  payment: {
    method: 'cash';
    cashLocationId?: string;
    tendered?: string;
  };
};

export type OfflineQueueStatus = 'pending' | 'synced' | 'conflict';

/**
 * 🚐 طابورُ المندوب (‏`vanQueue`) — مستوى التخزين لتطبيق التوزيع دون اتصال.
 *
 * **قاعدةٌ واحدة وهويّةٌ واحدة**: المخزنُ جديدٌ لكنّه في القاعدة نفسها
 * (‏`erpcloud-pos-offline`) ويشارك `meta` (‏`deviceId` و`sequence`) مع طابور نقطة البيع —
 * فلا قاعدةَ ثانية ولا `deviceId` ثانيًا ولا تسلسلًا ثانيًا، وإلّا صار للجهاز الواحد
 * هويّتان ومفاتيحُ عدم تكرارٍ لا تُنسب إلى بعضها.
 *
 * **ومخزنٌ منفصلٌ لا صفوفٌ في `queue`**: فسجلُّ نقطة البيع محكومٌ بنوع
 * `payload: OfflineCheckoutPayload`، وسجلُّ المندوب يحمل `operation` و`endpoint` و`body`
 * الحرّ — وخلطُ الشكلين في مخزنٍ واحد يعني نوعًا مشتركًا يكذب على أحدهما.
 *
 * **والإعادةُ سجلٌّ بسجلٍّ إلى المسار الرسميّ**: فلا يوجد `POST /van-sales/offline-sync`
 * (فحصُ المسارات: ‏٢٤ مسارًا في `van-sales.controller.ts` ولا مزامنةَ جماعية فيها)، وأمّا
 * `POST /pos/offline-sync` فخاصٌّ بنقطة البيع وجسمُه `OfflineCheckoutPayload`. فالطابورُ هنا
 * يعيد كلّ نيّةٍ إلى مسارها الرسميّ نفسه (`/van-sales/documents`، ‏`…/returns`،
 * ‏`/van-sales/collections`) بجسمها ومفتاحها — والخادمُ هو السلطةُ بعد الإعادة.
 *
 * **والمفتاحُ يُبنى مرّةً عند الحفظ ويُستعمل في كلّ إعادة**: فهذا ما يجعل الإعادةَ آمنة —
 * ‏`createDocument` يفحص `idempotency_key` الموجود ويعيد اللوحةَ بلا مستندٍ ثانٍ
 * (‏`if (existing) return this.dashboard(tenantId)`، قِيس)، والمرتجعُ كذلك (‏٢٠١ وبلا تغيير
 * في `van-sales-stock-acceptance.spec.ts`). ومفتاحٌ جديدٌ لكلّ محاولة = مستندٌ مكرَّر.
 *
 * **وما لا يُحفظ هنا إطلاقًا**: `submit-closing` و`confirm-receipt` — فأجسامُهما
 * ‏`{…}` بلا `idempotencyKey` (قِيس في `van-sales.controller.ts`: الإقفالُ
 * ‏`:311` والاستلامُ `:148`)، وإعادةُ إرسالٍ عمياء لإقفالٍ تعيد كتابةَ إعلان المندوب
 * (`submitClosing` لا يرفض إلّا إذا كانت الحالةُ `settled`)، وللاستلام تعيد تحريكَ
 * البضاعة. ورفضُ الحفظ في `apps/bakery/lib/rep-queue.ts` (منطقٌ نقيٌّ بأحكام) لا هنا.
 */
export type VanQueueOperation = 'document' | 'return' | 'collection';

/**
 * ‏- `pending`: نيّةٌ محفوظةٌ تنتظر الإعادة.
 * ‏- `synced`: وصلت (‏٢٠٠/٢٠١) أو وصلت من قبل (إعادةُ المفتاح نفسه) — فلا تُعاد.
 * ‏- `refused`: الخادمُ رفضها (٤٢٢/٤٠٣/٤٠٤/٤٠٩) ورسالتُه العربية محفوظةٌ كما رجعت.
 *
 * وليس هنا حالةُ «خطأ شبكة»: فخطأُ الشبكة يُبقي السجلّ `pending` ويزيد `attempts` — لأنّ
 * النيّةَ لم تُرفض، بل لم تصل.
 */
export type VanQueueStatus = 'pending' | 'synced' | 'refused';

export type VanQueueRecord = {
  offlineId: string;
  deviceId: string;
  sequenceNo: number;
  createdAt: string;
  operation: VanQueueOperation;
  /** المسارُ الرسميّ نفسه (بلا `/api/v1` الذي يضيفه `apiPost`) — فلا مسارَ مخترعًا. */
  endpoint: string;
  /** جسمُ الطلب حرفًا كما سيُرسل، وفيه `idempotencyKey` نفسه في كلّ إعادة. */
  body: Record<string, unknown>;
  /** نسخةٌ من مفتاح الجسم لأجل العرض والبحث — والمصدرُ `body.idempotencyKey`. */
  idempotencyKey: string;
  status: VanQueueStatus;
  attempts: number;
  lastAttemptAt: string | null;
  lastStatusCode: number | null;
  lastErrorCode: string | null;
  /** رسالةُ الخادم العربية (`detail`) كما رجعت — تُعرض كما هي ولا تُترجم ولا تُختصر. */
  lastMessage: string | null;
  /** عنوانٌ محليٌّ للقائمة (رقمُ أمر التحميل مثلًا) — لا رقمٌ من الخادم قبل المزامنة. */
  label: string | null;
};

export type VanQueueCounts = { pending: number; synced: number; refused: number; total: number };

/** نتيجةُ مسح التخزين — فالمسحُ قد **يُرفض** حمايةً لنيّةٍ لم تصل. */
export type OfflineResetResult = { cleared: boolean; pendingVanQueue: number };

export type OfflineQueueRecord = {
  offlineId: string;
  deviceId: string;
  sequenceNo: number;
  createdAt: string;
  payload: OfflineCheckoutPayload;
  status: OfflineQueueStatus;
  invoiceId?: string;
  number?: string | null;
  errorCode?: string;
  message?: string;
  resolution?: unknown;
};

const DB_NAME = 'erpcloud-pos-offline';
/**
 * ‏٢ = إضافةُ مخزن `vanQueue` (طابورُ المندوب). والترقيةُ إنشاءُ مخزنٍ جديدٍ فقط — فلا
 * فهرسٌ يتغيّر ولا سجلٌّ يُنقل، و`onupgradeneeded` محروسٌ بـ`contains` فيبقى آمناً على
 * قاعدةٍ قائمة (وسجلّاتُ نقطة البيع ومحفوظاتُها لا تُمسّ).
 */
const DB_VERSION = 2;
const STORE_NAMES = ['meta', 'items', 'customers', 'catalog', 'queue'] as const;
type StoreName = (typeof STORE_NAMES)[number];

let databasePromise: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.reject(new Error('IndexedDB is not available in this browser'));
  }
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Could not open offline storage'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('customers')) db.createObjectStore('customers', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('catalog')) db.createObjectStore('catalog', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('queue')) {
        const queue = db.createObjectStore('queue', { keyPath: 'offlineId' });
        queue.createIndex('status', 'status', { unique: false });
        queue.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('vanQueue')) {
        const vanQueue = db.createObjectStore('vanQueue', { keyPath: 'offlineId' });
        vanQueue.createIndex('status', 'status', { unique: false });
        vanQueue.createIndex('createdAt', 'createdAt', { unique: false });
        vanQueue.createIndex('operation', 'operation', { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
  return databasePromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export async function getOrCreateDeviceId(): Promise<string> {
  const db = await database();
  const transaction = db.transaction('meta', 'readwrite');
  const store = transaction.objectStore('meta');
  const current = (await requestResult(store.get('deviceId'))) as { key: string; value: string } | undefined;
  const deviceId = current?.value ?? `device-${randomId()}`;
  if (!current) store.put({ key: 'deviceId', value: deviceId });
  await transactionDone(transaction);
  return deviceId;
}

export async function getNextSequence(): Promise<number> {
  const db = await database();
  const transaction = db.transaction('meta', 'readwrite');
  const store = transaction.objectStore('meta');
  const current = (await requestResult(store.get('sequence'))) as { key: string; value: number } | undefined;
  const sequenceNo = (current?.value ?? 0) + 1;
  store.put({ key: 'sequence', value: sequenceNo });
  await transactionDone(transaction);
  return sequenceNo;
}

export async function saveOfflineCatalog(catalog: OfflineCatalog): Promise<void> {
  const db = await database();
  const transaction = db.transaction([...STORE_NAMES] as StoreName[], 'readwrite');
  transaction.objectStore('items').clear();
  transaction.objectStore('customers').clear();
  transaction.objectStore('catalog').clear();
  for (const item of catalog.items ?? []) transaction.objectStore('items').put(item);
  for (const customer of catalog.customers ?? []) {
    if (typeof customer.id === 'string') transaction.objectStore('customers').put(customer);
  }
  transaction.objectStore('catalog').put({ key: 'bundle', ...catalog });
  transaction.objectStore('meta').put({ key: 'catalogAt', value: new Date().toISOString() });
  await transactionDone(transaction);
}

export async function readOfflineCatalog(): Promise<OfflineCatalog | undefined> {
  const db = await database();
  const transaction = db.transaction('catalog', 'readonly');
  const row = (await requestResult(transaction.objectStore('catalog').get('bundle'))) as
    ({ key: string } & OfflineCatalog) | undefined;
  if (!row) return undefined;
  return row;
}

export async function saveOfflineInvoice(
  payload: OfflineCheckoutPayload,
  deviceId = '',
): Promise<OfflineQueueRecord> {
  const actualDeviceId = deviceId || (await getOrCreateDeviceId());
  const sequenceNo = await getNextSequence();
  const record: OfflineQueueRecord = {
    offlineId: `OFFLINE-${actualDeviceId}-${sequenceNo}-${randomId().slice(0, 8)}`,
    deviceId: actualDeviceId,
    sequenceNo,
    createdAt: new Date().toISOString(),
    payload,
    status: 'pending',
  };
  const db = await database();
  const transaction = db.transaction('queue', 'readwrite');
  transaction.objectStore('queue').put(record);
  await transactionDone(transaction);
  return record;
}

export async function listOfflineInvoices(): Promise<OfflineQueueRecord[]> {
  const db = await database();
  const transaction = db.transaction('queue', 'readonly');
  const rows = (await requestResult(transaction.objectStore('queue').getAll())) as OfflineQueueRecord[];
  return rows.sort((left, right) => right.sequenceNo - left.sequenceNo);
}

export async function pendingOfflineInvoices(): Promise<OfflineQueueRecord[]> {
  const records = await listOfflineInvoices();
  return records.filter((record) => record.status === 'pending');
}

export async function updateOfflineInvoice(
  offlineId: string,
  patch: Partial<OfflineQueueRecord>,
): Promise<OfflineQueueRecord | undefined> {
  const db = await database();
  const transaction = db.transaction('queue', 'readwrite');
  const store = transaction.objectStore('queue');
  const current = (await requestResult(store.get(offlineId))) as OfflineQueueRecord | undefined;
  if (!current) {
    await transactionDone(transaction);
    return undefined;
  }
  const next = { ...current, ...patch, offlineId };
  store.put(next);
  await transactionDone(transaction);
  return next;
}

export async function removeOfflineInvoice(offlineId: string): Promise<void> {
  const db = await database();
  const transaction = db.transaction('queue', 'readwrite');
  transaction.objectStore('queue').delete(offlineId);
  await transactionDone(transaction);
}

export async function clearSyncedOfflineInvoices(): Promise<void> {
  const records = await listOfflineInvoices();
  await Promise.all(
    records
      .filter((record) => record.status === 'synced')
      .map((record) => removeOfflineInvoice(record.offlineId)),
  );
}

export async function offlineQueueCounts(): Promise<{ pending: number; conflicts: number; synced: number }> {
  const records = await listOfflineInvoices();
  return {
    pending: records.filter((record) => record.status === 'pending').length,
    conflicts: records.filter((record) => record.status === 'conflict').length,
    synced: records.filter((record) => record.status === 'synced').length,
  };
}

/**
 * 🚐 حفظُ نيّةٍ في طابور المندوب. و`deviceId` و`sequenceNo` من `meta` المشتركة مع نقطة
 * البيع — فلا هويّةَ ثانيةَ للجهاز. والمفتاحُ **لا يُبنى هنا**: تبنيه الشاشةُ من
 * `submissionIdempotencyKey` (‏`@erp/web-core/idempotency`) وتحفظه في الجسم، لأنّ بناءَه
 * من الحمولة هو ما يجعل النيّةَ الواحدةَ مفتاحًا واحدًا.
 */
export async function enqueueVanOperation(input: {
  operation: VanQueueOperation;
  endpoint: string;
  body: Record<string, unknown>;
  idempotencyKey: string;
  label?: string | null;
  deviceId?: string;
}): Promise<VanQueueRecord> {
  const deviceId = input.deviceId || (await getOrCreateDeviceId());
  const sequenceNo = await getNextSequence();
  const record: VanQueueRecord = {
    offlineId: `VAN-${deviceId}-${sequenceNo}-${randomId().slice(0, 8)}`,
    deviceId,
    sequenceNo,
    createdAt: new Date().toISOString(),
    operation: input.operation,
    endpoint: input.endpoint,
    body: { ...input.body, idempotencyKey: input.idempotencyKey },
    idempotencyKey: input.idempotencyKey,
    status: 'pending',
    attempts: 0,
    lastAttemptAt: null,
    lastStatusCode: null,
    lastErrorCode: null,
    lastMessage: null,
    label: input.label ?? null,
  };
  const db = await database();
  const transaction = db.transaction('vanQueue', 'readwrite');
  transaction.objectStore('vanQueue').put(record);
  await transactionDone(transaction);
  return record;
}

/** كلّ السجلّات، الأحدثُ تسلسلًا أولًا — فالترتيبُ هو ترتيبُ نيّات المندوب لا وصولها. */
export async function listVanQueue(): Promise<VanQueueRecord[]> {
  const db = await database();
  const transaction = db.transaction('vanQueue', 'readonly');
  const rows = (await requestResult(transaction.objectStore('vanQueue').getAll())) as VanQueueRecord[];
  return rows.sort((left, right) => right.sequenceNo - left.sequenceNo);
}

/** ما ينتظر الإعادة — وهو ما تُرسله المزامنة، وبالترتيب نفسه الذي أُدخل به. */
export async function pendingVanQueue(): Promise<VanQueueRecord[]> {
  const records = await listVanQueue();
  return records
    .filter((record) => record.status === 'pending')
    .sort((left, right) => left.sequenceNo - right.sequenceNo);
}

export async function updateVanQueueRecord(
  offlineId: string,
  patch: Partial<Omit<VanQueueRecord, 'offlineId'>>,
): Promise<VanQueueRecord | undefined> {
  const db = await database();
  const transaction = db.transaction('vanQueue', 'readwrite');
  const store = transaction.objectStore('vanQueue');
  const current = (await requestResult(store.get(offlineId))) as VanQueueRecord | undefined;
  if (!current) {
    await transactionDone(transaction);
    return undefined;
  }
  const next: VanQueueRecord = { ...current, ...patch, offlineId };
  store.put(next);
  await transactionDone(transaction);
  return next;
}

export async function removeVanQueueRecord(offlineId: string): Promise<void> {
  const db = await database();
  const transaction = db.transaction('vanQueue', 'readwrite');
  transaction.objectStore('vanQueue').delete(offlineId);
  await transactionDone(transaction);
}

/**
 * تنظيفُ ما وصل — و**المرفوضُ يبقى**: فنيّةٌ رفضها الخادمُ تحتاج قرار المندوب (يُصحّحها أو
 * يحذفها وهو يعلم)، وحذفُها بصمتٍ يعني أنّ بيعًا سُجِّل محليًّا ولم يصل ولم يُقَل لأحد.
 */
export async function clearSyncedVanQueue(): Promise<number> {
  const records = await listVanQueue();
  const synced = records.filter((record) => record.status === 'synced');
  await Promise.all(synced.map((record) => removeVanQueueRecord(record.offlineId)));
  return synced.length;
}

export async function vanQueueCounts(): Promise<VanQueueCounts> {
  const records = await listVanQueue();
  return {
    pending: records.filter((record) => record.status === 'pending').length,
    synced: records.filter((record) => record.status === 'synced').length,
    refused: records.filter((record) => record.status === 'refused').length,
    total: records.length,
  };
}

/**
 * مسحُ التخزين المحلّي — و**يُرفض إن كان في طابور المندوب نيّةٌ لم تصل** إلا بـ`force`.
 *
 * والمسحُ حذفُ القاعدة كلها (‏`deleteDatabase`)، فنيّاتُ المندوب المعلّقة كانت ستُمحى معه
 * بصمت: بيعٌ سُجِّل في سيارةٍ بلا شبكة، وضغطُ «مسح التخزين» في تبويبٍ آخر يُنسيه. والمالُ
 * لا يُمحى بضغطةٍ غير مقصودة، فالنتيجةُ تُعيد `cleared: false` وعددَ النيّات المعلّقة
 * وتقول الشاشةُ لمستخدمها لماذا — ولا يُكتفى برمي خطأٍ قد يبتلعه مستدعٍ قديم.
 */
export async function resetOfflineStorage(options?: {
  force?: boolean;
}): Promise<OfflineResetResult> {
  if (typeof window === 'undefined' || !('indexedDB' in window))
    return { cleared: false, pendingVanQueue: 0 };
  if (options?.force !== true) {
    const counts = await vanQueueCounts().catch(() => null);
    if (counts && counts.pending > 0)
      return { cleared: false, pendingVanQueue: counts.pending };
  }
  databasePromise = undefined;
  await new Promise<void>((resolve, reject) => {
    const request = window.indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Could not clear offline storage'));
    request.onblocked = () => reject(new Error('Close other ERP tabs before clearing offline storage'));
  });
  return { cleared: true, pendingVanQueue: 0 };
}
