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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
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
import com.erpcloud.bakery.data.api.PosCheckoutReceiptDto
import com.erpcloud.bakery.data.api.PosItemDto
import com.erpcloud.bakery.printing.posReceipt
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.EmptyState
import com.erpcloud.bakery.ui.components.KeyValue
import com.erpcloud.bakery.ui.components.PickerDialog
import com.erpcloud.bakery.ui.components.PickerItem
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.components.StatusChip
import com.erpcloud.bakery.util.Dec
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.math.BigDecimal

/**
 * شاشةُ نقطة البيع (من تطبيق الطاقم) — بيعٌ فوريّ على الفرع:
 * أصنافُ `showInPos` من `pos/offline-data`، سلّةٌ بكميّاتٍ وأسعار، ثمّ
 * `pos/checkout` بطريقةِ دفعٍ (نقد/شبكة/تحويل/آجلٌ لعميلٍ مسجّل).
 *
 * الإيصالُ يُطبعُ فور نجاح البيعة (ESC/POS بلوتوث أو طباعة النظام) —
 * ورقمُ الفاتورة من الخادم لا يُخترع.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PosScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    val pos = state.staff.posData
    var search by remember { mutableStateOf("") }
    var categoryFilter by remember { mutableStateOf("") }
    var pickCategory by remember { mutableStateOf(false) }
    var showPay by remember { mutableStateOf(false) }
    val cart = remember { mutableStateListOf<PosCartLine>() }
    val scope = androidx.compose.runtime.rememberCoroutineScope()

    LaunchedEffect(Unit) { vm.loadPos() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("نقطة البيع") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
    ) { padding ->
        if (state.staff.loadingKey == "pos") {
            CenterLoading("جارٍ تحميل أصناف نقطة البيع…", Modifier.padding(padding))
            return@Scaffold
        }
        if (pos == null) {
            EmptyState(
                state.staff.error
                    ?: if (!state.can("pos.view")) "حسابُك لا يحمل إذنَ pos.view — لن تفتح الشاشةُ عند الخادم."
                    else "تعذّر تحميل بيانات نقطة البيع.",
                Modifier.padding(padding),
            )
            return@Scaffold
        }

        Column(Modifier.fillMaxSize().padding(padding).padding(horizontal = 14.dp)) {
            // ------------------------------------------------ السلّة
            if (cart.isEmpty()) {
                StatusChip("السلّةُ فارغة — اختر الأصناف من الأسفل", ChipTone.NEUTRAL)
            } else {
                SectionCard(title = "السلّة", subtitle = "${cart.size} صنفًا") {
                    cart.forEachIndexed { index, line ->
                        Row(
                            Modifier.fillMaxWidth().padding(vertical = 2.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1.2f)) {
                                Text(line.item.nameAr, style = MaterialTheme.typography.bodyMedium)
                                Text(
                                    "${Dec.money(line.qty)} × ${Dec.money(line.price)} ر.س",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                                IconButton(onClick = { line.dec() }) { Text("−") }
                                Text(line.qty, style = MaterialTheme.typography.bodyMedium)
                                IconButton(onClick = { line.inc() }) { Text("+") }
                                IconButton(onClick = { cart.removeAt(index) }) { Text("✕") }
                            }
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                    KeyValue("الإجماليُّ قبل الضريبة", Dec.money(cartSubtotal(cart).toPlainString()) + " ر.س")
                    if (state.can("pos.operate") && state.can("sales.invoice.post")) {
                        Spacer(Modifier.height(8.dp))
                        OutlinedButton(onClick = { showPay = true }, modifier = Modifier.fillMaxWidth()) {
                            Text("إتمامُ البيعة والدفع")
                        }
                    } else {
                        Spacer(Modifier.height(6.dp))
                        StatusChip("إتمامُ البيعة يحتاج إذنَي pos.operate و sales.invoice.post", ChipTone.WARN)
                    }
                }
            }
            Spacer(Modifier.height(10.dp))

            // ------------------------------------------------ تصفية الأصناف
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = search,
                    onValueChange = { search = it },
                    label = { Text("بحثٌ بالاسم/الباركود") },
                    modifier = Modifier.weight(1f),
                )
                OutlinedButton(
                    onClick = { pickCategory = true },
                    modifier = Modifier.height(56.dp),
                ) {
                    Text(
                        pos.categories.firstOrNull { it.id == categoryFilter }?.nameAr
                            ?: if (categoryFilter == "none") "بلا مجموعة" else "كلُّ المجموعات",
                    )
                }
            }
            Spacer(Modifier.height(10.dp))

            // ------------------------------------------------ الأصناف
            val filtered = pos.items.filter { item ->
                (categoryFilter.isBlank() || (if (categoryFilter == "none") item.categoryId == null else item.categoryId == categoryFilter)) &&
                    (search.isBlank() ||
                        item.nameAr.contains(search.trim(), ignoreCase = true) ||
                        item.sku.contains(search.trim(), ignoreCase = true) ||
                        item.barcode?.contains(search.trim()) == true)
            }
            if (filtered.isEmpty()) {
                EmptyState("لا أصنافَ مطابقةً في نقطة البيع.")
            } else {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 20.dp),
                ) {
                    items(filtered, key = { it.id }) { item ->
                        PosItemRow(item) { addToCart(cart, item) }
                    }
                }
            }
        }
    }

    if (pickCategory) {
        PickerDialog(
            title = "مجموعةُ الأصناف",
            items = listOf(PickerItem("", "كلُّ المجموعات"), PickerItem("none", "بلا مجموعة")) +
                (pos?.categories ?: emptyList()).map { PickerItem(it.id, it.nameAr) },
            onDismiss = { pickCategory = false },
            onSelect = {
                categoryFilter = it.id
                pickCategory = false
            },
        )
    }
    if (showPay && pos != null) {
        PayDialog(
            vm = vm,
            subtotal = cartSubtotal(cart),
            customers = pos.customers,
            cashLocations = pos.cashLocations,
            defaults = pos.defaults,
            onConfirm = { method, partyId, cashLocationId ->
                showPay = false
                val checkoutBranchId = pos.defaults.branchId
                    ?: pos.branches.firstOrNull()?.id.orEmpty()
                val body = buildJsonObject {
                    put("branchId", checkoutBranchId)
                    pos.defaults.warehouseId?.let { put("warehouseId", it) }
                    if (partyId.isNotBlank()) put("partyId", partyId)
                    put(
                        "lines",
                        buildJsonArray {
                            cart.forEach { line ->
                                add(
                                    buildJsonObject {
                                        put("itemId", line.item.id)
                                        put("quantity", Dec.wire(line.qty))
                                        put("unitPrice", Dec.wire(line.price))
                                    }
                                )
                            }
                        },
                    )
                    put(
                        "payment",
                        buildJsonObject {
                            put("method", method)
                            if (cashLocationId.isNotBlank()) put("cashLocationId", cashLocationId)
                        },
                    )
                }
                val withKey = vm.ensureIdempotencyKey("bakery-pos", body, null)
                vm.posCheckout(withKey) { receipt ->
                    if (receipt != null) {
                        cart.clear()
                        // طباعةُ الإيصال فور النجاح — على IO كما في بقية الطباعة.
                        scope.launch {
                            try {
                                val context = vm.androidContext()
                                val mac = state.session.printerMac
                                val width = state.session.printerWidthDots
                                val bitmap = withContext(kotlinx.coroutines.Dispatchers.IO) {
                                    val rendered = posReceipt(
                                        receipt, cartTotalsSnapshot(withKey),
                                    )
                                    if (mac.isNotBlank()) {
                                        com.erpcloud.bakery.printing.EscPos.printBitmap(context, mac, width, rendered)
                                    }
                                    rendered
                                }
                                if (mac.isBlank()) {
                                    com.erpcloud.bakery.printing.PrintKit.printViaSystem(
                                        context, bitmap, "إيصال ${receipt.number}",
                                    )
                                }
                            } catch (error: Exception) {
                                vm.showPrintError(error.message ?: "تعذّرت طباعةُ الإيصال")
                            }
                        }
                    }
                }
            },
            onDismiss = { showPay = false },
        )
    }
}

/** سطرُ سلّةٍ — الصنفُ والكميّةُ (نصٌّ دقيق) والسعرُ كما جاء من الكتالوج. */
private class PosCartLine(val item: PosItemDto) {
    var qty by mutableStateOf("1")
    var price: String = item.salePrice ?: "0"
    fun inc() {
        val next = (Dec.orZero(qty).add(BigDecimal.ONE)).toPlainString()
        qty = next
    }
    fun dec() {
        val current = Dec.orZero(qty)
        if (current.signum() > 1) qty = current.subtract(BigDecimal.ONE).toPlainString()
    }
}

