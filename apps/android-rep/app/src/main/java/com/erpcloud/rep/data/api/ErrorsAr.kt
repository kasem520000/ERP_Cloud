package com.erpcloud.rep.data.api

/**
 * تعريبُ رموز الأخطاء القياسيّة من الخادم (packages/contracts/src/errors.ts و van-sales)
 * كي لا تظهر للمندوب رسائلُ تقنيّةٌ بالإنجليزيّة عند رفض الطلب.
 */
object ErrorsAr {
    private val byCode: Map<String, String> = mapOf(
        "UNAUTHENTICATED" to "انتهت الجلسة أو بيانات الدخول غير صحيحة — أعد تسجيل الدخول.",
        "INVALID_CREDENTIALS" to "البريد الإلكتروني أو كلمة المرور أو رمز المنشأة غير صحيح.",
        "MFA_REQUIRED" to "هذا الحساب يتطلّب رمز التحقّق الثنائي (MFA).",
        "INVALID_MFA_CODE" to "رمز التحقّق الثنائي غير صحيح.",
        "ACCOUNT_LOCKED" to "تم قفل الحساب مؤقتًا لكثرة المحاولات — انتظر قليلًا ثم أعد المحاولة.",
        "ACCOUNT_DISABLED" to "الحساب موقوف — تواصل مع إدارة المنشأة.",
        "PASSWORD_CHANGE_REQUIRED" to "يجب تغيير كلمة المرور قبل متابعة العمل.",
        "WEAK_PASSWORD" to "كلمة المرور الجديدة لا تستوفي شروط الأمان المعتمدة.",
        "FORBIDDEN" to "ليست لديك الصلاحية لتنفيذ هذا الإجراء — راجع المحاسب.",
        "TENANT_SUSPENDED" to "حساب المنشأة موقوف حاليًّا.",
        "NOT_FOUND" to "العنصر المطلوب غير موجود أو حُذف.",
        "PARTY_NOT_FOUND" to "بطاقة العميل غير موجودة.",
        "PARTY_CREDIT_HOLD" to "العميل موقوف ائتمانيًّا — لا يُسمح بالبيع الآجل له.",
        "CREDIT_LIMIT_EXCEEDED" to "تجاوز العميل الحدّ الائتماني المسموح به.",
        "DISCOUNT_LIMIT_EXCEEDED" to "الخصم يتجاوز السقف المسموح به لصلاحيتك.",
        "INSUFFICIENT_STOCK" to "الكمية المطلوبة تتجاوز الرصيد المتاح في السيارة.",
        "PERIOD_CLOSED" to "الفترة المحاسبية مقفلة — راجع المحاسب.",
        "FISCAL_PERIOD_CLOSED" to "الفترة المحاسبية لهذا التاريخ مقفلة — راجع المحاسب.",
        "RETURN_QTY_EXCEEDED" to "الكمية المرتجعة تتجاوز المتاح للإرجاع من مستند البيع الأصلي.",
        "PAYMENT_EXCEEDS_DUE" to "مبلغ التحصيل يتجاوز الرصيد المتبقي على الفاتورة.",
        "IDEMPOTENCY_REPLAY" to "مفتاح عدم التكرار استُعمل سابقًا بحمولة مختلفة — راجع العملية.",
        "CONFLICT" to "تعارض في حالة السجل — حدّث مساحة العمل وأعد المحاولة.",
        "VAN_LOAD_ORDER_NOT_RECEIVED" to "لا يمكن البيع من أمر تحميل لم يُؤكَّد استلامه بعد.",
        "VAN_LOAD_ORDER_NOT_AWAITING_RECEIPT" to "تم تأكيد أو معالجة استلام أمر التحميل هذا مسبقًا.",
        "VAN_LOAD_ORDER_ALREADY_SETTLED" to "تمت تصفية أمر التحميل هذا وإغلاقه مسبقًا.",
        "VAN_ZATCA_SELLER_IDENTITY_REQUIRED" to "بيانات البائع الضريبية (الرقم الضريبي/العنوان الوطني) غير مكتملة في إعدادات المنشأة.",
        "SURPLUS_ACKNOWLEDGEMENT_REQUIRED" to "الجرد الفعلي يزيد عن المتوقّع — يتطلّب إقرار الفائض من المحاسب.",
        "USAGE_LIMIT_REACHED" to "تجاوزت المنشأة الحد الأقصى المسموح به في باقة الاشتراك الحالية — أبلغ الإدارة لتقديم طلب لإدارة المنصة للاعتماد.",
        "RATE_LIMITED" to "طلبات كثيرة متتالية — انتظر ثواني ثم أعد المحاولة.",
    )

    private fun hasArabic(text: String): Boolean =
        text.any { it.code in 0x0600..0x06FF || it.code in 0x0750..0x077F }

    fun translate(problem: ProblemDto, httpStatus: Int): String {
        val detail = problem.detail?.trim().orEmpty()
        val code = problem.code?.trim().orEmpty()

        // إن كانت رسالة الخادم بالعربية (وهي القاعدة في van-sales)، تُعرض حرفيًّا مع أخطاء الحقول إن وُجدت.
        if (httpStatus < 500 && detail.isNotEmpty() && hasArabic(detail)) {
            return appendFieldErrors(detail, problem.errors)
        }

        // وإلا نُعرّب رمز الخطأ إن عُرف.
        byCode[code]?.let { mapped ->
            return appendFieldErrors(mapped, problem.errors)
        }

        if (httpStatus < 500 && detail.isNotEmpty()) {
            if (detail.startsWith("permission ") && detail.endsWith(" required")) {
                val perm = detail.removePrefix("permission ").removeSuffix(" required").trim()
                return "ينقصك إذنُ الصلاحية ($perm) لتنفيذ هذا الإجراء."
            }
            return appendFieldErrors(detail, problem.errors)
        }

        return when (httpStatus) {
            400, 422 -> appendFieldErrors("البيانات المدخلة غير صالحة — تحقّق من الحقول المطلوبة.", problem.errors)
            401 -> "انتهت الجلسة — سجّل الدخول من جديد."
            403 -> "ليست لديك الصلاحية لتنفيذ هذا الإجراء."
            404 -> "السجل المطلوب غير موجود."
            409 -> "تعارض مع حالة السجل الحالية — حدّث البيانات وأعد المحاولة."
            429 -> "طلبات كثيرة متتالية — انتظر قليلًا ثم أعد المحاولة."
            in 500..599 -> "خطأ في الخادم ($httpStatus) — لم يُرفض طلبك، أعد المحاولة بعد قليل."
            else -> problem.title?.takeIf { it.isNotBlank() && hasArabic(it) }
                ?: "تعذّر إكمال الطلب ($httpStatus)"
        }
    }

    private fun appendFieldErrors(base: String, errors: List<FieldErrorDto>?): String {
        val list = errors.orEmpty().mapNotNull { err ->
            val msg = err.message?.trim().orEmpty()
            if (msg.isEmpty()) null
            else if (!err.field.isNullOrBlank()) "${err.field}: $msg" else msg
        }
        return if (list.isEmpty()) base else "$base (${list.joinToString(" · ")})"
    }
}
