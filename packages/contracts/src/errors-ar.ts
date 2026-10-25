/**
 * 📣 نصّ الخطأ بالعربية — مصدرٌ واحد لكل الأسطح.
 *
 * الخادم يكتب `errorTitle` بالإنجليزية لأسبابٍ تقنية (توثيق OpenAPI، واتساق الرموز)،
 * لكن ما يقرأه المستخدم يجب أن يكون عربياً بالكامل. هذه الخريطة تُترجم الرموز الشائعة،
 * ثم تسقط إلى جملةٍ عربية بحسب حالة HTTP بدل تسريب عنوانٍ إنجليزي إلى الشاشة.
 *
 * ولماذا في `@erp/contracts`؟ لأن الشاشات (staff · platform · bakery · portal) تتشارك
 * `web-core/api` نفسها؛ ترجمةٌ في تطبيقٍ واحد كانت ستترك البقية إنجليزية.
 */

export type ErrorStatusHint = {
  /** ما تقوله الشاشة حين لا يوجد رمزٌ معروف. */
  message: string;
  /** ما ينبغي أن يفعله المستخدم — يظهر كسطرٍ ثانٍ حين تحتاجه الشاشة. */
  action?: string;
};

const BY_STATUS: Record<number, ErrorStatusHint> = {
  400: { message: 'الطلب غير صحيح.', action: 'راجع البيانات المدخلة ثم أعد المحاولة.' },
  401: { message: 'انتهت الجلسة أو بيانات الدخول غير صحيحة.', action: 'سجّل الدخول من جديد.' },
  403: { message: 'لا تملك صلاحية لهذا الإجراء.', action: 'اطلب الصلاحية من مسؤول الحساب.' },
  404: { message: 'العنصر المطلوب غير موجود.', action: 'حدّث الشاشة ثم أعد المحاولة.' },
  409: { message: 'تعارض مع حالة المستند الحالية.', action: 'حدّث الشاشة، ثم أعد المحاولة أو أصدر إشعاراً دائناً.' },
  422: { message: 'البيانات غير مكتملة أو غير صحيحة.', action: 'راجع الحقول المعلَّمة ثم أعد المحاولة.' },
  423: { message: 'الحساب موقوف.', action: 'تواصل مع مالك المنشأة أو الدعم.' },
  429: { message: 'محاولات كثيرة في وقت قصير.', action: 'انتظر قليلاً ثم أعد المحاولة.' },
  500: { message: 'حدث خطأ غير متوقع في الخادم.', action: 'أعد المحاولة، وإن تكرر فأبلغ الدعم.' },
  502: { message: 'تعذّر الوصول إلى خدمة خارجية.', action: 'تحقق من إعدادات الربط ثم أعد المحاولة.' },
  503: { message: 'الخدمة غير متاحة حالياً.', action: 'أعد المحاولة بعد قليل.' },
};

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'انتهت الجلسة — سجّل الدخول من جديد.',
  FORBIDDEN: 'لا تملك صلاحية لهذا الإجراء.',
  TENANT_SUSPENDED: 'منشأة الحساب موقوفة — تواصل مع الدعم.',
  TENANT_CONTEXT_MISSING: 'لم يُحدَّد سياق المنشأة — أعد تسجيل الدخول.',
  VALIDATION_FAILED: 'البيانات المُرسلة غير صحيحة — راجع الحقول ثم أعد المحاولة.',
  NOT_FOUND: 'العنصر المطلوب غير موجود.',
  VERSION_CONFLICT: 'عُدّل السجل من مستخدم آخر — حدّث الشاشة ثم أعد المحاولة.',
  IDEMPOTENCY_REPLAY: 'هذا الطلب نُفِّذ سابقاً بنفس المعرّف.',
  RATE_LIMITED: 'محاولات كثيرة في وقت قصير — انتظر قليلاً ثم أعد المحاولة.',
  MFA_REQUIRED: 'رمز التحقق مطلوب.',
  INTERNAL: 'حدث خطأ غير متوقع في الخادم — أعد المحاولة أو أبلغ الدعم.',
  USAGE_LIMIT_REACHED: 'بلغت الحدّ المسموح به في باقتك — راجع «الاستخدام والحصص».',

  ACCOUNT_NOT_POSTABLE: 'الحساب المحاسبي لا يقبل الترحيل.',
  ACCOUNT_NOT_FOUND: 'الحساب المحاسبي غير موجود.',
  ACCOUNT_PROFILE_MISSING: 'الربط المحاسبي ناقص لهذه العملية — أكمل «الربط المحاسبي».',
  JOURNAL_UNBALANCED: 'القيد المحاسبي غير متوازن — راجع الحسابات المربوطة.',
  ACCOUNTING_PERIOD_CLOSED: 'الفترة المحاسبية مغلقة — افتحها أو استخدم تاريخاً داخل الفترة.',
  ACCOUNTING_PERIOD_LOCKED_MODULE: 'هذه الوحدة مقفلة في الفترة المحاسبية.',
  PERIOD_CLOSED: 'الفترة المحاسبية مغلقة.',
  FISCAL_PERIOD_CLOSED: 'الفترة المالية مغلقة.',
  FISCAL_PERIOD_NOT_FOUND: 'لا توجد فترة محاسبية مفتوحة تغطي تاريخ العملية — راجع «الفترات المحاسبية».',
  FISCAL_YEAR_NOT_FOUND: 'السنة المالية غير موجودة.',
  TAX_GROUP_RATE_LOCKED: 'لا يمكن تعديل نسبة ضريبة مستخدمة في فواتير سابقة — أنشئ مجموعة ضريبية جديدة بالنسبة المطلوبة.',
  TAX_GROUP_IN_USE: 'لا يمكن حذف مجموعة ضريبية مرتبطة بأصناف أو فواتير مسجّلة.',
  DOCUMENT_ALREADY_POSTED: 'المستند مُرحَّل بالفعل.',
  DOCUMENT_NOT_DRAFT: 'لا يمكن تعديل مستند غير مسودّة.',
  COST_CENTER_NOT_FOUND: 'مركز التكلفة غير موجود.',
  DISCOUNT_LIMIT_EXCEEDED: 'الخصم يتجاوز الحدّ المسموح للإعدادات.',

  PARTY_NOT_FOUND: 'العميل/المورد غير موجود.',
  PARTY_CREDIT_LIMIT_EXCEEDED: 'سقف الائتمان لهذا العميل لا يتحمّل قيمة الفاتورة.',
  ITEM_NOT_FOUND: 'الصنف غير موجود.',
  ITEM_SKU_TAKEN: 'رمز الصنف مستخدم بالفعل.',
  WAREHOUSE_NOT_FOUND: 'المستودع غير موجود.',
  BRANCH_NOT_FOUND: 'الفرع غير موجود.',
  CASH_LOCATION_NOT_FOUND: 'الصندوق أو البنك غير موجود.',
  CASH_LOCATION_REQUIRED: 'اختر الصندوق أو البنك أولاً.',

  STOCK_INSUFFICIENT: 'الكمية المتاحة في المستودع لا تكفي لهذه الحركة.',
  INVENTORY_LINES_REQUIRED: 'أضف سطراً واحداً على الأقل.',
  TRANSFER_INVALID_STATE: 'حالة التحويل لا تسمح بهذا الإجراء.',
  SHIFT_NOT_FOUND: 'وردية الكاشير غير موجودة.',
  LOT_NOT_FOUND: 'الدفعة غير موجودة.',
  LOT_NOT_TRACKED: 'هذا الصنف لا يُتتبَّع بالدفعات.',
  LOT_EXPIRY_MISMATCH: 'تاريخ انتهاء الدفعة مسجَّل بتاريخٍ مختلف.',
  SERIAL_DUPLICATE: 'الرقم التسلسلي مستخدم بالفعل.',
  SERIAL_NOT_FOUND: 'الرقم التسلسلي غير موجود.',
  SERIAL_COUNT_MISMATCH: 'عدد الأرقام التسلسلية لا يطابق الكمية.',
  SERIAL_INVALID_STATE: 'الرقم التسلسلي غير قابل للحركة الآن.',
  SERIAL_WRONG_WAREHOUSE: 'الرقم التسلسلي موجود في مستودع آخر.',
  SERIAL_NOT_RETURNABLE: 'الرقم التسلسلي لم يُبَع ولا يمكن إرجاعه.',
  SERIAL_COUNT_EXCEEDS_STOCK: 'عدد الأرقام التسلسلية يتجاوز رصيد المخزون المتاح.',
  BIN_CODE_INVALID: 'صيغة رمز الرف غير صالحة ويجب أن تكون مثل A-01-01.',
  BIN_RECEIVE_EXCEEDS_STOCK: 'كمية استلام الرف تتجاوز رصيد المخزون المتاح في المستودع.',

  SALES_INVOICE_NOT_FOUND: 'فاتورة المبيعات غير موجودة.',
  SALES_INVOICE_NOT_POSTED: 'الفاتورة غير مُرحَّلة — رحّلها أولاً.',
  SALES_INVOICE_INVALID_STATUS: 'حالة الفاتورة لا تسمح بهذا الإجراء.',
  SALES_VOID_HAS_RETURNS: 'الفاتورة لها مرتجعات مُرحَّلة — ألغِها قبل الإلغاء.',
  SALES_VOID_HAS_PAYMENTS: 'الفاتورة عليها دفعات — اعكس الدفعات قبل الإلغاء.',
  SALES_VOID_ZATCA_SEALED: 'فاتورة مختومة من هيئة الزكاة لا تُلغى — أصدر إشعاراً دائناً.',
  SALES_REFERENCE_VOIDED: 'الفاتورة المرجعية ملغاة.',
  SALES_RETURN_PRICE_EXCEEDED: 'سعر الوحدة المرتجع لا يمكن أن يتجاوز سعر البيع في الفاتورة الأصلية.',
  SALES_SETTLEMENT_EXCEEDS_TOTAL: 'قيمة السداد تتجاوز إجمالي الفاتورة.',
  EINVOICE_SAVE_BLOCKED_BY_LINK:
    'الربط الضريبي مفعّل وخيار «منع الحفظ عند الربط الضريبي» مُشغَّل: لا تُحفظ الفاتورة كمسودة، استخدم «حفظ وترحيل».',

  PURCHASE_INVOICE_INVALID_STATUS: 'حالة فاتورة المشتريات لا تسمح بهذا الإجراء.',
  PURCHASE_SUPPLIER_REQUIRED: 'فاتورة المشتريات تحتاج مورداً.',
  PURCHASE_LINES_REQUIRED: 'أضف سطراً واحداً على الأقل.',
  PURCHASE_VOID_HAS_RETURNS: 'فاتورة المشتريات لها مردودات مُرحَّلة.',
  PURCHASE_REFERENCE_VOIDED: 'فاتورة المشتريات المرجعية ملغاة.',
  PURCHASE_RETURN_PRICE_EXCEEDED: 'سعر الوحدة في مردود الشراء لا يمكن أن يتجاوز سعر فاتورة الشراء الأصلية.',

  VOUCHER_NOT_FOUND: 'السند غير موجود.',
  VOUCHER_INVALID_STATUS: 'حالة السند لا تسمح بهذا الإجراء.',
  VOUCHER_TIME_INVALID: 'وقت السند غير صحيح.',
  PAYMENT_AMOUNT_INVALID: 'قيمة الدفعة غير صحيحة.',
  PAYMENT_EXCEEDS_DUE: 'قيمة الدفعة تتجاوز المتبقي على المستند.',

  APPROVAL_REQUIRED: 'هذا المستند يحتاج موافقة — أُرسل الطلب إلى وارد الموافقات.',
  ADDON_REQUIRES_PLATFORM_APPROVAL: 'هذه الإضافة تُرخَّص من المنصة — اطلب تفعيلها.',
  ADDON_NOT_LICENSED: 'هذه الشاشة تخصّ إضافةً غير مرخَّصة لمنشأتك.',

  EINVOICE_REJECTED: 'رفضت هيئة الزكاة والضريبة الفاتورة — راجع «الفواتير المرفوعة».',
  EINVOICE_SUBMISSION_NOT_FOUND: 'إرسال الفاتورة للهيئة غير موجود.',
  EINVOICE_ALREADY_ACCEPTED: 'الفاتورة مُرسلة ومقبولة سابقاً — لا تُرسل مرتين.',
  EINVOICE_SETTINGS_SAVE_FAILED: 'تعذّر حفظ إعدادات الربط الضريبي.',
  EINVOICE_ENVIRONMENT_INVALID: 'بيئة الربط يجب أن تكون compliance أو production.',
  EINVOICE_START_DATE_INVALID: 'تاريخ بداية الربط غير صحيح.',

  STORAGE_NOT_CONFIGURED: 'تخزين الملفات غير مُهيَّأ على هذا الخادم.',
  FILE_NOT_FOUND: 'الملف غير موجود.',
  FILE_TOO_LARGE: 'حجم الملف أكبر من الحدّ المسموح.',
  FILE_MIME_NOT_ALLOWED: 'نوع الملف غير مسموح.',

  EMAIL_NOT_CONFIGURED: 'إعدادات البريد غير مكتملة — أدخل مزوّد البريد ومفتاحه.',
  EMAIL_SEND_FAILED: 'تعذّر إرسال البريد — راجع إعدادات المزوّد ثم أعد الاختبار.',
  WHATSAPP_NOT_CONFIGURED: 'إعدادات واتساب غير مكتملة.',
  WHATSAPP_DISABLED: 'واتساب معطّل في الإعدادات.',

  BACKUP_ARTIFACT_MISSING: 'ملف النسخة الاحتياطية غير موجود.',
  BACKUP_FAILED: 'تعذّر إنشاء النسخة الاحتياطية.',
  RESTORE_FAILED: 'تعذّرت الاستعادة.',

  MIGRATION_CONFLICT: 'تعارض في ترحيل البيانات.',
  REPORT_NOT_FOUND: 'التقرير غير موجود.',
  SEQUENCE_EXHAUSTED: 'نفدت أرقام التسلسل لهذا المستند — راجع إعدادات الترقيم.',
  INVALID_ID: 'المعرّف غير صحيح.',
  INVALID_STATE: 'لا يمكن تنفيذ هذا الإجراء في الحالة الحالية.',
  COMPAT_TOKEN_INVALID: 'رمز التوافق غير صحيح.',
  SECRET_DECRYPT_FAILED: 'تعذّر فكّ تشفير السرّ — أعد إدخاله.',
  HANDOFF_CODE_INVALID: 'رمز الانتقال غير صحيح أو منتهي.',
  TENANT_NOT_FOUND: 'المنشأة غير موجودة.',
  USER_NOT_FOUND: 'المستخدم غير موجود.',
  ROLE_NOT_FOUND: 'الدور غير موجود.',
  TEMPLATE_NOT_FOUND: 'القالب غير موجود.',
  SALES_OFFER_CODE_TAKEN: 'رمز العرض الترويجي مسجّل مسبقاً.',
  SALES_OFFER_DISCOUNT_INVALID: 'قيمة أو نسبة الخصم غير صحيحة.',
  SALES_OFFER_TARGET_INVALID: 'الحد الأدنى المستهدف للعرض غير صحيح.',
};

/** الترجمة العربية لرمز خطأ؛ و`undefined` حين لا يوجد نصٌّ خاص (تسقط الشاشة إلى حالة HTTP). */
export function arabicErrorTextForCode(code: string): string | undefined {
  return MESSAGES[code];
}

/**
 * النصّ النهائي: رمزٌ مترجَم، ثم جملة حالة HTTP، ثم بديلٌ عامّ.
 * لا تُعيد هذه الدالة نصاً إنجليزياً أبداً.
 */
export function arabicErrorText(code: string, status = 0): string {
  const known = MESSAGES[code];
  if (known) return known;
  const byStatus = BY_STATUS[status];
  if (byStatus) return byStatus.message;
  if (status >= 500) return BY_STATUS[500]!.message;
  return 'تعذّر إكمال الطلب.';
}

/** إرشاد ما بعد الخطأ بحسب حالته (اختياري في الشاشات). */
export function arabicErrorHint(status: number): string | undefined {
  return BY_STATUS[status]?.action;
}