private fun addToCart(cart: androidx.compose.runtime.snapshots.SnapshotStateList<PosCartLine>, item: PosItemDto) {
    val existing = cart.firstOrNull { it.item.id == item.id }
    if (existing != null) existing.inc() else cart.add(PosCartLine(item))
}

private fun cartSubtotal(cart: List<PosCartLine>): BigDecimal {
    var total = BigDecimal.ZERO
    cart.forEach { line ->
        total = total.add(Dec.orZero(line.qty).multiply(Dec.orZero(line.price)))
    }
    return total
}

/** لقطةُ إجمالياتِ السلّة للطباعة — تُحسب من الجسم المُرسَل نفسه لا من واجهةٍ أخرى. */
private fun cartTotalsSnapshot(body: kotlinx.serialization.json.JsonObject): BigDecimal {
    var total = BigDecimal.ZERO
    val lines = body["lines"] as? kotlinx.serialization.json.JsonArray ?: return BigDecimal.ZERO
    lines.forEach { element ->
        val obj = element as? kotlinx.serialization.json.JsonObject ?: return@forEach
        val qty = Dec.orZero((obj["quantity"] as? kotlinx.serialization.json.JsonPrimitive)?.content)
        val price = Dec.orZero((obj["unitPrice"] as? kotlinx.serialization.json.JsonPrimitive)?.content)
        total = total.add(qty.multiply(price))
    }
    return total
}

