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
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableStateListOf
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
    var postTarget by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { vm.loadPurchases() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("المشتريات") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
        floatingActionButton = {
            if (!showCreate && state.can("purchase.invoice.create")) {
                FloatingActionButton(onClick = { showCreate = true }) {
                    Icon(Icons.Default.Add, contentDescription = "فاتورة جديدة")
                }
            }
        },
    ) { padding ->
        if (showCreate) {
            PurchaseInvoiceForm(
                vm = vm,
                onDone = { showCreate = false },
                onAddSupplier = { showCreate = false; showSupplier = true },
            )
            return@Scaffold
        }
        if (showSupplier) {
            SupplierForm(vm, onDone = { showSupplier = false; vm.loadPurchases() })
            return@Scaffold
        }
        if (state.staff.loadingKey == "purchases") {
            CenterLoading("جارٍ تحميل فواتير المشتريات…", Modifier.padding(padding))
            return@Scaffold
        }
        val invoices = state.staff.purchaseInvoices
        if (invoices.isEmpty()) {
            EmptyState(state.staff.error ?: "لا فواتيرَ مشترياتٍ بعد.", Modifier.padding(padding))
            return@Scaffold
        }
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(invoices, key = { it.id }) { invoice ->
                val (statusText, tone) = Labels.docStatus(invoice.status)
                SectionCard(
                    title = "فاتورة ${invoice.number.ifBlank { "—" }}",
                    subtitle = Labels.dateOrDash(invoice.invoiceDate ?: invoice.createdAt),
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
                    invoice.paidTotal?.let { KeyValue("المدفوع", Dec.money(it) + " ر.س") }
                    if (invoice.status == "draft" && state.can("purchase.invoice.post")) {
                        Spacer(Modifier.height(8.dp))
                        OutlinedButton(onClick = { postTarget = invoice.id }) { Text("ترحيلُ الفاتورة") }
                    }
                }
            }
            item {
                if (state.can("parties.manage")) {
                    OutlinedButton(onClick = { showSupplier = true }, modifier = Modifier.fillMaxWidth()) {
                        Text("+ إضافةُ مورّدٍ جديد")
                    }
                }
            }
        }
    }

    if (postTarget != null) {
        val id = postTarget ?: ""
        ConfirmDialog(
            title = "ترحيلُ فاتورة المشتريات",
            message = "الترحيلُ يُثبّت الفاتورةَ ويحرّك المخزونَ والذمّة — الفاتورةُ المسودّةُ الوحيدةُ القابلةُ للتعديل. هل تُرحّلها الآن؟",
            confirmLabel = "ترحيل",
            onDismiss = { postTarget = null },
            onConfirm = {
                postTarget = null
                vm.postPurchaseInvoice(id, buildJsonObject { put("settlement", "credit") }) { result ->
                    if (result is ActionResult.Synced) vm.loadPurchases()
                }
            },
        )
    }
}

/** إنشاءُ فاتورة مشتريات (مسودّة) — سطورٌ: صنفٌ + كميّةٌ + سعرٌ (نصوصٌ دقيقة). */
@Composable
private fun PurchaseInvoiceForm(vm: AppViewModel, onDone: () -> Unit, onAddSupplier: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var branchId by remember { mutableStateOf("") }
    var branchLabel by remember { mutableStateOf("") }
    var partyId by remember { mutableStateOf("") }
    var partyLabel by remember { mutableStateOf("") }
    var warehouseId by remember { mutableStateOf("") }
    var warehouseLabel by remember { mutableStateOf("") }
    var supplierRef by remember { mutableStateOf("") }
    var pickBranch by remember { mutableStateOf(false) }
    var pickParty by remember { mutableStateOf(false) }
    var pickWarehouse by remember { mutableStateOf(false) }
    var pickLineAt by remember { mutableStateOf(-1) }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    data class PurchaseLine(val itemId: String = "", val itemLabel: String = "", val qty: String = "", val price: String = "")
    val lines = remember { mutableStateListOf(PurchaseLine(), PurchaseLine()) }

    // الفرعُ الافتراضيّ يُقترح مرّةً.
    androidx.compose.runtime.LaunchedEffect(state.staff.branches) {
        if (branchId.isBlank()) {
            (state.staff.branches.firstOrNull { it.isDefault } ?: state.staff.branches.firstOrNull())
                ?.let { branchId = it.id; branchLabel = it.nameAr }
        }
    }

    LazyColumn(
        Modifier.fillMaxSize().padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            SectionCard(title = "فاتورةُ مشترياتٍ جديدة", subtitle = "تُنشأ مسودّةً — والترحيلُ بعد التسجيل") {
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
                    value = partyLabel,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("المورّد *") },
                    placeholder = { Text("اختر المورّد") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = {
                        Row {
                            if (state.can("parties.manage")) {
                                TextButton(onClick = onAddSupplier) { Text("مورّدٌ جديد") }
                            }
                            IconButton(onClick = { pickParty = true }) { Text("اختر") }
                        }
                    },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = warehouseLabel,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("مستودعُ الاستلام") },
                    placeholder = { Text("افتراضيُّ الفرع") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { IconButton(onClick = { pickWarehouse = true }) { Text("اختر") } },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = supplierRef, onValueChange = { supplierRef = it }, label = { Text("مرجعُ المورّد (رقمُ فاتورته)") }, modifier = Modifier.fillMaxWidth())
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
                OutlinedButton(onClick = { lines.add(PurchaseLine()) }, modifier = Modifier.fillMaxWidth()) { Text("+ أضف سطرًا") }
                Spacer(Modifier.height(6.dp))
                val valid = lines.filter { it.itemId.isNotBlank() && Dec.isPositive(it.qty) && Dec.isPositive(it.price) }
                if (valid.isNotEmpty()) {
                    var total = java.math.BigDecimal.ZERO
                    valid.forEach { line ->
                        total = total.add(Dec.orZero(line.qty).multiply(Dec.orZero(line.price)))
                    }
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
                                partyId.isBlank() -> "اختر المورّد."
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
                                put("partyId", partyId)
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
                                                }
                                            )
                                        }
                                    },
                                )
                            }
                            vm.createPurchaseInvoice(body) { result ->
                                sending = false
                                if (result is ActionResult.Synced) {
                                    vm.loadPurchases()
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
    if (pickParty) {
        PickerDialog(
            title = "اختر المورّد",
            items = state.staff.suppliers.map { PickerItem(it.id, it.displayName) },
            onDismiss = { pickParty = false },
            onSelect = { partyId = it.id; partyLabel = it.title },
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
