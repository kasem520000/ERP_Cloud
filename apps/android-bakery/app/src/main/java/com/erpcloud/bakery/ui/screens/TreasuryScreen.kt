package com.erpcloud.bakery.ui.screens

import androidx.activity.compose.BackHandler
import com.erpcloud.bakery.ui.components.rememberPickerInteractionSource

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
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
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.data.ActionResult
import com.erpcloud.bakery.data.api.TreasuryVoucherDto
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.ActionButton
import com.erpcloud.bakery.ui.components.PickerTrigger
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.ConfirmDialog
import com.erpcloud.bakery.ui.components.ConfirmReasonDialog
import com.erpcloud.bakery.ui.components.DatePickerField
import com.erpcloud.bakery.ui.components.DocumentDetailDialog
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
 * شاشةُ الخزينة والمصروفات — سنداتُ القبض والصرف (من تطبيق الويب `frmSandQ/frmSandD`):
 * المصروفُ اليوميّ (غاز/صيانة/ضيافة) وسندُ القبض اليدويّ، ثمّ **الترحيل** الذي
 * يُقيّد في الدفتر ويحرّك رصيد الصندوق.
 *
 * القاعدةُ كما في الويب: السندُ يُنشأ **مسودّةً**؛ والترحيلُ بإذن `treasury.voucher.post`.
 *
 * المرحلةُ الثانية: البطاقةُ التفصيليّة (`GET /vouchers/{id}`) بالضغط على السند،
 * وتعديلُ المسودّة (`PATCH /vouchers/{id}`) بإذن الإنشاء، والإبطالُ بسببٍ إلزاميّ
 * (`POST /vouchers/{id}/void`) بإذن `treasury.voucher.void`.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TreasuryScreen(
    vm: AppViewModel,
    onBack: () -> Unit,
    onOpenCashBoxes: (() -> Unit)? = null,
) {
    val state by vm.uiState.collectAsState()
    var showCreate by remember { mutableStateOf(false) }
    var postTarget by remember { mutableStateOf<String?>(null) }
    var voidTarget by remember { mutableStateOf<String?>(null) }
    var detailTarget by remember { mutableStateOf<String?>(null) }
    var editTarget by remember { mutableStateOf<TreasuryVoucherDto?>(null) }
    var query by rememberSaveable { mutableStateOf("") }

    LaunchedEffect(Unit) { vm.loadTreasury() }

    // البطاقةُ التفصيليّةُ تُجلبُ عند الطلب وتُمسحُ حالتُها عند الإغلاق
    LaunchedEffect(detailTarget) {
        detailTarget?.let { vm.loadTreasuryVoucherDetail(it) }
    }
    val detail = state.staff.treasuryVoucherDetail?.takeIf { it.id == detailTarget }
    // أسماءُ الطرف والحساب المقابل قد لا تكون محمّلةً بعد — تُجلبُ لتكتملَ البطاقة
    LaunchedEffect(detail?.partyId, detail?.counterAccountId) {
        val d = detail ?: return@LaunchedEffect
        if (d.partyId != null && state.staff.parties.none { it.id == d.partyId }) {
            vm.loadParties(if (d.subtype == "supplier") "supplier" else "customer")
        }
        if (d.counterAccountId != null && state.staff.accounts.none { it.id == d.counterAccountId }) {
            vm.loadAccounts()
        }
    }

    val inSubView = showCreate || editTarget != null
    BackHandler(enabled = inSubView) {
        showCreate = false
        editTarget = null
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        when {
                            showCreate -> "سند خزينة جديد"
                            editTarget != null -> "تعديل سند الخزينة"
                            else -> "الخزينة والمصروفات"
                        },
                        fontWeight = FontWeight.ExtraBold,
                    )
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
                navigationIcon = {
                    IconButton(
                        onClick = {
                            if (inSubView) {
                                showCreate = false
                                editTarget = null
                            } else {
                                onBack()
                            }
                        },
                    ) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
                actions = {
                    if (!inSubView && onOpenCashBoxes != null) {
                        TextButton(onClick = onOpenCashBoxes) {
                            Text("الصناديق والأرصدة", fontWeight = FontWeight.Bold)
                        }
                    }
                },
            )
        },
        floatingActionButton = {
            if (!showCreate && editTarget == null && state.can("treasury.voucher.create")) {
                // FAB كهرمانيٌّ أساسيٌّ بأيقونةٍ بيضاء، أسفلُ اليسار في RTL.
                FloatingActionButton(
                    onClick = { showCreate = true },
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = Color.White,
                    shape = RoundedCornerShape(18.dp),
                ) {
                    Icon(Icons.Default.Add, contentDescription = "سند جديد")
                }
            }
        },
    ) { padding ->
        if (showCreate || editTarget != null) {
            androidx.compose.foundation.layout.Box(Modifier.fillMaxSize().padding(padding)) {
                VoucherForm(vm, initial = editTarget, onDone = { showCreate = false; editTarget = null })
            }
            return@Scaffold
        }
        val loading = state.staff.loadingKey == "treasury"
        if (loading && state.staff.treasuryVouchers.isEmpty()) {
            CenterLoading("جارٍ تحميل السندات…", Modifier.padding(padding))
            return@Scaffold
        }
        val q = query.trim()
        val vouchers = state.staff.treasuryVouchers.filter { voucher ->
            q.isBlank() ||
                voucher.number.contains(q, ignoreCase = true) ||
                (voucher.description ?: "").contains(q, ignoreCase = true) ||
                (voucher.recipient ?: "").contains(q, ignoreCase = true) ||
                state.staff.parties.firstOrNull { it.id == voucher.partyId }?.displayName?.contains(q, ignoreCase = true) == true
        }
        PullRefreshBox(
            refreshing = loading,
            onRefresh = { vm.loadTreasury() },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            Column(Modifier.fillMaxSize()) {
                if (!state.can("treasury.voucher.create")) {
                    MissingPermissionHint(
                        "إنشاء سند قبض/صرف",
                        "treasury.voucher.create",
                        Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                    )
                }
                SearchField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp),
                    placeholder = "ابحث برقم السند أو البيان أو الطرف…",
                )
                if (vouchers.isEmpty()) {
                    EmptyState(
                        state.staff.error
                            ?: if (q.isBlank()) "لا سنداتَ بعد." else "لا نتائجَ تطابقُ البحث.",
                    )
                } else {
                    LazyColumn(
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(vouchers, key = { it.id }) { voucher ->
                            val (kindText, kindTone) = Labels.voucherFlow(voucher.kind)
                            val (statusText, statusTone) = Labels.docStatus(voucher.status)
                            // بطاقةُ سندٍ كما في الموك-أب: رأسٌ (نوعُ السند + رقمُه عريضًا +
                            // تاريخٌ رماديّ)، شاراتٌ ملوّنة، جسمُ مفتاح/قيمة، ثمّ أفعالٌ سلفيّة.
                            SectionCard(
                                title = "$kindText ${voucher.number.ifBlank { "—" }}",
                                subtitle = Labels.dateOrDash(voucher.date),
                                modifier = Modifier.clickable { detailTarget = voucher.id },
                            ) {
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    StatusChip(kindText, kindTone)
                                    StatusChip(Labels.voucherSubtype(voucher.subtype), ChipTone.NEUTRAL)
                                    StatusChip(statusText, statusTone)
                                }
                                Spacer(Modifier.height(6.dp))
                                if (voucher.kind == "receipt") {
                                    // مبلغُ سندِ القبضِ أخضرُ كما في الموك-أب.
                                    KeyValueColored("المبلغ", Dec.money(voucher.amount) + " ر.س", BakeryColors.Ok)
                                } else {
                                    KeyValue("المبلغ", Dec.money(voucher.amount) + " ر.س")
                                }
                                KeyValue("الطريقة", Labels.voucherMethod(voucher.method))
                                state.staff.cashLocations.firstOrNull { it.id == voucher.cashLocationId }?.let {
                                    KeyValue("الخزينة", it.name)
                                }
                                state.staff.parties.firstOrNull { it.id == voucher.partyId }?.let { KeyValue("الطرف", it.displayName) }
                                voucher.chequeNo?.takeIf { it.isNotBlank() }?.let { KeyValue("رقمُ الشيك", it) }
                                voucher.description?.takeIf { it.isNotBlank() }?.let { KeyValue("البيان", it) }
                                voucher.recipient?.takeIf { it.isNotBlank() }?.let { KeyValue("المستلم", it) }
                                if (voucher.status == "draft" && state.can("treasury.voucher.post")) {
                                    Spacer(Modifier.height(10.dp))
                                    OutlinedButton(
                                        onClick = { postTarget = voucher.id },
                                        modifier = Modifier.fillMaxWidth(),
                                        shape = RoundedCornerShape(26.dp),
                                    ) { Text("ترحيلُ السند") }
                                }
                                Row(
                                    Modifier.padding(top = 8.dp),
                                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                                ) {
                                    if (voucher.status == "draft" && state.can("treasury.voucher.create")) {
                                        InlineAction("تعديل", onClick = { editTarget = voucher })
                                    }
                                    if (voucher.status != "voided" && voucher.status != "void" && state.can("treasury.voucher.void")) {
                                        InlineAction("إبطال", onClick = { voidTarget = voucher.id }, tone = ChipTone.DANGER)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (postTarget != null) {
        val id = postTarget ?: ""
        ConfirmDialog(
            title = "ترحيلُ السند",
            message = "الترحيلُ يُقيّدُ السندَ في الدفتر ويحرّكُ رصيدَ الصندوق — المسودّةُ وحدها القابلةُ للتعديل. هل تُرحّله؟",
            confirmLabel = "ترحيل",
            onConfirm = {
                postTarget = null
                vm.postTreasuryVoucher(id, buildJsonObject { }) { result ->
                    if (result is ActionResult.Synced) vm.loadTreasury()
                }
            },
            onDismiss = { postTarget = null },
        )
    }

    if (voidTarget != null) {
        val id = voidTarget ?: ""
        ConfirmReasonDialog(
            title = "إبطالُ السند",
            message = "الإبطالُ لا رجعةَ فيه — يُوسَمُ السندُ ملغىً ويُرجَعُ أثرُه عن الصندوق إن كان مرحّلًا. اذكرْ سببَ الإبطال.",
            onDismiss = { voidTarget = null },
            onConfirm = { reason ->
                voidTarget = null
                vm.voidTreasuryVoucher(id, buildJsonObject { put("reason", reason) }) { result ->
                    if (result is ActionResult.Synced) vm.loadTreasury()
                }
            },
            confirmLabel = "إبطال",
            reasonLabel = "سببُ الإبطال",
        )
    }

    if (detailTarget != null) {
        if (state.staff.detailError != null) {
            AlertDialog(
                onDismissRequest = { detailTarget = null; vm.clearDocumentDetail() },
                confirmButton = {
                    TextButton(onClick = { detailTarget = null; vm.clearDocumentDetail() }) { Text("رجوع") }
                },
                title = { Text("تعذّر تحميلُ السند") },
                text = { Text(state.staff.detailError ?: "") },
            )
        } else if (detail == null) {
            DocumentDetailDialog(
                title = "تفاصيلُ السند",
                subtitle = "جارٍ التحميل…",
                onDismiss = { detailTarget = null; vm.clearDocumentDetail() },
            ) {
                CenterLoading()
            }
        } else {
            val (kindText, kindTone) = Labels.voucherFlow(detail.kind)
            val (statusText, statusTone) = Labels.docStatus(detail.status)
            val currency = detail.currency?.takeIf { it.isNotBlank() } ?: "ر.س"
            DocumentDetailDialog(
                title = "$kindText ${detail.number.ifBlank { "—" }}",
                subtitle = Labels.dateOrDash(detail.date),
                onDismiss = { detailTarget = null; vm.clearDocumentDetail() },
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    StatusChip(kindText, kindTone)
                    StatusChip(Labels.voucherSubtype(detail.subtype), ChipTone.NEUTRAL)
                    StatusChip(statusText, statusTone)
                }
                Spacer(Modifier.height(8.dp))
                KeyValue("رقمُ السند", detail.number.ifBlank { "—" })
                KeyValue("التاريخ", Labels.dateOrDash(detail.date))
                KeyValue("المبلغ", Dec.money(detail.amount) + " $currency")
                detail.vatAmount?.takeIf { it.isNotBlank() }?.let { KeyValue("ضريبةُ القيمة المضافة", Dec.money(it) + " $currency") }
                detail.netAmount?.takeIf { it.isNotBlank() }?.let { KeyValue("الصافي", Dec.money(it) + " $currency") }
                KeyValue("طريقةُ الدفع", Labels.voucherMethod(detail.method))
                state.staff.branches.firstOrNull { it.id == detail.branchId }?.let { KeyValue("الفرع", it.nameAr) }
                state.staff.cashLocations.firstOrNull { it.id == detail.cashLocationId }?.let { KeyValue("الخزينة", it.name) }
                state.staff.parties.firstOrNull { it.id == detail.partyId }?.let { KeyValue("الطرف", it.displayName) }
                state.staff.accounts.firstOrNull { it.id == detail.counterAccountId }?.let { KeyValue("الحسابُ المقابل", it.label) }
                detail.chequeNo?.takeIf { it.isNotBlank() }?.let { KeyValue("رقمُ الشيك", it) }
                detail.chequeDate?.takeIf { it.isNotBlank() }?.let { KeyValue("تاريخُ الشيك", it) }
                detail.bankName?.takeIf { it.isNotBlank() }?.let { KeyValue("البنك", it) }
                detail.chequeState?.takeIf { it.isNotBlank() }?.let { KeyValue("حالةُ الشيك", chequeStateAr(it)) }
                detail.referenceNo?.takeIf { it.isNotBlank() }?.let { KeyValue("المرجع", it) }
                detail.recipient?.takeIf { it.isNotBlank() }?.let { KeyValue("المستلم", it) }
                KeyValue("البيان", detail.description ?: "—")
                KeyValue("أنشأها", detail.createdByName ?: "—")
                detail.postedAt?.takeIf { it.isNotBlank() }?.let { KeyValue("رحّلها في", it) }
                detail.voidedAt?.takeIf { it.isNotBlank() }?.let { KeyValue("أُبطلت في", it) }
                // 🖨️ طباعةُ A4 الاحترافيّةُ من الخادمِ — سندُ القبض/الصرف بقالبِ الويبِ الرسميِّ.
                Spacer(Modifier.height(10.dp))
                val printScope = rememberCoroutineScope()
                val printContext = androidx.compose.ui.platform.LocalContext.current
                OutlinedButton(
                    onClick = {
                        printScope.launch {
                            try {
                                val html = vm.treasuryVoucherPrintHtml(detail.id)
                                com.erpcloud.bakery.printing.HtmlPrint.printViaSystem(
                                    printContext, html, "سند ${detail.number}",
                                )
                            } catch (error: Exception) {
                                vm.showPrintError(error.message ?: "تعذّرت طباعةُ السند")
                            }
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("🖨 طباعة A4 — بقالب الويب الرسميّ") }
            }
        }
    }
}

/**
 * إنشاءُ/تعديلُ سند قبض/صرف — مسودّةٌ تُرحَّل بعد الحفظ (الأطراف والحساب المقابل
 * اختياريّان). التعديلُ للمسودّاتِ فقط (النموذجُ نفسُه يُعاد استعمالُه بقيمٍ أوّليّة).
 *
 * **مفتاحُ النيّة**: يُبنى عند أوّل إرسالٍ ويُحفَظ `rememberSaveable` فيُعاد استعمالُه
 * في كلّ محاولة (فلا يُخلَقُ سندٌ مكرّرٌ إن انقطعت الشبكةُ بعد الإرسال)، ولا يُمسحُ
 * إلا بعد النجاح كي يأخذَ السندُ التالي مفتاحًا جديدًا.
 */
@Composable
private fun VoucherForm(vm: AppViewModel, initial: TreasuryVoucherDto? = null, onDone: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var idemKey by rememberSaveable { mutableStateOf("") }
    var kind by remember { mutableStateOf(initial?.kind ?: "payment") }
    var subtype by remember { mutableStateOf(initial?.subtype ?: "expense") }
    var subtypeLabel by remember { mutableStateOf(Labels.voucherSubtype(initial?.subtype ?: "expense")) }
    var branchId by remember { mutableStateOf(initial?.branchId ?: "") }
    var branchLabel by remember { mutableStateOf("") }
    var cashLocationId by remember { mutableStateOf(initial?.cashLocationId ?: "") }
    var cashLabel by remember { mutableStateOf("") }
    var method by remember { mutableStateOf(initial?.method ?: "cash") }
    var methodLabel by remember { mutableStateOf(Labels.voucherMethod(initial?.method ?: "cash")) }
    var chequeNo by remember { mutableStateOf(initial?.chequeNo ?: "") }
    var chequeDate by remember { mutableStateOf(initial?.chequeDate ?: "") }
    var amount by remember { mutableStateOf(initial?.amount?.takeIf { it.isNotBlank() } ?: "") }
    var vatAmount by remember {
        mutableStateOf(initial?.vatAmount?.takeIf { Dec.isPositive(it) }?.let { Dec.fmt(it, 2, 0) } ?: "")
    }
    var date by remember { mutableStateOf(initial?.date?.takeIf { it.isNotBlank() } ?: todayIso()) }
    var description by remember { mutableStateOf(initial?.description ?: "") }
    var partyId by remember { mutableStateOf(initial?.partyId ?: "") }
    var partyLabel by remember { mutableStateOf("") }
    var counterAccountId by remember { mutableStateOf(initial?.counterAccountId ?: "") }
    var accountLabel by remember { mutableStateOf("") }
    var pickBranch by remember { mutableStateOf(false) }
    var pickCash by remember { mutableStateOf(false) }
    var pickSubtype by remember { mutableStateOf(false) }
    var pickMethod by remember { mutableStateOf(false) }
    var pickParty by remember { mutableStateOf(false) }
    var pickAccount by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    LaunchedEffect(state.staff.branches, state.staff.cashLocations) {
        if (branchId.isBlank()) {
            (state.staff.branches.firstOrNull { it.isDefault } ?: state.staff.branches.firstOrNull())
                ?.let { branchId = it.id; branchLabel = it.nameAr }
        } else if (branchLabel.isBlank()) {
            state.staff.branches.firstOrNull { it.id == branchId }?.let { branchLabel = it.nameAr }
        }
        if (cashLocationId.isBlank()) {
            state.staff.cashLocations.firstOrNull()?.let { cashLocationId = it.id; cashLabel = it.name }
        } else if (cashLabel.isBlank()) {
            state.staff.cashLocations.firstOrNull { it.id == cashLocationId }?.let { cashLabel = it.name }
        }
    }
    // يُعاد تحميل الأطراف عند كلّ تبديلٍ بين عميل ومورّد حتى لا تظهر قائمة العملاء مكان المورّدين.
    LaunchedEffect(subtype) {
        if (subtype == "customer" || subtype == "supplier") {
            vm.loadParties(subtype)
        } else {
            vm.ensureAccounts()
        }
    }
    LaunchedEffect(state.staff.parties, state.staff.accounts) {
        if (partyId.isNotBlank() && partyLabel.isBlank()) {
            state.staff.parties.firstOrNull { it.id == partyId }?.let { partyLabel = it.displayName }
        }
        if (counterAccountId.isNotBlank() && accountLabel.isBlank()) {
            state.staff.accounts.firstOrNull { it.id == counterAccountId }?.let { accountLabel = "${it.code} — ${it.label}" }
        }
    }

    LazyColumn(
        Modifier.fillMaxSize().padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            SectionCard(
                title = if (initial == null) "سندٌ جديد" else "تعديلُ سند ${initial.number.ifBlank { "—" }}",
                subtitle = "يُحفظُ مسودّةً — والترحيلُ هو ما يحرّك رصيد الصندوق",
            ) {
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    SegmentedButton(
                        selected = kind == "payment",
                        onClick = {
                            kind = "payment"
                            if (subtype == "customer") { subtype = "supplier"; subtypeLabel = "مورّد"; partyId = ""; partyLabel = "" }
                        },
                        shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2),
                    ) { Text("سند صرف") }
                    SegmentedButton(
                        selected = kind == "receipt",
                        onClick = {
                            kind = "receipt"
                            if (subtype == "supplier") { subtype = "customer"; subtypeLabel = "عميل"; partyId = ""; partyLabel = "" }
                        },
                        shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2),
                    ) { Text("سند قبض") }
                }
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = subtypeLabel,
                    onValueChange = {},
                    readOnly = true,
                    interactionSource = rememberPickerInteractionSource { pickSubtype = true },
                    label = { Text("التصنيف *") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { PickerTrigger(onClick = { pickSubtype = true }) },
                )
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
                    value = cashLabel,
                    onValueChange = {},
                    readOnly = true,
                    interactionSource = rememberPickerInteractionSource { pickCash = true },
                    label = { Text("الخزينة *") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { PickerTrigger(onClick = { pickCash = true }) },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = methodLabel,
                    onValueChange = {},
                    readOnly = true,
                    interactionSource = rememberPickerInteractionSource { pickMethod = true },
                    label = { Text("طريقةُ الدفع") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { PickerTrigger(onClick = { pickMethod = true }) },
                )
                if (method == "cheque") {
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = chequeNo,
                        onValueChange = { chequeNo = it },
                        label = { Text("رقمُ الشيك *") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(8.dp))
                    DatePickerField(label = "تاريخُ استحقاق الشيك", value = chequeDate, onValueChange = { chequeDate = it })
                }
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = amount,
                    onValueChange = { if (Dec.isValidInput(it)) amount = it },
                    label = { Text("المبلغ الإجماليّ (ر.س) *") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = vatAmount,
                    onValueChange = { if (Dec.isValidInput(it)) vatAmount = it },
                    label = { Text("ضريبةُ القيمة المضافة ضمن المبلغ (ر.س — اختياريّ)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (Dec.isPositive(amount) && Dec.isPositive(vatAmount)) {
                    val netPreview = Dec.orZero(amount).subtract(Dec.orZero(vatAmount))
                    if (netPreview.signum() > 0) {
                        Spacer(Modifier.height(4.dp))
                        KeyValue("الصافي قبل الضريبة", Dec.money(netPreview.toPlainString()) + " ر.س")
                    }
                }
                Spacer(Modifier.height(8.dp))
                DatePickerField(label = "التاريخ", value = date, onValueChange = { date = it })
                if (subtype == "customer" || subtype == "supplier") {
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = partyLabel,
                        onValueChange = {},
                        readOnly = true,
                        interactionSource = rememberPickerInteractionSource { pickParty = true },
                        label = { Text(if (subtype == "supplier") "المورّد *" else "العميل *") },
                        modifier = Modifier.fillMaxWidth(),
                        trailingIcon = { PickerTrigger(onClick = { pickParty = true }) },
                    )
                }
                if (subtype != "customer" && subtype != "supplier" || counterAccountId.isNotBlank()) {
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = accountLabel,
                        onValueChange = {},
                        readOnly = true,
                        interactionSource = rememberPickerInteractionSource { pickAccount = true },
                        label = {
                            Text(
                                when (subtype) {
                                    "account" -> "الحسابُ المقابل *"
                                    "expense" -> "حسابُ المصروف (من دليل الحسابات)"
                                    else -> "الحسابُ المقابل (من دليل الحسابات)"
                                }
                            )
                        },
                        modifier = Modifier.fillMaxWidth(),
                        trailingIcon = { PickerTrigger(onClick = { pickAccount = true }) },
                    )
                }
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = description, onValueChange = { description = it }, label = { Text("البيان * (يظهرُ في الدفتر بعد الترحيل)") }, modifier = Modifier.fillMaxWidth())
                if (error != null) {
                    Spacer(Modifier.height(8.dp))
                    StatusChip(error ?: "", ChipTone.DANGER)
                }
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ActionButton(
                        label = when {
                            sending -> "جارٍ الحفظ…"
                            initial != null -> "حفظُ التعديل"
                            else -> "حفظُ السند"
                        },
                        onClick = {
                            val amtBd = Dec.parse(amount)
                            val vatBd = if (vatAmount.isBlank()) java.math.BigDecimal.ZERO else Dec.parse(vatAmount)
                            error = when {
                                branchId.isBlank() -> "اختر الفرع."
                                cashLocationId.isBlank() -> "اختر الخزينة."
                                amtBd == null || amtBd.signum() <= 0 -> "المبلغُ رقمٌ موجبٌ (نصٌّ دقيق)."
                                vatBd == null || vatBd.signum() < 0 -> "ضريبةُ القيمة المضافة لا تكون سالبة."
                                vatBd.signum() > 0 && vatBd >= amtBd -> "ضريبةُ السند يجب أن تكون أقلَّ من إجماليّ مبلغ السند."
                                method == "cheque" && chequeNo.isBlank() -> "أدخل رقمَ الشيك."
                                (subtype == "customer" || subtype == "supplier") && partyId.isBlank() ->
                                    if (subtype == "supplier") "اختر المورّد." else "اختر العميل."
                                subtype == "account" && counterAccountId.isBlank() -> "اختر الحسابَ المقابل للسند."
                                description.isBlank() -> "البيانُ إلزاميٌّ — سندٌ بلا بيانٍ لا يقولُ للمُراجع شيئًا."
                                else -> null
                            }
                            if (error != null) return@ActionButton
                            sending = true
                            val body = buildJsonObject {
                                put("branchId", branchId)
                                put("kind", kind)
                                put("subtype", subtype)
                                put("date", date.trim())
                                put("cashLocationId", cashLocationId)
                                put("method", method)
                                put("amount", Dec.wire(amount))
                                if (vatAmount.isNotBlank()) {
                                    put("vatAmount", Dec.wire(vatAmount))
                                } else if (initial?.vatAmount != null) {
                                    put("vatAmount", "0")
                                }
                                if (method == "cheque") {
                                    put("chequeNo", chequeNo.trim())
                                    if (chequeDate.isNotBlank()) put("chequeDate", chequeDate.trim())
                                }
                                if (partyId.isNotBlank()) put("partyId", partyId)
                                if (counterAccountId.isNotBlank()) put("counterAccountId", counterAccountId)
                                put("description", description.trim())
                            }
                            if (initial != null) {
                                // تعديلُ مسودّةٍ — PATCH بلا مفتاح نيّةٍ (لا إنشاءَ هنا فلا تكرار)
                                vm.updateTreasuryVoucher(initial.id, body) { result ->
                                    sending = false
                                    if (result is ActionResult.Synced) {
                                        vm.loadTreasury()
                                        onDone()
                                    }
                                }
                            } else {
                                // نيّةٌ واحدةٌ مفتاحٌ واحد: يُبنى مرّةً ويُعاد استعمالُه حتى النجاح
                                if (idemKey.isBlank()) {
                                    idemKey = "bakery-treasury-" + java.util.UUID.randomUUID().toString()
                                }
                                val withKey = vm.ensureIdempotencyKey("treasury-voucher", body, idemKey)
                                vm.createTreasuryVoucher(withKey) { result ->
                                    sending = false
                                    if (result is ActionResult.Synced) {
                                        idemKey = ""
                                        vm.loadTreasury()
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

    if (pickSubtype) {
        val options = buildList {
            add(PickerItem("expense", "مصروف"))
            if (kind == "receipt") add(PickerItem("customer", "عميل")) else add(PickerItem("supplier", "مورّد"))
            add(PickerItem("salary", "راتب"))
            add(PickerItem("account", "حساب"))
            add(PickerItem("vat", "ضريبة"))
            add(PickerItem("other", "أخرى"))
        }
        PickerDialog(
            title = "تصنيفُ السند",
            items = options,
            onDismiss = { pickSubtype = false },
            onSelect = {
                subtype = it.id
                subtypeLabel = it.title
                partyId = ""
                partyLabel = ""
                counterAccountId = ""
                accountLabel = ""
                pickSubtype = false
            },
        )
    }
    if (pickBranch) {
        PickerDialog(
            title = "اختر الفرع",
            items = state.staff.branches.map { PickerItem(it.id, it.nameAr, trailing = if (it.isDefault) "افتراضيّ" else null) },
            onDismiss = { pickBranch = false },
            onSelect = { branchId = it.id; branchLabel = it.title; pickBranch = false },
        )
    }
    if (pickCash) {
        PickerDialog(
            title = "اختر الخزينة",
            items = state.staff.cashLocations.filter { it.isActive }.map { PickerItem(it.id, it.name, trailing = if (it.isDefault) "افتراضيّة" else null) },
            onDismiss = { pickCash = false },
            onSelect = { cashLocationId = it.id; cashLabel = it.title; pickCash = false },
        )
    }
    if (pickMethod) {
        PickerDialog(
            title = "طريقةُ الدفع",
            items = listOf(
                PickerItem("cash", "نقدي"),
                PickerItem("bank_transfer", "تحويل بنكي"),
                PickerItem("card", "شبكة"),
                PickerItem("cheque", "شيك"),
            ),
            onDismiss = { pickMethod = false },
            onSelect = {
                method = it.id
                methodLabel = it.title
                pickMethod = false
            },
        )
    }
    if (pickParty) {
        val matchingParties = state.staff.parties.filter {
            it.kind == subtype || it.kind == "both"
        }.ifEmpty { state.staff.parties }
        PickerDialog(
            title = if (subtype == "supplier") "اختر المورّد" else "اختر العميل",
            items = matchingParties.map { PickerItem(it.id, it.displayName, trailing = it.phone) },
            onDismiss = { pickParty = false },
            onSelect = { partyId = it.id; partyLabel = it.title; pickParty = false },
        )
    }
    if (pickAccount) {
        val postableAccounts = state.staff.accounts.filter { it.postable }
        val sortedAccounts = if (subtype == "expense") {
            postableAccounts.sortedByDescending { it.type == "expense" || it.accountType == "expense" }
        } else {
            postableAccounts
        }
        PickerDialog(
            title = if (subtype == "expense") "حسابُ المصروف" else "الحسابُ المقابل",
            items = sortedAccounts.map { PickerItem(it.id, "${it.code} — ${it.label}", trailing = it.type) },
            onDismiss = { pickAccount = false },
            onSelect = { counterAccountId = it.id; accountLabel = it.title; pickAccount = false },
        )
    }
}

/** حالةُ الشيك كما تردُ من الخادم — ما لم يُعرَف يُعرَضُ خامًا كما جاء. */
private fun chequeStateAr(value: String): String = when (value) {
    "pending" -> "بانتظار التحصيل"
    "collected" -> "محصّل"
    "deposited" -> "مودع"
    "bounced" -> "مرتجع"
    "cancelled", "void" -> "ملغى"
    else -> value
}

/**
 * سطرُ مفتاح/قيمةٍ بقيمةٍ ملوّنة — بُنيةُ «KeyValue» المشتركةِ نفسُها لكن بلونِ قيمةٍ
 * من لوحة الحالات (كما يلوّنُ الموك-أبُ مبلغَ سندِ القبضِ بالأخضر).
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
