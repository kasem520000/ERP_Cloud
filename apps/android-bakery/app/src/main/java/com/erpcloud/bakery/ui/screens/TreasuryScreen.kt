package com.erpcloud.bakery.ui.screens

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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
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
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.data.ActionResult
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.ActionButton
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.ConfirmDialog
import com.erpcloud.bakery.ui.components.EmptyState
import com.erpcloud.bakery.ui.components.KeyValue
import com.erpcloud.bakery.ui.components.PickerDialog
import com.erpcloud.bakery.ui.components.PickerItem
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.components.StatusChip
import com.erpcloud.bakery.util.Dec
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * شاشةُ الخزينة والمصروفات — سنداتُ القبض والصرف (من تطبيق الويب `frmSandQ/frmSandD`):
 * المصروفُ اليوميّ (غاز/صيانة/ضيافة) وسندُ القبض اليدويّ، ثمّ **الترحيل** الذي
 * يُقيّد في الدفتر ويحرّك رصيد الصندوق.
 *
 * القاعدةُ كما في الويب: السندُ يُنشأ **مسودّةً**؛ والترحيلُ بإذن `treasury.voucher.post`.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TreasuryScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var showCreate by remember { mutableStateOf(false) }
    var postTarget by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { vm.loadTreasury() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("الخزينة والمصروفات") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
        floatingActionButton = {
            if (!showCreate && state.can("treasury.voucher.create")) {
                FloatingActionButton(onClick = { showCreate = true }) {
                    Icon(Icons.Default.Add, contentDescription = "سند جديد")
                }
            }
        },
    ) { padding ->
        if (showCreate) {
            VoucherForm(vm, onDone = { showCreate = false })
            return@Scaffold
        }
        if (state.staff.loadingKey == "treasury") {
            CenterLoading("جارٍ تحميل السندات…", Modifier.padding(padding))
            return@Scaffold
        }
        val vouchers = state.staff.treasuryVouchers
        if (vouchers.isEmpty()) {
            EmptyState(state.staff.error ?: "لا سنداتَ بعد.", Modifier.padding(padding))
            return@Scaffold
        }
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(vouchers, key = { it.id }) { voucher ->
                val (kindText, kindTone) = Labels.voucherFlow(voucher.kind)
                val (statusText, statusTone) = Labels.docStatus(voucher.status)
                SectionCard(
                    title = "$kindText ${voucher.number.ifBlank { "—" }}",
                    subtitle = Labels.dateOrDash(voucher.date),
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        StatusChip(kindText, kindTone)
                        StatusChip(Labels.voucherSubtype(voucher.subtype), ChipTone.NEUTRAL)
                        StatusChip(statusText, statusTone)
                    }
                    Spacer(Modifier.height(6.dp))
                    KeyValue("المبلغ", Dec.money(voucher.amount) + " ر.س", )
                    KeyValue("الطريقة", Labels.voucherMethod(voucher.method))
                    state.staff.cashLocations.firstOrNull { it.id == voucher.cashLocationId }?.let {
                        KeyValue("الخزينة", it.name)
                    }
                    state.staff.parties.firstOrNull { it.id == voucher.partyId }?.let { KeyValue("الطرف", it.displayName) }
                    voucher.chequeNo?.takeIf { it.isNotBlank() }?.let { KeyValue("رقمُ الشيك", it) }
                    voucher.description?.takeIf { it.isNotBlank() }?.let { KeyValue("البيان", it) }
                    voucher.recipient?.takeIf { it.isNotBlank() }?.let { KeyValue("المستلم", it) }
                    if (voucher.status == "draft" && state.can("treasury.voucher.post")) {
                        Spacer(Modifier.height(8.dp))
                        OutlinedButton(onClick = { postTarget = voucher.id }) { Text("ترحيلُ السند") }
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
}

/** إنشاءُ سند قبض/صرف — مسودّةٌ تُرحَّل بعد الحفظ (الأطراف والحساب المقابل اختياريّان). */
@Composable
private fun VoucherForm(vm: AppViewModel, onDone: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var kind by remember { mutableStateOf("payment") }
    var subtype by remember { mutableStateOf("expense") }
    var subtypeLabel by remember { mutableStateOf("مصروف") }
    var branchId by remember { mutableStateOf("") }
    var branchLabel by remember { mutableStateOf("") }
    var cashLocationId by remember { mutableStateOf("") }
    var cashLabel by remember { mutableStateOf("") }
    var method by remember { mutableStateOf("cash") }
    var methodLabel by remember { mutableStateOf("نقدي") }
    var amount by remember { mutableStateOf("") }
    var date by remember { mutableStateOf(todayIso()) }
    var description by remember { mutableStateOf("") }
    var partyId by remember { mutableStateOf("") }
    var partyLabel by remember { mutableStateOf("") }
    var counterAccountId by remember { mutableStateOf("") }
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
        }
        if (cashLocationId.isBlank()) {
            state.staff.cashLocations.firstOrNull()?.let { cashLocationId = it.id; cashLabel = it.name }
        }
    }
    // الأطرافُ تُحمَّل عند اختيار تصنيفٍ يحتاجها (عميل/مورّد)، والحساباتُ للمصروف.
    LaunchedEffect(subtype) {
        if (subtype == "customer" || subtype == "supplier") {
            if (state.staff.parties.isEmpty()) vm.loadParties(if (subtype == "customer") "customer" else "supplier")
        } else if (subtype == "expense" && state.staff.accounts.isEmpty()) {
            vm.loadAccounts()
        }
    }

    LazyColumn(
        Modifier.fillMaxSize().padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            SectionCard(
                title = "سندٌ جديد",
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
                    label = { Text("التصنيف *") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { IconButton(onClick = { pickSubtype = true }) { Text("اختر") } },
                )
                Spacer(Modifier.height(8.dp))
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
                    value = cashLabel,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("الخزينة *") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { IconButton(onClick = { pickCash = true }) { Text("اختر") } },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = methodLabel,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("طريقةُ الدفع") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { IconButton(onClick = { pickMethod = true }) { Text("اختر") } },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = amount,
                    onValueChange = { if (Dec.isValidInput(it)) amount = it },
                    label = { Text("المبلغ (ر.س) *") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = date, onValueChange = { date = it }, label = { Text("التاريخ (YYYY-MM-DD)") }, modifier = Modifier.fillMaxWidth())
                if (subtype == "customer" || subtype == "supplier") {
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = partyLabel,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("الطرف (يحسمُ الحسابَ المقابل تلقائيًّا)") },
                        modifier = Modifier.fillMaxWidth(),
                        trailingIcon = { IconButton(onClick = { pickParty = true }) { Text("اختر") } },
                    )
                }
                if (subtype == "expense") {
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = accountLabel,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("حسابُ المصروف (اختياريّ — من دليل الحسابات)") },
                        modifier = Modifier.fillMaxWidth(),
                        trailingIcon = { IconButton(onClick = { pickAccount = true }) { Text("اختر") } },
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
                        label = if (sending) "جارٍ الحفظ…" else "حفظُ السند",
                        onClick = {
                            error = when {
                                branchId.isBlank() -> "اختر الفرع."
                                cashLocationId.isBlank() -> "اختر الخزينة."
                                !Dec.isPositive(amount) -> "المبلغُ رقمٌ موجبٌ (نصٌّ دقيق)."
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
                                if (partyId.isNotBlank()) put("partyId", partyId)
                                if (counterAccountId.isNotBlank()) put("counterAccountId", counterAccountId)
                                put("description", description.trim())
                            }
                            val withKey = vm.ensureIdempotencyKey("bakery-voucher-flow", body, null)
                            vm.createTreasuryVoucher(withKey) { result ->
                                sending = false
                                if (result is ActionResult.Synced) {
                                    vm.loadTreasury()
                                    onDone()
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
            items = state.staff.cashLocations.map { PickerItem(it.id, it.name, trailing = if (it.isDefault) "افتراضيّة" else null) },
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
                PickerItem("cheque", "شيك"),
                PickerItem("card", "شبكة"),
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
        PickerDialog(
            title = if (subtype == "supplier") "اختر المورّد" else "اختر العميل",
            items = state.staff.parties.map { PickerItem(it.id, it.displayName, trailing = it.phone) },
            onDismiss = { pickParty = false },
            onSelect = { partyId = it.id; partyLabel = it.title; pickParty = false },
        )
    }
    if (pickAccount) {
        PickerDialog(
            title = "حسابُ المصروف",
            items = state.staff.accounts.filter { it.postable }.map { PickerItem(it.id, it.label, trailing = it.code) },
            onDismiss = { pickAccount = false },
            onSelect = { counterAccountId = it.id; accountLabel = it.title; pickAccount = false },
        )
    }
}