@Composable
private fun PosItemRow(item: PosItemDto, onAdd: () -> Unit) {
    SectionCard(title = item.nameAr, subtitle = "SKU: ${item.sku.ifBlank { "—" }}") {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
        ) {
            Text(
                (item.salePrice?.let { Dec.money(it) + " ر.س" } ?: "بلا سعرِ بيعٍ — يُدخل يدويًّا"),
                style = MaterialTheme.typography.bodyMedium,
                color = if (item.salePrice != null) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.error,
            )
            androidx.compose.material3.FilledTonalButton(onClick = onAdd) { Text("+ للسلّة") }
        }
    }
}

/** حوارُ الدفع — طريقةُ الدفع + العميلُ (للآجل) + الخزينةُ (للنقد). */
@Composable
private fun PayDialog(
    vm: AppViewModel,
    subtotal: BigDecimal,
    customers: List<com.erpcloud.bakery.data.api.PosCustomerDto>,
    cashLocations: List<com.erpcloud.bakery.data.api.CashLocationDto>,
    defaults: com.erpcloud.bakery.data.api.PosDefaultsDto,
    onConfirm: (method: String, partyId: String, cashLocationId: String) -> Unit,
    onDismiss: () -> Unit,
) {
    var method by remember { mutableStateOf("cash") }
    var partyId by remember { mutableStateOf("") }
    var partyLabel by remember { mutableStateOf("") }
    var cashLocationId by remember { mutableStateOf(defaults.cashLocationId ?: "") }
    var cashLabel by remember { mutableStateOf("") }
    var pickCustomer by remember { mutableStateOf(false) }
    var pickCash by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(cashLocations) {
        if (cashLocationId.isBlank() && defaults.cashLocationId == null) {
            cashLocations.firstOrNull()?.let { cashLocationId = it.id; cashLabel = it.name }
        } else {
            cashLocations.firstOrNull { it.id == cashLocationId }?.let { cashLabel = it.name }
        }
    }

    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("إتمامُ البيعة") },
        text = {
            Column {
                KeyValue("الإجماليُّ قبل الضريبة", Dec.money(subtotal.toPlainString()) + " ر.س")
                Text(
                    "الضريبةُ تُحسبُ عند الخادم حسب مجموعة الصنف — المبلغُ النهائيّ في الإيصال.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(10.dp))
                listOf(
                    "cash" to "نقدي",
                    "card" to "شبكة",
                    "bank" to "تحويل بنكي",
                    "credit" to "آجل (عميلٌ مسجّل)",
                ).forEach { (value, labelAr) ->
                    Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                        androidx.compose.material3.RadioButton(
                            selected = method == value,
                            onClick = { method = value },
                        )
                        Text(labelAr)
                    }
                }
                if (method == "credit") {
                    Spacer(Modifier.height(6.dp))
                    OutlinedTextField(
                        value = partyLabel,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("العميل * (الآجلُ يحتاج عميلًا مسجّلًا)") },
                        modifier = Modifier.fillMaxWidth(),
                        trailingIcon = { IconButton(onClick = { pickCustomer = true }) { Text("اختر") } },
                    )
                }
                if (method == "cash") {
                    Spacer(Modifier.height(6.dp))
                    OutlinedTextField(
                        value = cashLabel,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("الخزينة *") },
                        modifier = Modifier.fillMaxWidth(),
                        trailingIcon = { IconButton(onClick = { pickCash = true }) { Text("اختر") } },
                    )
                }
                if (error != null) {
                    Spacer(Modifier.height(6.dp))
                    StatusChip(error ?: "", ChipTone.DANGER)
                }
            }
        },
        confirmButton = {
            androidx.compose.material3.TextButton(
                onClick = {
                    error = when {
                        method == "credit" && partyId.isBlank() -> "البيعُ الآجل يحتاج عميلًا مسجّلًا — الخادمُ يرفض بلا partyId."
                        method == "cash" && cashLocationId.isBlank() -> "اختر الخزينةَ للنقد."
                        else -> null
                    }
                    if (error != null) return@TextButton
                    onConfirm(method, partyId, cashLocationId)
                },
            ) { Text("دفعٌ وإتمام") }
        },
        dismissButton = {
            androidx.compose.material3.TextButton(onClick = onDismiss) { Text("إلغاء") }
        },
    )

    if (pickCustomer) {
        PickerDialog(
            title = "اختر العميل",
            items = customers.map { PickerItem(it.id, it.name, trailing = it.mobile) },
            onDismiss = { pickCustomer = false },
            onSelect = { partyId = it.id; partyLabel = it.title; pickCustomer = false },
        )
    }
    if (pickCash) {
        PickerDialog(
            title = "اختر الخزينة",
            items = cashLocations.map { PickerItem(it.id, it.name, trailing = if (it.isDefault) "افتراضيّة" else null) },
            onDismiss = { pickCash = false },
            onSelect = { cashLocationId = it.id; cashLabel = it.title; pickCash = false },
        )
    }
}
