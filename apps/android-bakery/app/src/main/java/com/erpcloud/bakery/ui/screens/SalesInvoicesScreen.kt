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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
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
import com.erpcloud.bakery.ui.components.EmptyState
import com.erpcloud.bakery.ui.components.KeyValue
import com.erpcloud.bakery.ui.components.MissingPermissionHint
import com.erpcloud.bakery.ui.components.PickerDialog
import com.erpcloud.bakery.ui.components.PickerItem
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.components.StatusChip
import com.erpcloud.bakery.util.Dec
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

    LaunchedEffect(Unit) { vm.loadSalesInvoices() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("فواتير المبيعات والمردودات") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
        floatingActionButton = {
            if (!showCreate && state.can("sales.invoice.create")) {
                FloatingActionButton(onClick = { showCreate = true }) {
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
        if (state.staff.loadingKey == "sales-invoices") {
            CenterLoading("جارٍ تحميل فواتير المبيعات…", Modifier.padding(padding))
            return@Scaffold
        }
        val invoices = state.staff.salesInvoices
        if (invoices.isEmpty()) {
            EmptyState(state.staff.error ?: "لا فواتيرَ بعد.", Modifier.padding(padding))
            return@Scaffold
        }
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(invoices, key = { it.id }) { invoice ->
                val (kindText, kindTone) = Labels.documentKind(invoice.kind)
                val (statusText, tone) = Labels.docStatus(invoice.status)
                SectionCard(
                    title = "فاتورة ${invoice.number.ifBlank { "—" }}",
                    subtitle = Labels.dateOrDash(invoice.invoiceDate ?: invoice.createdAt),
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
                    invoice.paidTotal?.let { KeyValue("المدفوع", Dec.money(it) + " ر.س") }
                    if (invoice.status == "draft" && state.can("sales.invoice.post")) {
                        Spacer(Modifier.height(8.dp))
                        OutlinedButton(onClick = { postTarget = invoice.id }) { Text("ترحيلُ الفاتورة") }
                    }
                    if (invoice.status == "posted" && invoice.kind == "sale" && state.can("sales.return.create")) {
                        Spacer(Modifier.height(6.dp))
                        OutlinedButton(onClick = { returnTarget = invoice.id }) { Text("مردودُ مبيعات من هذه الفاتورة") }
                    }
                }
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

    returnTarget?.let { id ->
        ReturnForm(
            vm = vm,
            sourceId = id,
            onDone = { returnTarget = null; vm.loadSalesInvoices() },
        )
    }
}

/** حوارُ الترحيل — آجلٌ على الذمّة (الافتراضي) أو نقديٌّ على حسابِ صندوقٍ/بنك. */
@Composable
private fun PostInvoiceDialog(
    vm: AppViewModel,
    onDismiss: () -> Unit,
    onPost: (settlement: String, accountId: String?) -> Unit,
) {
    val state by vm.uiState.collectAsState()
    var cash by remember { mutableStateOf(false) }
    var pickAccount by remember { mutableStateOf(false) }
    var accountId by remember { mutableStateOf<String?>(null) }
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
                    label = if (accountId == null) "نقديّ — اختر حساب الصندوق" else "نقديّ — على ${state.staff.accounts.firstOrNull { it.id == accountId }?.let { "${it.code} ${it.nameAr ?: ""}" } ?: ""}",
                    onClick = { pickAccount = true },
                    enabled = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
    if (pickAccount) {
        PickerDialog(
            title = "حسابُ الصندوق/البنك",
            items = state.staff.accounts
                .filter { it.isPostable != false }
                .map { PickerItem(it.id, "${it.code} — ${it.nameAr ?: it.nameEn ?: ""}") },
            onDismiss = { pickAccount = false },
            onSelect = { accountId = it.id; pickAccount = false; onPost("cash", it.id) },
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
 * نموذجُ إنشاءِ فاتورة مبيعات (مسودّة) — عميلٌ من السجلّ أو عميلٌ نقديٌّ بالاسم،
 * والسطورُ صنفٌ وكميّةٌ وسعر. الجسمُ مطابقٌ لِما قبِلَه الخادمُ حرفيًّا
 * (orderType: counter + lines[{itemId, quantity, unitPrice}]).
 */
@Composable
private fun SalesInvoiceForm(vm: AppViewModel, onDone: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var branchId by remember { mutableStateOf("") }
    var branchLabel by remember { mutableStateOf("") }
    var warehouseId by remember { mutableStateOf("") }
    var warehouseLabel by remember { mutableStateOf("") }
    var partyId by remember { mutableStateOf("") }
    var partyLabel by remember { mutableStateOf("") }
    var cashName by remember { mutableStateOf("") }
    var pickBranch by remember { mutableStateOf(false) }
    var pickWarehouse by remember { mutableStateOf(false) }
    var pickParty by remember { mutableStateOf(false) }
    var pickLineAt by remember { mutableStateOf(-1) }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }
    val lines = remember { mutableStateListOf(SaleLine()) }

    LaunchedEffect(state.staff.branches) {
        if (branchId.isBlank()) {
            (state.staff.branches.firstOrNull { it.isDefault } ?: state.staff.branches.firstOrNull())
                ?.let { branchId = it.id; branchLabel = it.nameAr }
        }
    }
    LaunchedEffect(state.warehouses, state.dashboard?.mainWarehouseId) {
        if (warehouseId.isBlank()) {
            (state.warehouses.firstOrNull { it.id == state.dashboard?.mainWarehouseId }
                ?: state.warehouses.firstOrNull { it.isDefault == true })
                ?.let { warehouseId = it.id; warehouseLabel = it.label }
        }
    }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            SectionCard(title = "فاتورةُ مبيعاتٍ جديدة", subtitle = "تُنشأُ مسودّةً ثمّ تُرحَّل — العميلُ من السجلّ أو نقديٌّ بالاسم") {
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
                        label = if (sending) "جارٍ الحفظ…" else "حفظُ المسودّة",
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
                                                },
                                            )
                                        }
                                    },
                                )
                            }
                            vm.createSalesInvoice(body) { result ->
                                sending = false
                                if (result is ActionResult.Synced) {
                                    vm.loadSalesInvoices()
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

/**
 * نموذجُ **مردود المبيعات** من فاتورةٍ مرحّلة — المصدرُ إلزامًا مرحّل، والسطورُ
 * بكميّاتٍ لا تتجاوزُ المباعة (يفحصُها الخادمُ ويقولُها بالعربيّةِ إن خالفت).
 */
@Composable
private fun ReturnForm(vm: AppViewModel, sourceId: String, onDone: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }
    var pickLineAt by remember { mutableStateOf(-1) }
    val lines = remember { mutableStateListOf(SaleLine()) }
    val source = state.staff.salesInvoices.firstOrNull { it.id == sourceId }

    SectionCard(title = "مردودُ مبيعات", subtitle = "من الفاتورة ${source?.number ?: ""} — كميّاتٌ ممّا بيع فعلًا", modifier = Modifier.padding(14.dp)) {
        lines.forEachIndexed { index, line ->
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
                    label = { Text("الكميّة المرجعة *") },
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
            }
            Spacer(Modifier.height(4.dp))
        }
        OutlinedButton(onClick = { lines.add(SaleLine()) }, modifier = Modifier.fillMaxWidth()) { Text("+ أضف سطرًا") }
        if (error != null) {
            Spacer(Modifier.height(8.dp))
            StatusChip(error ?: "", ChipTone.DANGER)
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ActionButton(
                label = if (sending) "جارٍ الحفظ…" else "حفظُ المردود",
                onClick = {
                    val validLines = lines.filter { it.itemId.isNotBlank() }
                    error = when {
                        validLines.isEmpty() -> "أضف صنفًا مرجعًا واحدًا على الأقلّ."
                        validLines.any { !Dec.isPositive(it.qty) || !Dec.isPositive(it.price) } -> "الكميّةُ والسعرُ لكلّ سطرٍ رقمان موجبان."
                        else -> null
                    }
                    if (error != null) return@ActionButton
                    sending = true
                    val body = buildJsonObject {
                        put("branchId", source?.branchId ?: state.staff.branches.firstOrNull()?.id ?: "")
                        source?.warehouseId?.let { put("warehouseId", it) }
                        val sourceParty = source?.partyId
                        if (!sourceParty.isNullOrBlank()) put("partyId", sourceParty)
                        else put("cashCustomerName", source?.cashCustomerName ?: "عميل عام")
                        put(
                            "lines",
                            kotlinx.serialization.json.buildJsonArray {
                                validLines.forEach { line ->
                                    add(
                                        buildJsonObject {
                                            put("itemId", line.itemId)
                                            put("quantity", Dec.wire(line.qty))
                                            put("unitPrice", Dec.wire(line.price))
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
