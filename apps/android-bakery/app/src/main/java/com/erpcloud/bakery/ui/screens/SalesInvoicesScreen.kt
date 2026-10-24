package com.erpcloud.bakery.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.data.ActionResult
import com.erpcloud.bakery.data.api.SalesInvoiceDetailDto
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.ActionButton
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.ConfirmReasonDialog
import com.erpcloud.bakery.ui.components.DocumentDetailDialog
import com.erpcloud.bakery.ui.components.DocumentLines
import com.erpcloud.bakery.ui.components.EmptyState
import com.erpcloud.bakery.ui.components.InlineAction
import com.erpcloud.bakery.ui.components.KeyValue
import com.erpcloud.bakery.ui.components.MissingPermissionHint
import com.erpcloud.bakery.ui.components.PickerDialog
import com.erpcloud.bakery.ui.components.PickerItem
import com.erpcloud.bakery.ui.components.PullRefreshBox
import com.erpcloud.bakery.ui.components.SearchField
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.components.StatusChip
import com.erpcloud.bakery.ui.theme.BakeryColors
import com.erpcloud.bakery.util.Dec
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * شاشةُ **فواتير المبيعات والمردودات** — البيعُ المكتبيّ غيرِ نقطةِ البيع:
 * فاتورةٌ بعميلٍ محدَّدٍ (أو عميلٍ نقديٍّ بالاسم)، تُنشأُ مسودّةً ثمّ تُرحَّل
 * (آجلةً على ذمّةِ العميل أو نقديّةً على حسابِ صندوقٍ/بنك)، ومن كلّ فاتورةٍ
 * مرحّلةٍ يُنشأُ **مردودُ مبيعات** بسطوره.
 *
 * المسارات (موثّقةٌ حرفيًّا في `apps/api/test/android-replay.spec.ts`):
 * - `GET /sales/invoices` (sales.view)
 * - `POST /sales/invoices` (sales.invoice.create) — مسودّة
 * - `POST /sales/invoices/{id}/post` (sales.invoice.post) — settlement: credit آجل،
 *   أو cash/bank مع settlementAccountId (حسابٌ للصندوق لا خزينة)
 * - `POST /sales/invoices/{id}/return` (sales.return.create) — المصدرُ مرحّلٌ إلزامًا
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SalesInvoicesScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var showCreate by remember { mutableStateOf(false) }
    var returnTarget by remember { mutableStateOf<String?>(null) }
    var postTarget by remember { mutableStateOf<String?>(null) }
    var detailTarget by remember { mutableStateOf<String?>(null) }
    var editTarget by remember { mutableStateOf<String?>(null) }
    var voidTarget by remember { mutableStateOf<String?>(null) }
    var query by remember { mutableStateOf("") }

    LaunchedEffect(Unit) { vm.loadSalesInvoices() }

    Scaffold(
        topBar = {
            TopAppBar(
                // شريطٌ فاتحٌ يمتزجُ بخلفيّةِ الشاشة (كما في الموك-أب) وعنوانٌ عريضٌ جدًّا.
                title = { Text("فواتير المبيعات والمردودات", fontWeight = FontWeight.ExtraBold) },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
        floatingActionButton = {
            if (!showCreate && editTarget == null && returnTarget == null && state.can("sales.invoice.create")) {
                // FAB كهرمانيٌّ أساسيٌّ بأيقونةٍ بيضاء، أسفلُ اليسار في RTL.
                FloatingActionButton(
                    onClick = { showCreate = true },
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = Color.White,
                    shape = RoundedCornerShape(18.dp),
                ) {
                    Icon(Icons.Default.Add, contentDescription = "فاتورة جديدة")
                }
            }
        },
    ) { padding ->
        // لا يُخفى الزرُّ بصمتًا: إن غاب الإذنُ يُشرَح السببُ بالعربية
        if (!state.can("sales.invoice.create")) {
            MissingPermissionHint("إنشاء فاتورة مبيعات", "sales.invoice.create", Modifier.padding(padding))
        }
        if (showCreate) {
            SalesInvoiceForm(vm, onDone = { showCreate = false })
            return@Scaffold
        }
        // تعديلُ المسودّة (المرحلة 2): تُحمَّل تفاصيلُها أولًا ثمّ يُفتح النموذجُ مُعبَّئًا.
        if (editTarget != null) {
            val editId = editTarget ?: ""
            val editDetail = state.staff.salesInvoiceDetail?.takeIf { it.id == editId }
            if (editDetail == null) {
                if (state.staff.detailError != null) {
                    SectionCard(
                        title = "تعديلُ الفاتورة",
                        modifier = Modifier.fillMaxSize().padding(padding).padding(14.dp),
                    ) {
                        StatusChip(state.staff.detailError ?: "", ChipTone.DANGER)
                        Spacer(Modifier.height(8.dp))
                        TextButton(onClick = { editTarget = null; vm.clearDocumentDetail() }) { Text("رجوع") }
                    }
                } else {
                    CenterLoading("جارٍ تحميل الفاتورة للتعديل…", Modifier.padding(padding))
                }
            } else {
                SalesInvoiceForm(
                    vm = vm,
                    edit = editDetail,
                    onDone = { editTarget = null; vm.clearDocumentDetail() },
                )
            }
            return@Scaffold
        }
        // مردودٌ من فاتورةٍ مرحّلة (إصلاح B14): تُحمَّل سطورُ المصدر أولًا ثمّ يُعبَّأ النموذجُ منها.
        if (returnTarget != null) {
            ReturnForm(
                vm = vm,
                sourceId = returnTarget ?: "",
                onDone = { returnTarget = null; vm.clearDocumentDetail(); vm.loadSalesInvoices() },
            )
            return@Scaffold
        }
        val invoices = state.staff.salesInvoices
        if (invoices.isEmpty() && state.staff.loadingKey == "sales-invoices") {
            CenterLoading("جارٍ تحميل فواتير المبيعات…", Modifier.padding(padding))
            return@Scaffold
        }
        if (invoices.isEmpty()) {
            EmptyState(state.staff.error ?: "لا فواتيرَ بعد.", Modifier.padding(padding))
            return@Scaffold
        }
        // السحبُ للتحديث + بحثٌ نصّيٌّ (رقم/عميل بالسجلّ أو نقديّ) — تصفيةٌ محليّة.
        PullRefreshBox(
            refreshing = state.staff.loadingKey == "sales-invoices",
            onRefresh = { vm.loadSalesInvoices() },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            Column(Modifier.fillMaxSize()) {
                SearchField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp),
                    placeholder = "ابحث برقم الفاتورة أو العميل…",
                )
                val visible = if (query.isBlank()) invoices else invoices.filter { invoice ->
                    val needle = query.trim()
                    invoice.number.contains(needle, ignoreCase = true) ||
                        (invoice.partyName ?: "").contains(needle, ignoreCase = true) ||
                        (invoice.cashCustomerName ?: "").contains(needle, ignoreCase = true)
                }
                if (visible.isEmpty()) {
                    EmptyState("لا فواتيرَ تطابقُ البحث.")
                } else {
                    LazyColumn(
                        Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(14.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(visible, key = { it.id }) { invoice ->
                            val (kindText, kindTone) = Labels.documentKind(invoice.kind)
                            val (statusText, tone) = Labels.docStatus(invoice.status)
                            // بطاقةُ فاتورةٍ كما في الموك-أب: رأسٌ (رقمٌ عريضٌ + تاريخٌ رماديّ)،
                            // شاراتُ حالةٍ ملوّنة، جسمُ مفتاح/قيمة، ثمّ أفعالٌ سلفيّة.
                            SectionCard(
                                title = "فاتورة ${invoice.number.ifBlank { "—" }}",
                                subtitle = Labels.dateOrDash(invoice.invoiceDate ?: invoice.createdAt),
                                modifier = Modifier.fillMaxWidth().clickable {
                                    detailTarget = invoice.id
                                    vm.loadSalesInvoiceDetail(invoice.id)
                                },
                            ) {
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    StatusChip(kindText, kindTone)
                                    StatusChip(statusText, tone)
                                    invoice.orderType?.let { StatusChip(if (it == "pos") "نقطة بيع" else "مكتبيّة", ChipTone.NEUTRAL) }
                                }
                                Spacer(Modifier.height(6.dp))
                                val partyLabel = invoice.partyName
                                    ?: invoice.cashCustomerName
                                    ?: state.staff.customers.firstOrNull { it.id == invoice.partyId }?.displayName
                                    ?: "—"
                                KeyValue("العميل", partyLabel)
                                invoice.total?.let { KeyValue("الإجماليّ", Dec.money(it) + " ر.س") }
                                invoice.paidTotal?.let { PaidValueRow("المدفوع", it, invoice.total) }
                                if (invoice.status == "draft" && state.can("sales.invoice.post")) {
                                    Spacer(Modifier.height(10.dp))
                                    OutlinedButton(
                                        onClick = { postTarget = invoice.id },
                                        modifier = Modifier.fillMaxWidth(),
                                        shape = RoundedCornerShape(26.dp),
                                    ) { Text("ترحيلُ الفاتورة") }
                                }
                                if (invoice.status == "posted" && invoice.kind == "sale" && state.can("sales.return.create")) {
                                    Spacer(Modifier.height(10.dp))
                                    OutlinedButton(
                                        onClick = {
                                            returnTarget = invoice.id
                                            vm.loadSalesInvoiceDetail(invoice.id)
                                        },
                                        modifier = Modifier.fillMaxWidth(),
                                        shape = RoundedCornerShape(26.dp),
                                    ) { Text("مردودُ مبيعات من هذه الفاتورة") }
                                }
                                Row(
                                    Modifier.padding(top = 8.dp),
                                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                                ) {
                                    if (invoice.status == "draft" && state.can("sales.invoice.create")) {
                                        InlineAction(
                                            label = "تعديل",
                                            onClick = {
                                                editTarget = invoice.id
                                                vm.loadSalesInvoiceDetail(invoice.id)
                                            },
                                        )
                                    }
                                    if (invoice.status != "draft" && !isVoided(invoice.status) && state.can("sales.invoice.void")) {
                                        InlineAction(
                                            label = "إبطال",
                                            onClick = { voidTarget = invoice.id },
                                            tone = ChipTone.DANGER,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // بطاقةُ التفاصيل (المرحلة 2): الترويسةُ ثمّ السطورُ والدفعات.
    if (detailTarget != null) {
        val id = detailTarget ?: ""
        val detail = state.staff.salesInvoiceDetail?.takeIf { it.id == id }
        val loading = state.staff.detailLoading == "sales-$id" ||
            (detail == null && state.staff.detailError == null)
        DocumentDetailDialog(
            title = if (detail != null) "فاتورة ${detail.number.ifBlank { "—" }}" else "تفاصيل فاتورة المبيعات",
            subtitle = if (detail != null) Labels.dateOrDash(detail.invoiceDate ?: detail.createdAt) else null,
            onDismiss = { detailTarget = null; vm.clearDocumentDetail() },
        ) {
            if (loading) {
                CenterLoading("جارٍ تحميل التفاصيل…")
            } else if (detail == null) {
                StatusChip(state.staff.detailError ?: "تعذّر تحميل التفاصيل.", ChipTone.DANGER)
            } else {
                val (kindText, kindTone) = Labels.documentKind(detail.kind)
                val (statusText, statusTone) = Labels.docStatus(detail.status)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    StatusChip(kindText, kindTone)
                    StatusChip(statusText, statusTone)
                    detail.orderType?.let { StatusChip(if (it == "pos") "نقطة بيع" else "مكتبيّة", ChipTone.NEUTRAL) }
                }
                Spacer(Modifier.height(8.dp))
                KeyValue("العميل", detail.partyName ?: detail.cashCustomerName ?: "—")
                KeyValue("الفرع", state.staff.branches.firstOrNull { it.id == detail.branchId }?.nameAr ?: "—")
                detail.partyTaxNo?.let { KeyValue("الرقمُ الضريبيّ للعميل", it) }
                detail.taxInvoiceTypeLabelAr?.let { KeyValue("نوعُ الفاتورة الضريبيّة", it) }
                KeyValue("تاريخ الفاتورة", Labels.dateOrDash(detail.invoiceDate))
                detail.subtotal?.let { KeyValue("الإجماليُّ قبل الضريبة", Dec.money(it) + " ر.س") }
                detail.taxTotal?.let { KeyValue("الضريبة", Dec.money(it) + " ر.س") }
                detail.total?.let { KeyValue("الإجماليّ", Dec.money(it) + " ر.س") }
                detail.paidTotal?.let { KeyValue("المدفوع", Dec.money(it) + " ر.س") }
                detail.notes?.let { KeyValue("ملاحظات", it) }
                Spacer(Modifier.height(10.dp))
                SectionCard(title = "السطور") {
                    if (detail.lines.isEmpty()) {
                        EmptyState("لا سطورَ في الفاتورة.")
                    } else {
                        DocumentLines(detail.lines) { itemId ->
                            state.items.firstOrNull { it.id == itemId }?.label ?: "—"
                        }
                    }
                }
                if (detail.payments.isNotEmpty()) {
                    Spacer(Modifier.height(10.dp))
                    SectionCard(title = "الدفعات") {
                        detail.payments.forEach { payment ->
                            val methodLabel = Labels.payMethod(payment.method)
                            val amount = payment.amount?.let { Dec.money(it) + " ر.س" } ?: "—"
                            val reference = payment.reference?.takeIf { it.isNotBlank() }?.let { " — $it" } ?: ""
                            KeyValue(methodLabel, amount + reference)
                        }
                    }
                }
                // 🖨️ طباعةُ A4 الاحترافيّةُ من الخادمِ — بقالبِ الويبِ الرسميِّ وQR الزكاة.
                Spacer(Modifier.height(10.dp))
                val printScope = rememberCoroutineScope()
                val printContext = LocalContext.current
                OutlinedButton(
                    onClick = {
                        printScope.launch {
                            try {
                                val html = vm.salesInvoicePrintHtml(detail.id)
                                com.erpcloud.bakery.printing.HtmlPrint.printViaSystem(
                                    printContext, html, "فاتورة ${detail.number}",
                                )
                            } catch (error: Exception) {
                                vm.showPrintError(error.message ?: "تعذّرت طباعةُ الفاتورة")
                            }
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("🖨 طباعة A4 — بالترويسةِ وQR الزكاة") }
            }
        }
    }

    postTarget?.let { id ->
        PostInvoiceDialog(
            vm = vm,
            onDismiss = { postTarget = null },
            onPost = { settlement, accountId ->
                vm.postSalesInvoice(id, buildJsonObject {
                    put("settlement", settlement)
                    if (accountId != null) put("settlementAccountId", accountId)
                }) { result ->
                    if (result is ActionResult.Synced) vm.loadSalesInvoices()
                }
                postTarget = null
            },
        )
    }

    // إبطالُ فاتورة (المرحلة 2): سببٌ إلزاميٌّ يُرسَل كما كتبه المستخدم.
    if (voidTarget != null) {
        val id = voidTarget ?: ""
        ConfirmReasonDialog(
            title = "إبطالُ فاتورة المبيعات",
            message = "الإبطالُ نهائيٌّ — لا تُعدَّل الفاتورةُ ولا تُرحَّل بعد إبطالها. دوّن السبب:",
            onDismiss = { voidTarget = null },
            onConfirm = { reason ->
                voidTarget = null
                vm.voidSalesInvoice(id, buildJsonObject { put("reason", reason) }) { result ->
                    if (result is ActionResult.Synced) vm.loadSalesInvoices()
                }
            },
            confirmLabel = "إبطال",
            reasonLabel = "سببُ الإبطال",
        )
    }
}

/** هل المستندُ ملغى؟ (void/voided/cancelled كما قد تُرجعها الخدمة). */
private fun isVoided(status: String): Boolean =
    status == "void" || status == "voided" || status == "cancelled"

/**
 * سطرُ مفتاح/قيمةٍ بقيمةٍ ملوّنة — بُنيةُ «KeyValue» المشتركةِ نفسُها لكن بلونِ قيمةٍ
 * من لوحة الحالات (كما يلوّنُ الموك-أبُ المبالغَ المهمّة).
 */
@Composable
private fun KeyValueColored(label: String, value: String, valueColor: Color) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Bold,
            color = valueColor,
            textAlign = TextAlign.End,
        )
    }
}

/**
 * «المدفوع» بلونِ حالته — أخضرُ تمامِ السدادِ وكهرمانُ السدادِ الجزئيّ (وبلا لونٍ
 * إن كان صفرًا)، كما في بطاقات الموك-أب. الأرقامُ نصوصٌ من الخادم تُقارَن بلا تحويل.
 */
@Composable
private fun PaidValueRow(label: String, paid: String, total: String?) {
    val paidValue = Dec.orZero(paid)
    val totalValue = Dec.orZero(total ?: "0")
    val color = when {
        paidValue.signum() <= 0 -> null
        totalValue.signum() <= 0 -> BakeryColors.Ok
        paidValue >= totalValue -> BakeryColors.Ok
        else -> BakeryColors.Warn
    }
    if (color == null) {
        KeyValue(label, Dec.money(paid) + " ر.س")
    } else {
        KeyValueColored(label, Dec.money(paid) + " ر.س", color)
    }
}

/**
 * حوارُ الترحيل — أربعُ تسوياتٍ كما يقبلُها الخادمُ (`'credit' | 'cash' | 'card' | 'bank'`):
 * **آجل** على ذمّة العميل، أو **نقديّ/شبكة/تحويلٌ بنكيّ** على حسابِ صندوقٍ أو بنكٍ
 * قابلٍ للترحيل. طريقةُ «شبكة» هي ما يُحرّكُ بطاقةَ «شبكةُ اليوم» في اللوحةِ الرئيسيّة
 * (دفعةُ `method=card` تدخلُ بطاقةَ `s_network` في تقريرِ الخادمِ الرسميّ).
 */
@Composable
private fun PostInvoiceDialog(
    vm: AppViewModel,
    onDismiss: () -> Unit,
    onPost: (settlement: String, accountId: String?) -> Unit,
) {
    val state by vm.uiState.collectAsState()
    // الطريقةُ التي يُنتظرُ لها اختيارُ حساب: "cash" | "card" | "bank" (آجلٌ بلا حساب).
    var pickAccountFor by remember { mutableStateOf<String?>(null) }

    // حساباتُ التسوية تُحمَّل عند فتحِ الحوار (شاشةُ الفواتير لا تجلبها معها —
    // وإلا ظهرَ منتقيُ الحسابِ فارغًا فتعذّرَ ترحيلُ تسويةٍ فوريّة).
    LaunchedEffect(Unit) {
        if (state.staff.accounts.isEmpty()) vm.loadAccounts()
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("ترحيلُ فاتورة المبيعات") },
        text = {
            Column {
                Text("الترحيلُ يحرّكُ المخزونَ والذمّة. اختر طريقةَ التسوية:")
                Spacer(Modifier.height(10.dp))
                ActionButton(
                    label = "آجل — على ذمّة العميل",
                    onClick = { onPost("credit", null) },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                ActionButton(
                    label = "نقديّ — على حساب الصندوق",
                    onClick = { pickAccountFor = "cash" },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                ActionButton(
                    label = "شبكة (بطاقة) — على حساب البنك",
                    onClick = { pickAccountFor = "card" },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                ActionButton(
                    label = "تحويل بنكي — على حساب البنك",
                    onClick = { pickAccountFor = "bank" },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
    pickAccountFor?.let { method ->
        PickerDialog(
            title = if (method == "cash") "حسابُ الصندوق" else "حسابُ البنك",
            items = state.staff.accounts
                .filter { it.isPostable != false }
                .map { PickerItem(it.id, "${it.code} — ${it.nameAr ?: it.nameEn ?: ""}") },
            onDismiss = { pickAccountFor = null },
            onSelect = { picked ->
                pickAccountFor = null
                onPost(method, picked.id)
            },
        )
    }
}

/** سطرٌ في نموذجِ فاتورة/مردود. */
private data class SaleLine(
    val itemId: String = "",
    val itemLabel: String = "",
    val qty: String = "",
    val price: String = "",
)

/**
 * نموذجُ إنشاء/تعديلِ فاتورة مبيعات (مسودّة) — عميلٌ من السجلّ أو عميلٌ نقديٌّ بالاسم،
 * والسطورُ صنفٌ وكميّةٌ وسعر. الجسمُ مطابقٌ لِما قبِلَه الخادمُ حرفيًّا
 * (orderType: counter + lines[{itemId, quantity, unitPrice}]).
 * وفي التعديل (المرحلة 2) تُعبَّأ الحقولُ من تفاصيل المسودّة ثمّ PATCH.
 */
@Composable
private fun SalesInvoiceForm(vm: AppViewModel, onDone: () -> Unit, edit: SalesInvoiceDetailDto? = null) {
    val state by vm.uiState.collectAsState()
    var branchId by remember { mutableStateOf(edit?.branchId ?: "") }
    var branchLabel by remember {
        mutableStateOf(edit?.branchId?.let { bid -> state.staff.branches.firstOrNull { it.id == bid }?.nameAr } ?: "")
    }
    var warehouseId by remember { mutableStateOf(edit?.warehouseId ?: "") }
    var warehouseLabel by remember {
        mutableStateOf(edit?.warehouseId?.let { wid -> state.warehouses.firstOrNull { it.id == wid }?.label } ?: "")
    }
    var partyId by remember { mutableStateOf(edit?.partyId ?: "") }
    var partyLabel by remember { mutableStateOf(edit?.partyName ?: "") }
    var cashName by remember { mutableStateOf(edit?.cashCustomerName ?: "") }
    var pickBranch by remember { mutableStateOf(false) }
    var pickWarehouse by remember { mutableStateOf(false) }
    var pickParty by remember { mutableStateOf(false) }
    var pickLineAt by remember { mutableStateOf(-1) }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }
    // نمطُ السعر: شاملُ الضريبةِ أم قبلَها — كما في محرّر فواتير الويب
    // (وفي التعديل يُقرأ من المسودّة المحفوظة نفسها).
    var priceIncludesVat by remember { mutableStateOf(edit?.priceIncludesVat ?: false) }
    val lines = remember {
        val initial = edit?.lines?.map { line ->
            SaleLine(
                itemId = line.itemId,
                itemLabel = state.items.firstOrNull { it.id == line.itemId }?.label ?: "",
                qty = line.quantity,
                price = line.unitPrice ?: "",
            )
        }.orEmpty()
        mutableStateListOf<SaleLine>().apply {
            if (initial.isEmpty()) add(SaleLine()) else addAll(initial)
        }
    }

    LaunchedEffect(state.staff.branches) {
        if (branchId.isBlank()) {
            (state.staff.branches.firstOrNull { it.isDefault } ?: state.staff.branches.firstOrNull())
                ?.let { branchId = it.id; branchLabel = it.nameAr }
        } else if (branchLabel.isBlank()) {
            state.staff.branches.firstOrNull { it.id == branchId }?.let { branchLabel = it.nameAr }
        }
    }
    LaunchedEffect(state.warehouses, state.dashboard?.mainWarehouseId) {
        if (warehouseId.isBlank()) {
            (state.warehouses.firstOrNull { it.id == state.dashboard?.mainWarehouseId }
                ?: state.warehouses.firstOrNull { it.isDefault == true })
                ?.let { warehouseId = it.id; warehouseLabel = it.label }
        } else if (warehouseLabel.isBlank()) {
            state.warehouses.firstOrNull { it.id == warehouseId }?.let { warehouseLabel = it.label }
        }
    }
    // اسمُ العميل المسجَّل يُستكمَل عند وصول قائمة العملاء (لو فُتح التعديل قبلها).
    LaunchedEffect(state.staff.customers) {
        if (partyId.isNotBlank() && partyLabel.isBlank()) {
            state.staff.customers.firstOrNull { it.id == partyId }?.let { partyLabel = it.displayName }
        }
    }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            SectionCard(
                title = if (edit != null) "تعديلُ فاتورةِ ${edit.number.ifBlank { "—" }}" else "فاتورةُ مبيعاتٍ جديدة",
                subtitle = if (edit != null) {
                    "تعديلُ المسودّة قبل الترحيل"
                } else {
                    "تُنشأُ مسودّةً ثمّ تُرحَّل — العميلُ من السجلّ أو نقديٌّ بالاسم"
                },
            ) {
                OutlinedTextField(
                    value = branchLabel,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("الفرع *") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { IconButton(onClick = { pickBranch = true }) { Text("اختر") } },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = warehouseLabel,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("مستودعُ الصرف *") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { IconButton(onClick = { pickWarehouse = true }) { Text("اختر") } },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = partyLabel,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("العميل (من السجلّ)") },
                    placeholder = { Text("عميلٌ نقديٌّ إن تُرك فارغًا") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { IconButton(onClick = { pickParty = true }) { Text("اختر") } },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = cashName,
                    onValueChange = { cashName = it },
                    label = { Text("اسمُ العميل النقديّ (بلا سجلٍّ)") },
                    placeholder = { Text("عميل عام") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("الأسعارُ شاملةُ الضريبة", style = MaterialTheme.typography.bodyMedium)
                        Text(
                            if (priceIncludesVat) "الضريبةُ داخلُ أسعارِ السطور"
                            else "الضريبةُ تُضافُ فوقَ أسعارِ السطور",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    androidx.compose.material3.Switch(
                        checked = priceIncludesVat,
                        onCheckedChange = { priceIncludesVat = it },
                    )
                }
            }
        }
        item {
            SectionCard(title = "سطورُ الفاتورة", subtitle = "الصنفُ والكميّةُ وسعرُ الوحدة — كميّةٌ موجبةٌ فقط") {
                lines.forEachIndexed { index, line ->
                    Column(Modifier.padding(vertical = 4.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                            OutlinedTextField(
                                value = line.itemLabel,
                                onValueChange = {},
                                readOnly = true,
                                label = { Text("الصنف ${index + 1} *") },
                                modifier = Modifier.weight(1.4f),
                                trailingIcon = { IconButton(onClick = { pickLineAt = index }) { Text("اختر") } },
                            )
                            IconButton(onClick = { lines.removeAt(index) }, enabled = lines.size > 1) { Text("✕") }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(
                                value = line.qty,
                                onValueChange = { if (Dec.isValidInput(it)) lines[index] = line.copy(qty = it) },
                                label = { Text("الكميّة *") },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                modifier = Modifier.weight(1f),
                            )
                            OutlinedTextField(
                                value = line.price,
                                onValueChange = { if (Dec.isValidInput(it)) lines[index] = line.copy(price = it) },
                                label = { Text("سعرُ الوحدة (ر.س) *") },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }
                }
                OutlinedButton(onClick = { lines.add(SaleLine()) }, modifier = Modifier.fillMaxWidth()) { Text("+ أضف سطرًا") }
                Spacer(Modifier.height(6.dp))
                val valid = lines.filter { it.itemId.isNotBlank() && Dec.isPositive(it.qty) && Dec.isPositive(it.price) }
                if (valid.isNotEmpty()) {
                    var total = java.math.BigDecimal.ZERO
                    valid.forEach { line -> total = total.add(Dec.orZero(line.qty).multiply(Dec.orZero(line.price))) }
                    KeyValue("إجماليُّ السطور (قبل الضريبة)", Dec.money(total.toPlainString()) + " ر.س")
                }
                if (error != null) {
                    Spacer(Modifier.height(8.dp))
                    StatusChip(error ?: "", ChipTone.DANGER)
                }
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ActionButton(
                        label = when {
                            sending -> "جارٍ الحفظ…"
                            edit != null -> "حفظُ التعديلات"
                            else -> "حفظُ المسودّة"
                        },
                        onClick = {
                            val validLines = lines.filter { it.itemId.isNotBlank() }
                            error = when {
                                branchId.isBlank() -> "اختر الفرع."
                                warehouseId.isBlank() -> "اختر مستودع الصرف."
                                partyId.isBlank() && cashName.isBlank() && validLines.isNotEmpty() -> "اختر عميلًا من السجلّ أو اكتب اسم العميل النقديّ."
                                validLines.isEmpty() -> "أضف سطرًا واحدًا على الأقلّ (صنفٌ وكميّةٌ وسعر)."
                                validLines.any { !Dec.isPositive(it.qty) } -> "كميّةُ كلّ سطرٍ يجب أن تكون رقمًا موجبًا."
                                validLines.any { !Dec.isPositive(it.price) } -> "سعرُ الوحدة لكلّ سطرٍ يجب أن يكون موجبًا."
                                lines.any { it.itemId.isNotBlank() && (Dec.parse(it.qty) == null || Dec.parse(it.price) == null) } ->
                                    "أكمل الكميّةَ والسعرَ لكلّ صنفٍ مُختار."
                                else -> null
                            }
                            if (error != null) return@ActionButton
                            sending = true
                            val body = buildJsonObject {
                                put("branchId", branchId)
                                put("warehouseId", warehouseId)
                                put("orderType", "counter")
                                put("priceIncludesVat", priceIncludesVat)
                                if (partyId.isNotBlank()) put("partyId", partyId)
                                else put("cashCustomerName", cashName.trim().ifBlank { "عميل عام" })
                                put(
                                    "lines",
                                    kotlinx.serialization.json.buildJsonArray {
                                        validLines.forEach { line ->
                                            add(
                                                buildJsonObject {
                                                    put("itemId", line.itemId)
                                                    put("quantity", Dec.wire(line.qty))
                                                    put("unitPrice", Dec.wire(line.price))
                                                    // كما في محرّر الويب: نسبةٌ افتراضيّةٌ ١٥٪
                                                    // حتى لا تُرحَّلَ فاتورةٌ بضريبةِ صفر.
                                                    put("taxRate", "15")
                                                },
                                            )
                                        }
                                    },
                                )
                            }
                            if (edit != null) {
                                vm.updateSalesInvoice(edit.id, body) { result ->
                                    sending = false
                                    if (result is ActionResult.Synced) {
                                        vm.loadSalesInvoices()
                                        onDone()
                                    }
                                }
                            } else {
                                vm.createSalesInvoice(body) { result ->
                                    sending = false
                                    if (result is ActionResult.Synced) {
                                        vm.loadSalesInvoices()
                                        onDone()
                                    }
                                }
                            }
                        },
                        enabled = !sending,
                        loading = sending,
                        modifier = Modifier.weight(1f),
                    )
                    ActionButton(label = "رجوع", onClick = onDone, enabled = !sending, modifier = Modifier.weight(1f))
                }
            }
        }
    }

    if (pickBranch) {
        PickerDialog(
            title = "اختر الفرع",
            items = state.staff.branches.map { PickerItem(it.id, it.nameAr, trailing = if (it.isDefault) "افتراضيّ" else null) },
            onDismiss = { pickBranch = false },
            onSelect = { branchId = it.id; branchLabel = it.title },
        )
    }
    if (pickWarehouse) {
        PickerDialog(
            title = "اختر المستودع",
            items = state.warehouses.map { PickerItem(it.id, it.label, trailing = if (it.isDefault == true) "افتراضيّ" else null) },
            onDismiss = { pickWarehouse = false },
            onSelect = { warehouseId = it.id; warehouseLabel = it.title },
        )
    }
    if (pickParty) {
        PickerDialog(
            title = "اختر العميل",
            items = state.staff.customers.map { PickerItem(it.id, it.displayName) },
            onDismiss = { pickParty = false },
            onSelect = { partyId = it.id; partyLabel = it.title },
        )
    }
    if (pickLineAt >= 0) {
        val at = pickLineAt
        PickerDialog(
            title = "صنفُ السطر ${at + 1}",
            items = state.items.map { PickerItem(it.id, it.label) },
            onDismiss = { pickLineAt = -1 },
            onSelect = { item ->
                lines[at] = lines[at].copy(itemId = item.id, itemLabel = item.title)
                pickLineAt = -1
            },
        )
    }
}

/** سطرُ مردودٍ — من سطر الفاتورة المصدر: الصنفُ والسعرُ ثابتان والكميّةُ المرجعةُ قابلةٌ للتعديل. */
private data class ReturnLine(
    val itemId: String = "",
    val itemLabel: String = "",
    val sourceQty: String = "0",
    val qty: String = "0",
    val price: String = "",
)

/**
 * نموذجُ **مردود المبيعات** من فاتورةٍ مرحّلة (إصلاح B14): تُحمَّل سطورُ المصدر
 * فتُعرضَ كما بيعت — الصنفُ وسعرُ الوحدة للقراءة فقط، والكميّةُ المرجعةُ من صفرٍ
 * إلى المباعة فعلًا، ولا يُرسَل إلا ما كانت كميّتُه أكبر من صفر. المصدرُ إلزامًا
 * مرحّل، والخادمُ يفحصُ الكميّاتِ ويقولُها بالعربيّةِ إن خالفت.
 */
@Composable
private fun ReturnForm(vm: AppViewModel, sourceId: String, onDone: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }
    val source = state.staff.salesInvoices.firstOrNull { it.id == sourceId }
    val detail = state.staff.salesInvoiceDetail?.takeIf { it.id == sourceId }

    if (detail == null) {
        if (state.staff.detailError != null) {
            SectionCard(
                title = "مردودُ مبيعات",
                subtitle = "من الفاتورة ${source?.number ?: ""}",
                modifier = Modifier.padding(14.dp),
            ) {
                StatusChip(state.staff.detailError ?: "", ChipTone.DANGER)
                Spacer(Modifier.height(8.dp))
                TextButton(onClick = onDone) { Text("رجوع") }
            }
        } else {
            CenterLoading("جارٍ تحميل سطور الفاتورة المصدر…", Modifier.padding(14.dp))
        }
        return
    }

    val lines = remember(detail) {
        val initial = detail.lines.map { line ->
            ReturnLine(
                itemId = line.itemId,
                itemLabel = state.items.firstOrNull { it.id == line.itemId }?.label ?: line.description ?: line.itemId,
                sourceQty = line.quantity,
                qty = "0",
                price = line.unitPrice ?: "",
            )
        }
        mutableStateListOf<ReturnLine>().apply { addAll(initial) }
    }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            SectionCard(
                title = "مردودُ مبيعات",
                subtitle = "من الفاتورة ${detail.number.ifBlank { source?.number ?: "—" }}",
            ) {
                KeyValue("العميل", detail.partyName ?: detail.cashCustomerName ?: "—")
                KeyValue("تاريخ الفاتورة", Labels.dateOrDash(detail.invoiceDate))
                detail.total?.let { KeyValue("إجمالي الفاتورة", Dec.money(it) + " ر.س") }
                Spacer(Modifier.height(6.dp))
                Text(
                    "حدّد الكميّةَ المرجعةَ من كلّ سطر — الصنفُ والسعرُ من الفاتورةِ المصدرِ ولا يُعدَّلان.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        item {
            SectionCard(title = "سطورُ المرجع", subtitle = "كميّةٌ من صفرٍ إلى المباعةِ فعلًا") {
                lines.forEachIndexed { index, line ->
                    Column(Modifier.padding(vertical = 4.dp)) {
                        OutlinedTextField(
                            value = line.itemLabel,
                            onValueChange = {},
                            readOnly = true,
                            label = { Text("الصنف ${index + 1}") },
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Spacer(Modifier.height(4.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(
                                value = line.qty,
                                onValueChange = { if (Dec.isValidInput(it)) lines[index] = line.copy(qty = it) },
                                label = { Text("المرجع (حتى ${Dec.fmt(line.sourceQty)})") },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                modifier = Modifier.weight(1f),
                            )
                            OutlinedTextField(
                                value = line.price,
                                onValueChange = {},
                                readOnly = true,
                                label = { Text("سعرُ الوحدة (ر.س)") },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                modifier = Modifier.weight(1f),
                            )
                        }
                        KeyValue("المباع فعلًا", "${Dec.fmt(line.sourceQty)} × ${Dec.money(line.price)}")
                    }
                }
                if (lines.isEmpty()) {
                    EmptyState("لا سطورَ في الفاتورة المصدر.")
                }
                val returned = lines.filter { Dec.isPositive(it.qty) }
                if (returned.isNotEmpty()) {
                    var total = java.math.BigDecimal.ZERO
                    returned.forEach { line ->
                        total = total.add(Dec.orZero(line.qty).multiply(Dec.orZero(line.price)))
                    }
                    KeyValue("إجماليُّ المرجع (قبل الضريبة)", Dec.money(total.toPlainString()) + " ر.س")
                }
                if (error != null) {
                    Spacer(Modifier.height(8.dp))
                    StatusChip(error ?: "", ChipTone.DANGER)
                }
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ActionButton(
                        label = if (sending) "جارٍ الحفظ…" else "حفظُ المردود",
                        onClick = {
                            val returned = lines.filter { Dec.isPositive(it.qty) }
                            error = when {
                                lines.isEmpty() -> "لا سطورَ في الفاتورة المصدر."
                                returned.isEmpty() -> "حدّد كميّةً مرجعةً أكبر من صفرٍ لسطرٍ واحدٍ على الأقلّ."
                                lines.any { !Dec.isNonNegative(it.qty) } -> "الكميّةُ المرجعةُ لا تكون سالبة."
                                lines.any { Dec.orZero(it.qty) > Dec.orZero(it.sourceQty) } ->
                                    "لا تتجاوزُ الكميّةُ المرجعةُ الكميّةَ المباعةَ من الصنف."
                                else -> null
                            }
                            if (error != null) return@ActionButton
                            sending = true
                            val body = buildJsonObject {
                                put("branchId", detail.branchId ?: state.staff.branches.firstOrNull()?.id ?: "")
                                detail.warehouseId?.let { put("warehouseId", it) }
                                val sourceParty = detail.partyId
                                if (!sourceParty.isNullOrBlank()) put("partyId", sourceParty)
                                else put("cashCustomerName", detail.cashCustomerName ?: "عميل عام")
                                put(
                                    "lines",
                                    kotlinx.serialization.json.buildJsonArray {
                                        returned.forEach { line ->
                                            add(
                                                buildJsonObject {
                                                    put("itemId", line.itemId)
                                                    put("quantity", Dec.wire(line.qty))
                                                    put("unitPrice", Dec.wire(line.price))
                                                    // كما في محرّر الويب: نسبةٌ افتراضيّةٌ ١٥٪
                                                    // حتى لا تُرحَّلَ فاتورةٌ بضريبةِ صفر.
                                                    put("taxRate", "15")
                                                },
                                            )
                                        }
                                    },
                                )
                            }
                            vm.returnSalesInvoice(sourceId, body) { result ->
                                sending = false
                                if (result is ActionResult.Synced) onDone()
                            }
                        },
                        enabled = !sending,
                        loading = sending,
                        modifier = Modifier.weight(1f),
                    )
                    ActionButton(label = "رجوع", onClick = onDone, enabled = !sending, modifier = Modifier.weight(1f))
                }
            }
        }
    }
}
