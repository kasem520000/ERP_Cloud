package com.erpcloud.bakery.ui.screens

import androidx.activity.compose.BackHandler

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.data.ActionResult
import com.erpcloud.bakery.data.api.PurchaseInvoiceDetailDto
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.ActionButton
import com.erpcloud.bakery.ui.components.PickerTrigger
import com.erpcloud.bakery.ui.components.rememberPickerInteractionSource
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.MissingPermissionHint
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.ConfirmReasonDialog
import com.erpcloud.bakery.ui.components.DatePickerField
import com.erpcloud.bakery.ui.components.DocumentDetailDialog
import com.erpcloud.bakery.ui.components.DocumentLines
import com.erpcloud.bakery.ui.components.EmptyState
import com.erpcloud.bakery.ui.components.InlineAction
import com.erpcloud.bakery.ui.components.KeyValue
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
 * شاشةُ المشتريات — فواتيرُ الشراء من المورّدين (من تطبيق الطاقم):
 * قائمةُ الفواتير + إنشاءُ مسودّةٍ (فرع/مورّد/مستودع + سطور الصنف والكميّة والسعر)
 * + **الترحيلُ** بإذن `purchase.invoice.post` + إضافةُ مورّدٍ (`parties?kind=supplier`).
 *
 * القاعدة: الفاتورةُ تُنشأ **مسودّةً** ثمّ تُرحَّل — الترحيلُ هو ما يحرّك المخزون
 * والذمّة، والخادمُ يرفضُ الترحيلَ إن نقص ملفُّ الترحيل أو الفترة.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PurchasesScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var showCreate by remember { mutableStateOf(false) }
    var showSupplier by remember { mutableStateOf(false) }
    var supplierOpenedFromCreate by remember { mutableStateOf(false) }
    var postTarget by remember { mutableStateOf<String?>(null) }
    var detailTarget by remember { mutableStateOf<String?>(null) }
    var editTarget by remember { mutableStateOf<String?>(null) }
    var voidTarget by remember { mutableStateOf<String?>(null) }
    var query by remember { mutableStateOf("") }

    LaunchedEffect(Unit) { vm.loadPurchases() }

    val inSubView = showCreate || showSupplier || editTarget != null
    val handleSubBack = {
        when {
            showSupplier -> {
                showSupplier = false
                if (supplierOpenedFromCreate) {
                    supplierOpenedFromCreate = false
                    showCreate = true
                }
            }
            showCreate -> showCreate = false
            editTarget != null -> {
                editTarget = null
                vm.clearDocumentDetail()
            }
        }
    }
    BackHandler(enabled = inSubView) { handleSubBack() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        when {
                            showSupplier -> "إضافة مورّد جديد"
                            showCreate -> "إنشاء فاتورة مشتريات"
                            editTarget != null -> "تعديل فاتورة مشتريات"
                            else -> "المشتريات"
                        },
                        fontWeight = FontWeight.ExtraBold,
                    )
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
                navigationIcon = {
                    IconButton(onClick = { if (inSubView) handleSubBack() else onBack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع")
                    }
                },
            )
        },
        floatingActionButton = {
            if (!showCreate && !showSupplier && editTarget == null && state.can("purchase.invoice.create")) {
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
        if (showCreate) {
            androidx.compose.foundation.layout.Box(Modifier.fillMaxSize().padding(padding)) {
                PurchaseInvoiceForm(
                    vm = vm,
                    onDone = { showCreate = false },
                    onAddSupplier = {
                        supplierOpenedFromCreate = true
                        showCreate = false
                        showSupplier = true
                    },
                )
            }
            return@Scaffold
        }
        if (showSupplier) {
            androidx.compose.foundation.layout.Box(Modifier.fillMaxSize().padding(padding)) {
                SupplierForm(
                    vm,
                    onDone = {
                        showSupplier = false
                        vm.loadPurchases()
                        if (supplierOpenedFromCreate) {
                            supplierOpenedFromCreate = false
                            showCreate = true
                        }
                    },
                )
            }
            return@Scaffold
        }
        if (editTarget != null) {
            val editId = editTarget ?: ""
            val editDetail = state.staff.purchaseInvoiceDetail?.takeIf { it.id == editId }
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
                androidx.compose.foundation.layout.Box(Modifier.fillMaxSize().padding(padding)) {
                    PurchaseInvoiceForm(
                        vm = vm,
                        edit = editDetail,
                        onDone = { editTarget = null; vm.clearDocumentDetail() },
                        onAddSupplier = { editTarget = null; vm.clearDocumentDetail(); showSupplier = true },
                    )
                }
            }
            return@Scaffold
        }
        val invoices = state.staff.purchaseInvoices
        if (invoices.isEmpty() && state.staff.loadingKey == "purchases") {
            CenterLoading("جارٍ تحميل فواتير المشتريات…", Modifier.padding(padding))
            return@Scaffold
        }
        PullRefreshBox(
            refreshing = state.staff.loadingKey == "purchases",
            onRefresh = { vm.loadPurchases() },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            Column(Modifier.fillMaxSize()) {
                if (!state.can("purchase.invoice.create")) {
                    MissingPermissionHint(
                        "إنشاء فاتورة",
                        "purchase.invoice.create",
                        Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                    )
                }
                if (invoices.isEmpty()) {
                    EmptyState(state.staff.error ?: "لا فواتيرَ مشترياتٍ بعد.")
                    return@Column
                }
                SearchField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp),
                    placeholder = "ابحث برقم الفاتورة أو المورّد أو المرجع…",
                )
                val visible = if (query.isBlank()) invoices else invoices.filter { invoice ->
                    val needle = query.trim()
                    invoice.number.contains(needle, ignoreCase = true) ||
                        (invoice.partyName ?: "").contains(needle, ignoreCase = true) ||
                        (invoice.supplierReferenceNo ?: "").contains(needle, ignoreCase = true)
                }
                if (visible.isEmpty()) {
                    EmptyState("لا فواتيرَ تطابقُ البحث.")
                } else {
                    LazyColumn(
                        Modifier.fillMaxSize(),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(visible, key = { it.id }) { invoice ->
                            val (statusText, tone) = Labels.docStatus(invoice.status)
                            // بطاقةُ فاتورةٍ كما في الموك-أب: رأسٌ (رقمٌ عريضٌ + تاريخٌ رماديّ)،
                            // شاراتُ حالةٍ ملوّنة، جسمُ مفتاح/قيمة، ثمّ أفعالٌ سلفيّة.
                            // الملغاةُ تُخفَتُ قليلًا (opacity .92) وبلا أفعال.
                            SectionCard(
                                title = "فاتورة ${invoice.number.ifBlank { "—" }}",
                                subtitle = Labels.dateOrDash(invoice.invoiceDate ?: invoice.createdAt),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .alpha(if (isVoided(invoice.status)) 0.92f else 1f)
                                    .clickable {
                                        detailTarget = invoice.id
                                        vm.loadPurchaseInvoiceDetail(invoice.id)
                                    },
                            ) {
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    StatusChip(Labels.purchaseKind(invoice.kind), ChipTone.NEUTRAL)
                                    StatusChip(statusText, tone)
                                }
                                Spacer(Modifier.height(6.dp))
                                invoice.partyName?.let { KeyValue("المورّد", it) }
                                state.staff.branches.firstOrNull { it.id == invoice.branchId }?.let { KeyValue("الفرع", it.nameAr) }
                                invoice.supplierReferenceNo?.let { KeyValue("مرجعُ المورّد", it) }
                                invoice.subtotal?.let { KeyValue("الإجماليُّ قبل الضريبة", Dec.money(it) + " ر.س") }
                                invoice.taxTotal?.let { KeyValue("الضريبة", Dec.money(it) + " ر.س") }
                                invoice.total?.let { KeyValue("الصافي", Dec.money(it) + " ر.س") }
                                invoice.paidTotal?.let { PaidValueRow("المدفوع", it, invoice.total) }
                                if (invoice.status == "draft" && state.can("purchase.invoice.post")) {
                                    Spacer(Modifier.height(10.dp))
                                    OutlinedButton(
                                        onClick = { postTarget = invoice.id },
                                        modifier = Modifier.fillMaxWidth(),
                                        shape = RoundedCornerShape(26.dp),
                                    ) { Text("ترحيلُ الفاتورة") }
                                }
                                Row(
                                    Modifier.padding(top = 8.dp),
                                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                                ) {
                                    if (invoice.status == "draft" && state.can("purchase.invoice.create")) {
                                        InlineAction(
                                            label = "تعديل",
                                            onClick = {
                                                editTarget = invoice.id
                                                vm.loadPurchaseInvoiceDetail(invoice.id)
                                            },
                                        )
                                    }
                                    if (invoice.status != "draft" && !isVoided(invoice.status) && state.can("purchase.invoice.void")) {
                                        InlineAction(
                                            label = "إبطال",
                                            onClick = { voidTarget = invoice.id },
                                            tone = ChipTone.DANGER,
                                        )
                                    }
                                }
                            }
                        }
                        item {
                            if (state.can("parties.manage")) {
                                OutlinedButton(
                                    onClick = { showSupplier = true },
                                    modifier = Modifier.fillMaxWidth(),
                                    shape = RoundedCornerShape(26.dp),
                                ) {
                                    Text("+ إضافةُ مورّدٍ جديد")
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // بطاقةُ التفاصيل (المرحلة 2): الترويسةُ ثمّ السطورُ والدفعاتُ والكلف.
    if (detailTarget != null) {
        val id = detailTarget ?: ""
        val detail = state.staff.purchaseInvoiceDetail?.takeIf { it.id == id }
        val loading = state.staff.detailLoading == "purchase-$id" ||
            (detail == null && state.staff.detailError == null)
        DocumentDetailDialog(
            title = if (detail != null) "فاتورة ${detail.number.ifBlank { "—" }}" else "تفاصيل فاتورة المشتريات",
            subtitle = if (detail != null) Labels.dateOrDash(detail.invoiceDate ?: detail.createdAt) else null,
            onDismiss = { detailTarget = null; vm.clearDocumentDetail() },
        ) {
            if (loading) {
                CenterLoading("جارٍ تحميل التفاصيل…")
            } else if (detail == null) {
                StatusChip(state.staff.detailError ?: "تعذّر تحميل التفاصيل.", ChipTone.DANGER)
            } else {
                val (statusText, tone) = Labels.docStatus(detail.status)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    StatusChip(Labels.purchaseKind(detail.kind), ChipTone.NEUTRAL)
                    StatusChip(statusText, tone)
                }
                Spacer(Modifier.height(8.dp))
                KeyValue("المورّد", detail.partyName ?: "—")
                KeyValue("الفرع", state.staff.branches.firstOrNull { it.id == detail.branchId }?.nameAr ?: "—")
                detail.supplierReferenceNo?.let { KeyValue("مرجعُ المورّد", it) }
                KeyValue("تاريخ الفاتورة", Labels.dateOrDash(detail.invoiceDate))
                detail.dueDate?.takeIf { it.isNotBlank() }?.let { KeyValue("تاريخُ الاستحقاق", it) }
                detail.supplierReferenceDate?.let { KeyValue("تاريخُ مرجع المورّد", it) }
                detail.currency?.let { KeyValue("العملة", it) }
                detail.subtotal?.let { KeyValue("الإجماليُّ قبل الضريبة", Dec.money(it) + " ر.س") }
                detail.taxTotal?.let { KeyValue("الضريبة", Dec.money(it) + " ر.س") }
                detail.total?.let { KeyValue("الصافي", Dec.money(it) + " ر.س") }
                detail.paidTotal?.let { KeyValue("المدفوع", Dec.money(it) + " ر.س") }
                detail.notes?.let { KeyValue("ملاحظات", it) }
                Spacer(Modifier.height(10.dp))
                SectionCard(title = "السطور") {
                    if (detail.lines.isEmpty()) {
                        EmptyState("لا سطورَ في الفاتورة.")
                    } else {
                        DocumentLines(detail.lines) { itemId ->
                            state.effectiveItems.firstOrNull { it.id == itemId }?.label ?: "—"
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
                if (detail.costs.isNotEmpty()) {
                    Spacer(Modifier.height(10.dp))
                    SectionCard(title = "كلفُ الرأس") {
                        detail.costs.forEach { cost ->
                            KeyValue(cost.costName ?: "كلفة", cost.amount?.let { Dec.money(it) + " ر.س" } ?: "—")
                        }
                    }
                }
                // 🖨️ طباعةُ A4 الاحترافيّةُ من الخادمِ — بقالبِ الويبِ الرسميِّ (مستندُ مشتريات).
                Spacer(Modifier.height(10.dp))
                val printScope = rememberCoroutineScope()
                val printContext = LocalContext.current
                OutlinedButton(
                    onClick = {
                        printScope.launch {
                            try {
                                val html = vm.purchaseInvoicePrintHtml(detail.id)
                                com.erpcloud.bakery.printing.HtmlPrint.printViaSystem(
                                    printContext, html, "فاتورة مشتريات ${detail.number}",
                                )
                            } catch (error: Exception) {
                                vm.showPrintError(error.message ?: "تعذّرت طباعةُ الفاتورة")
                            }
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("🖨 طباعة A4 — بقالب الويب الرسميّ") }
            }
        }
    }

    // إبطالُ فاتورة (المرحلة 2): سببٌ إلزاميٌّ يُرسَل كما كتبه المستخدم.
    if (voidTarget != null) {
        val id = voidTarget ?: ""
        ConfirmReasonDialog(
            title = "إبطالُ فاتورة المشتريات",
            message = "الإبطالُ نهائيٌّ — لا تُعدَّل الفاتورةُ ولا تُرحَّل بعد إبطالها. دوّن السبب:",
            onDismiss = { voidTarget = null },
            onConfirm = { reason ->
                voidTarget = null
                vm.voidPurchaseInvoice(id, buildJsonObject { put("reason", reason) }) { result ->
                    if (result is ActionResult.Synced) vm.loadPurchases()
                }
            },
            confirmLabel = "إبطال",
            reasonLabel = "سببُ الإبطال",
        )
    }

    if (postTarget != null) {
        val id = postTarget ?: ""
        PostPurchaseDialog(
            vm = vm,
            onDismiss = { postTarget = null },
            onPost = { settlement, accountId, cashLocationId ->
                vm.postPurchaseInvoice(id, buildJsonObject {
                    put("settlement", settlement)
                    if (!accountId.isNullOrBlank()) put("settlementAccountId", accountId)
                    if (!cashLocationId.isNullOrBlank()) put("settlementCashLocationId", cashLocationId)
                }) { result ->
                    if (result is ActionResult.Synced) vm.loadPurchases()
                }
                postTarget = null
            },
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
 * حوارُ ترحيلِ فاتورة المشتريات (إصلاح B10) — ثلاثُ تسوياتٍ كما يقبلُها الخادمُ
 * (`'credit' | 'cash' | 'bank'`): **آجل** على ذمّة المورّد، أو **نقديّ** على حسابِ
 * صندوقٍ، أو **تحويلٌ بنكيّ** على حسابِ بنك — كلُّها قابلةٌ للترحيل.
 */
@Composable
private fun PostPurchaseDialog(
    vm: AppViewModel,
    onDismiss: () -> Unit,
    onPost: (settlement: String, accountId: String?, cashLocationId: String?) -> Unit,
) {
    val state by vm.uiState.collectAsState()
    var pickAccountFor by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        vm.ensureCashLocations()
        vm.ensureAccounts()
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("ترحيلُ فاتورة المشتريات") },
        text = {
            Column {
                Text("الترحيلُ يُثبّت الفاتورةَ ويحرّك المخزونَ والذمّة. اختر طريقةَ التسوية:")
                Spacer(Modifier.height(10.dp))
                ActionButton(
                    label = "آجل — على ذمّة المورّد",
                    onClick = { onPost("credit", null, null) },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                ActionButton(
                    label = "نقديّ — من الصندوق",
                    onClick = { pickAccountFor = "cash" },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                ActionButton(
                    label = "تحويل بنكي — من البنك",
                    onClick = { pickAccountFor = "bank" },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
    pickAccountFor?.let { method ->
        val activeLocations = state.staff.cashLocations.filter { it.isActive && !it.accountId.isNullOrBlank() }
        val matchingLocations = activeLocations.filter {
            if (method == "cash") it.kind == "cash" else it.kind == "bank"
        }.ifEmpty { activeLocations }
        val postableAccounts = state.staff.accounts.filter {
            it.postable && (it.type == null || it.type == "asset")
        }.ifEmpty { state.staff.accounts.filter { it.postable } }
        val pickerItems = buildList {
            matchingLocations.forEach { loc ->
                add(
                    PickerItem(
                        id = "loc:${loc.id}",
                        title = loc.name,
                        subtitle = if (loc.kind == "bank") "بنك" else "صندوق نقديّ",
                        trailing = if (loc.isDefault) "افتراضيّ" else null,
                    )
                )
            }
            postableAccounts.forEach { acc ->
                add(
                    PickerItem(
                        id = "acc:${acc.id}",
                        title = "${acc.code} — ${acc.label}",
                        subtitle = "حسابٌ محاسبيّ فرعيّ",
                    )
                )
            }
        }
        PickerDialog(
            title = if (method == "cash") "اختر الصندوق أو الحساب" else "اختر البنك أو الحساب",
            items = pickerItems,
            onDismiss = { pickAccountFor = null },
            onSelect = { picked ->
                pickAccountFor = null
                if (picked.id.startsWith("loc:")) {
                    val locId = picked.id.removePrefix("loc:")
                    val loc = state.staff.cashLocations.firstOrNull { it.id == locId }
                    onPost(method, loc?.accountId, locId)
                } else {
                    val accId = picked.id.removePrefix("acc:")
                    onPost(method, accId, null)
                }
            },
        )
    }
}

/**
 * نموذجُ إنشاء/تعديلِ فاتورة مشتريات (مسودّة) — يدعمُ أيضًا مردودَ المشتريات المرتبط
 * بفاتورةِ شراءٍ مرحَّلة (`referenceInvoiceId` وفق ACC-021) ونسبَ ضريبةِ الأصناف وتاريخَ الاستحقاق.
 */
@Composable
private fun PurchaseInvoiceForm(
    vm: AppViewModel,
    onDone: () -> Unit,
    onAddSupplier: () -> Unit,
    edit: PurchaseInvoiceDetailDto? = null,
) {
    val state by vm.uiState.collectAsState()
    val availableItems = state.effectiveItems
    val availableWarehouses = state.effectiveWarehouses

    LaunchedEffect(Unit) { vm.ensureLookups() }

    var branchId by remember { mutableStateOf(edit?.branchId ?: "") }
    var branchLabel by remember {
        mutableStateOf(edit?.branchId?.let { bid -> state.staff.branches.firstOrNull { it.id == bid }?.nameAr } ?: "")
    }
    var partyId by remember { mutableStateOf(edit?.partyId ?: "") }
    var partyLabel by remember { mutableStateOf(edit?.partyName ?: "") }
    var warehouseId by remember { mutableStateOf(edit?.warehouseId ?: "") }
    var warehouseLabel by remember {
        mutableStateOf(edit?.warehouseId?.let { wid -> availableWarehouses.firstOrNull { it.id == wid }?.label } ?: "")
    }
    var supplierRef by remember { mutableStateOf(edit?.supplierReferenceNo ?: "") }
    var dueDate by remember { mutableStateOf(edit?.dueDate ?: "") }
    var isReturn by remember { mutableStateOf(edit?.kind == "purchase_return") }
    var referenceInvoiceId by remember { mutableStateOf(edit?.referenceInvoiceId ?: "") }
    var referenceInvoiceLabel by remember {
        mutableStateOf(
            edit?.referenceInvoiceId?.let { rid ->
                state.staff.purchaseInvoices.firstOrNull { it.id == rid }?.number
            } ?: ""
        )
    }
    var pickBranch by remember { mutableStateOf(false) }
    var pickParty by remember { mutableStateOf(false) }
    var pickWarehouse by remember { mutableStateOf(false) }
    var pickReferenceInvoice by remember { mutableStateOf(false) }
    var pickLineAt by remember { mutableStateOf(-1) }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }
    var priceIncludesVat by remember { mutableStateOf(edit?.priceIncludesVat ?: false) }

    fun resolveItemTaxAndCost(itemId: String): Triple<String, String?, String?> {
        val catItem = state.staff.catalogItems.firstOrNull { it.id == itemId }
        val optItem = availableItems.firstOrNull { it.id == itemId }
        val tgId = catItem?.taxGroupId ?: optItem?.effectiveTaxGroupId
        val tg = tgId?.let { id -> state.staff.taxGroups.firstOrNull { it.id == id } }
        val rate = tg?.rate?.let { Dec.fmt(it, maxScale = 2, minScale = 0) }?.ifBlank { "15" } ?: "15"
        val cost = catItem?.purchasePrice ?: optItem?.effectivePurchasePrice
        return Triple(rate, tgId, cost)
    }

    data class PurchaseLine(
        val itemId: String = "",
        val itemLabel: String = "",
        val qty: String = "",
        val price: String = "",
        val taxRate: String = "15",
        val taxGroupId: String? = null,
    )
    val lines = remember {
        val initial = edit?.lines?.map { line ->
            PurchaseLine(
                itemId = line.itemId,
                itemLabel = availableItems.firstOrNull { it.id == line.itemId }?.label ?: line.description ?: "",
                qty = line.quantity,
                price = line.unitPrice ?: "",
                taxRate = line.taxRate?.let { Dec.fmt(it, maxScale = 2, minScale = 0) }?.ifBlank { "15" } ?: "15",
                taxGroupId = line.taxGroupId,
            )
        }.orEmpty()
        mutableStateListOf<PurchaseLine>().apply {
            if (initial.isEmpty()) {
                add(PurchaseLine())
                add(PurchaseLine())
            } else {
                addAll(initial)
            }
        }
    }

    // عند اختيار فاتورة شراء مرحّلة للمرتجع تُعبَّأ بيانات المورد والمستودع والسطور تلقائيًّا.
    LaunchedEffect(state.staff.purchaseInvoiceDetail, referenceInvoiceId) {
        val refDetail = state.staff.purchaseInvoiceDetail?.takeIf {
            isReturn && edit == null && referenceInvoiceId.isNotBlank() && it.id == referenceInvoiceId
        } ?: return@LaunchedEffect
        refDetail.partyId?.let { pid ->
            partyId = pid
            partyLabel = refDetail.partyName ?: state.staff.suppliers.firstOrNull { it.id == pid }?.displayName.orEmpty()
        }
        refDetail.branchId?.let { bid ->
            branchId = bid
            branchLabel = state.staff.branches.firstOrNull { it.id == bid }?.nameAr.orEmpty()
        }
        refDetail.warehouseId?.let { wid ->
            warehouseId = wid
            warehouseLabel = availableWarehouses.firstOrNull { it.id == wid }?.label.orEmpty()
        }
        priceIncludesVat = refDetail.priceIncludesVat ?: false
        if (refDetail.lines.isNotEmpty()) {
            lines.clear()
            lines.addAll(
                refDetail.lines.map { line ->
                    PurchaseLine(
                        itemId = line.itemId,
                        itemLabel = availableItems.firstOrNull { it.id == line.itemId }?.label ?: line.description ?: line.itemId,
                        qty = line.quantity,
                        price = line.unitPrice ?: "",
                        taxRate = line.taxRate?.let { Dec.fmt(it, maxScale = 2, minScale = 0) }?.ifBlank { "0" } ?: "0",
                        taxGroupId = line.taxGroupId,
                    )
                }
            )
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
    LaunchedEffect(availableWarehouses, state.staff.suppliers, availableItems) {
        if (warehouseId.isNotBlank() && warehouseLabel.isBlank()) {
            availableWarehouses.firstOrNull { it.id == warehouseId }?.let { warehouseLabel = it.label }
        }
        if (partyId.isNotBlank() && partyLabel.isBlank()) {
            state.staff.suppliers.firstOrNull { it.id == partyId }?.let { partyLabel = it.displayName }
        }
        lines.forEachIndexed { idx, line ->
            if (line.itemId.isNotBlank() && line.itemLabel.isBlank()) {
                availableItems.firstOrNull { it.id == line.itemId }?.let { opt ->
                    lines[idx] = line.copy(itemLabel = opt.label)
                }
            }
        }
    }

    LazyColumn(
        Modifier.fillMaxSize().padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            SectionCard(
                title = when {
                    edit != null -> "تعديلُ فاتورةِ ${edit.number.ifBlank { "—" }}"
                    isReturn -> "مردودُ مشترياتٍ جديد"
                    else -> "فاتورةُ مشترياتٍ جديدة"
                },
                subtitle = if (edit != null) "تعديلُ المسودّة قبل الترحيل" else "تُنشأ مسودّةً — والترحيلُ بعد التسجيل",
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    androidx.compose.material3.FilterChip(
                        selected = !isReturn,
                        onClick = { isReturn = false },
                        label = { Text("فاتورةُ شراء") },
                    )
                    androidx.compose.material3.FilterChip(
                        selected = isReturn,
                        onClick = { isReturn = true },
                        label = { Text("مردودُ مشتريات") },
                    )
                }
                if (isReturn) {
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = referenceInvoiceLabel,
                        onValueChange = {},
                        readOnly = true,
                        interactionSource = rememberPickerInteractionSource { pickReferenceInvoice = true },
                        label = { Text("فاتورةُ الشراء المرحَّلة المرتجع عليها *") },
                        placeholder = { Text("اختر فاتورةَ الشراء الأصليّة") },
                        modifier = Modifier.fillMaxWidth(),
                        trailingIcon = { PickerTrigger(onClick = { pickReferenceInvoice = true }) },
                    )
                }
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = branchLabel,
                    onValueChange = {},
                    readOnly = true,
                    interactionSource = rememberPickerInteractionSource { pickBranch = true },
                    label = { Text("الفرع *") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { PickerTrigger(onClick = { pickBranch = true }) },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = partyLabel,
                    onValueChange = {},
                    readOnly = true,
                    interactionSource = rememberPickerInteractionSource { pickParty = true },
                    label = { Text("المورّد *") },
                    placeholder = { Text("اختر المورّد") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = {
                        Row {
                            if (state.can("parties.manage")) {
                                TextButton(onClick = onAddSupplier) { Text("مورّدٌ جديد") }
                            }
                            PickerTrigger(onClick = { pickParty = true })
                        }
                    },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = warehouseLabel,
                    onValueChange = {},
                    readOnly = true,
                    interactionSource = rememberPickerInteractionSource { pickWarehouse = true },
                    label = { Text("مستودعُ الاستلام") },
                    placeholder = { Text("افتراضيُّ الفرع") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { PickerTrigger(onClick = { pickWarehouse = true }) },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = supplierRef, onValueChange = { supplierRef = it }, label = { Text("مرجعُ المورّد (رقمُ فاتورته)") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                DatePickerField(
                    label = "تاريخُ الاستحقاق (اختياريّ — يُحسَب من مهلة المورّد إن تُرك)",
                    value = dueDate,
                    onValueChange = { dueDate = it },
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
            SectionCard(title = "سطورُ الفاتورة", subtitle = "الصنفُ والكميّةُ وسعرُ الوحدة ونسبةُ الضريبة") {
                lines.forEachIndexed { index, line ->
                    Column(Modifier.padding(vertical = 4.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                            OutlinedTextField(
                                value = line.itemLabel,
                                onValueChange = {},
                                readOnly = true,
                                interactionSource = rememberPickerInteractionSource { pickLineAt = index },
                                label = { Text("الصنف ${index + 1} *") },
                                placeholder = { Text("اضغط لاختيار الصنف…") },
                                modifier = Modifier.weight(1.4f),
                                trailingIcon = { PickerTrigger(onClick = { pickLineAt = index }) },
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
                                label = { Text("سعرُ الوحدة *") },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                modifier = Modifier.weight(1f),
                            )
                            OutlinedTextField(
                                value = line.taxRate,
                                onValueChange = { if (Dec.isValidInput(it)) lines[index] = line.copy(taxRate = it) },
                                label = { Text("الضريبة %") },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                modifier = Modifier.weight(0.75f),
                            )
                        }
                    }
                }
                OutlinedButton(onClick = { lines.add(PurchaseLine()) }, modifier = Modifier.fillMaxWidth()) { Text("+ أضف سطرًا") }
                Spacer(Modifier.height(6.dp))
                val valid = lines.filter { it.itemId.isNotBlank() && Dec.isPositive(it.qty) && Dec.isPositive(it.price) }
                if (valid.isNotEmpty()) {
                    val preview = Dec.previewInvoiceTotals(
                        lines = valid.map {
                            Dec.InvoiceLinePreviewInput(
                                quantity = it.qty,
                                unitPrice = it.price,
                                taxRate = it.taxRate.ifBlank { "0" },
                            )
                        },
                        priceIncludesVat = priceIncludesVat,
                    )
                    KeyValue("الصافي قبل الضريبة", Dec.money(preview.subtotal.toPlainString()) + " ر.س")
                    KeyValue("ضريبةُ القيمة المضافة", Dec.money(preview.tax.toPlainString()) + " ر.س")
                    KeyValueColored("الإجماليُّ النهائيّ", Dec.money(preview.total.toPlainString()) + " ر.س", BakeryColors.Primary)
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
                                isReturn && referenceInvoiceId.isBlank() -> "اختر فاتورةَ الشراء المرحَّلة التي يُردُّ عليها المرتجع."
                                partyId.isBlank() -> "اختر المورّد."
                                validLines.isEmpty() -> "أضف سطرًا واحدًا على الأقلّ (صنفٌ وكميّةٌ وسعر)."
                                validLines.any { !Dec.isPositive(it.qty) } -> "كميّةُ كلّ سطرٍ يجب أن تكون رقمًا موجبًا."
                                validLines.any { !Dec.isPositive(it.price) } -> "سعرُ الوحدة لكلّ سطرٍ يجب أن يكون موجبًا."
                                validLines.any { !Dec.isNonNegative(it.taxRate.ifBlank { "0" }) } -> "نسبةُ الضريبة يجب أن تكون صفرًا أو موجبة."
                                lines.any { it.itemId.isNotBlank() && (Dec.parse(it.qty) == null || Dec.parse(it.price) == null) } ->
                                    "أكمل الكميّةَ والسعرَ لكلّ صنفٍ مُختار."
                                else -> null
                            }
                            if (error != null) return@ActionButton
                            sending = true
                            val body = buildJsonObject {
                                put("branchId", branchId)
                                put("partyId", partyId)
                                put("priceIncludesVat", priceIncludesVat)
                                if (isReturn) {
                                    put("kind", "purchase_return")
                                    put("referenceInvoiceId", referenceInvoiceId)
                                } else if (edit != null) {
                                    put("kind", "purchase")
                                }
                                if (dueDate.isNotBlank()) put("dueDate", dueDate.trim())
                                if (warehouseId.isNotBlank()) put("warehouseId", warehouseId)
                                if (supplierRef.isNotBlank()) put("supplierReferenceNo", supplierRef.trim())
                                put(
                                    "lines",
                                    kotlinx.serialization.json.buildJsonArray {
                                        validLines.forEach { line ->
                                            add(
                                                buildJsonObject {
                                                    put("itemId", line.itemId)
                                                    put("quantity", Dec.wire(line.qty))
                                                    put("unitPrice", Dec.wire(line.price))
                                                    put("taxRate", Dec.wire(line.taxRate.ifBlank { "0" }))
                                                    line.taxGroupId?.takeIf { it.isNotBlank() }?.let { put("taxGroupId", it) }
                                                }
                                            )
                                        }
                                    },
                                )
                            }
                            if (edit != null) {
                                vm.updatePurchaseInvoice(edit.id, body) { result ->
                                    sending = false
                                    if (result is ActionResult.Synced) {
                                        vm.loadPurchases()
                                        onDone()
                                    }
                                }
                            } else {
                                vm.createPurchaseInvoice(body) { result ->
                                    sending = false
                                    if (result is ActionResult.Synced) {
                                        vm.loadPurchases()
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

    if (pickReferenceInvoice) {
        val postedPurchases = state.staff.purchaseInvoices.filter {
            it.status == "posted" && it.kind == "purchase"
        }
        PickerDialog(
            title = "اختر فاتورة الشراء الأصليّة",
            items = postedPurchases.map { inv ->
                val suppName = inv.partyName ?: state.staff.suppliers.firstOrNull { it.id == inv.partyId }?.displayName ?: ""
                PickerItem(
                    id = inv.id,
                    title = "${inv.number.ifBlank { inv.id.takeLast(6) }} — $suppName",
                    subtitle = inv.supplierReferenceNo?.let { "مرجع: $it" },
                    trailing = inv.total?.let { "${Dec.money(it)} ر.س" },
                )
            },
            onDismiss = { pickReferenceInvoice = false },
            onSelect = { picked ->
                referenceInvoiceId = picked.id
                referenceInvoiceLabel = picked.title
                vm.loadPurchaseInvoiceDetail(picked.id)
                pickReferenceInvoice = false
            },
        )
    }
    if (pickBranch) {
        PickerDialog(
            title = "اختر الفرع",
            items = state.staff.branches.map { PickerItem(it.id, it.nameAr, trailing = if (it.isDefault) "افتراضيّ" else null) },
            loading = state.staff.loadingKey == "purchases",
            onRefresh = { vm.loadPurchases() },
            onDismiss = { pickBranch = false },
            onSelect = { branchId = it.id; branchLabel = it.title },
        )
    }
    if (pickParty) {
        PickerDialog(
            title = "اختر المورّد",
            items = state.staff.suppliers.map { PickerItem(it.id, it.displayName, trailing = it.phone) },
            loading = state.staff.loadingKey == "purchases",
            onRefresh = { vm.loadPurchases() },
            alwaysShowSearch = true,
            onDismiss = { pickParty = false },
            onSelect = { partyId = it.id; partyLabel = it.title },
        )
    }
    if (pickWarehouse) {
        PickerDialog(
            title = "اختر المستودع",
            items = availableWarehouses.map { PickerItem(it.id, it.label, trailing = if (it.effectiveIsDefault) "افتراضيّ" else null) },
            loading = state.loadingLookups,
            onRefresh = { vm.ensureLookups(force = true) },
            onDismiss = { pickWarehouse = false },
            onSelect = { warehouseId = it.id; warehouseLabel = it.title },
        )
    }
    if (pickLineAt >= 0) {
        val at = pickLineAt
        PickerDialog(
            title = "صنفُ السطر ${at + 1}",
            items = availableItems.map { item ->
                PickerItem(
                    id = item.id,
                    title = item.label,
                    subtitle = item.subtitle,
                    trailing = item.effectivePurchasePrice?.let { "${Dec.money(it)} ر.س" },
                )
            },
            loading = state.loadingLookups || state.staff.loadingKey == "purchases",
            errorMessage = state.lookupsError,
            onRefresh = { vm.ensureLookups(force = true) },
            onQueryChange = { vm.searchItemsRemotely(it) },
            alwaysShowSearch = true,
            onDismiss = { pickLineAt = -1 },
            onSelect = { item ->
                val (rate, tgId, defaultCost) = resolveItemTaxAndCost(item.id)
                val current = lines[at]
                lines[at] = current.copy(
                    itemId = item.id,
                    itemLabel = item.title,
                    taxRate = rate,
                    taxGroupId = tgId,
                    price = current.price.ifBlank { defaultCost?.let { Dec.fmt(it, maxScale = 2, minScale = 0) }.orEmpty() },
                )
                pickLineAt = -1
            },
        )
    }
}

/** إضافةُ مورّد — `POST /parties` بـ kind=supplier (كما في شاشة المورّدين). */
@Composable
private fun SupplierForm(vm: AppViewModel, onDone: () -> Unit) {
    var name by remember { mutableStateOf("") }
    var taxNo by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    SectionCard(title = "مورّدٌ جديد", subtitle = "طرفٌ من نوعه supplier — يدخل فواتير المشتريات", modifier = Modifier.padding(14.dp)) {
        OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("اسمُ المورّد *") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = taxNo, onValueChange = { taxNo = it }, label = { Text("الرقمُ الضريبيّ") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = phone, onValueChange = { phone = it }, label = { Text("الهاتف") }, modifier = Modifier.fillMaxWidth())
        if (error != null) {
            Spacer(Modifier.height(8.dp))
            StatusChip(error ?: "", ChipTone.DANGER)
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ActionButton(
                label = if (sending) "جارٍ الحفظ…" else "حفظُ المورّد",
                onClick = {
                    error = if (name.isBlank()) "اسمُ المورّد إلزاميّ." else null
                    if (error != null) return@ActionButton
                    sending = true
                    val body = buildJsonObject {
                        put("kind", "supplier")
                        put("name", name.trim())
                        if (taxNo.isNotBlank()) put("taxNo", taxNo.trim())
                        if (phone.isNotBlank()) put("phone", phone.trim())
                    }
                    vm.createSupplier(body) { result ->
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
