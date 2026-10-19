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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
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
import com.erpcloud.bakery.ui.components.PickerDialog
import com.erpcloud.bakery.ui.components.PickerItem
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.components.StatusChip
import com.erpcloud.bakery.util.Dec
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * شاشةُ أسعار العملاء — سجلُّ التسعير من لوحة الخطّ (سعرٌ لكلّ عميل/صنف، بسقفِ
 * مجانيٍّ وحدِّ ائتمانٍ وأجلِ دفع)، والكتابةُ upsert بإذنِ van_sales.pricing.manage.
 * حقلٌ واحدٌ يوقّع الخادمُ به التغيير: `changeReason` — سجلُّ التسعير يُحفظ
 * بالسعرِ السابق والجديد وسببِ التغيير ومن غيّره.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PricesScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    val dash = state.dashboard
    var showForm by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("أسعارُ العملاء") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
        floatingActionButton = {
            if (state.can("van_sales.pricing.manage")) {
                FloatingActionButton(onClick = { showForm = !showForm }) {
                    Icon(Icons.Default.Add, contentDescription = "سعر جديد")
                }
            }
        },
    ) { padding ->
        if (showForm) {
            PriceForm(vm = vm, onDone = { showForm = false })
            return@Scaffold
        }
        if (state.loadingDashboard && dash == null) {
            CenterLoading("جارٍ التحميل…", Modifier.padding(padding))
            return@Scaffold
        }
        val prices = dash?.customerPrices.orEmpty()
        if (prices.isEmpty()) {
            EmptyState("لا أسعارَ عملاءَ بعد — تُسجَّل من زرّ الإضافة.", Modifier.padding(padding))
            return@Scaffold
        }
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(prices, key = { it.id }) { price ->
                SectionCard(
                    title = "${price.partyName} — ${price.itemName}",
                    subtitle = "من ${Labels.dateOrDash(price.effectiveFrom)}" +
                        (price.effectiveTo?.let { " إلى $it" } ?: ""),
                ) {
                    KeyValue("سعرُ الوحدة", Dec.money(price.unitPrice) + " ر.س")
                    KeyValue("سقفُ المجاني", "${Dec.kg(price.maxBonusKgPerInvoice)} كجم (${Dec.kg(price.maxBonusPct)}%)")
                    KeyValue("وضعُ الفاتورة المفضَّل", Labels.invoiceMode(price.preferredInvoiceMode))
                    KeyValue("حدُّ الائتمان", Dec.money(price.creditLimit) + " ر.س")
                    KeyValue("أجلُ الدفع", "${price.paymentTermsDays} يومًا")
                    KeyValue("أقصى خصم", Dec.kg(price.maxDiscountPct) + "%")
                    if (price.lockPrice) StatusChip("السعرُ مقفول — لا يتغيّر على المندوب", ChipTone.INFO)
                    if (price.changeReason.isNotBlank()) KeyValue("سببُ آخر تغيير", price.changeReason)
                }
            }
            val history = dash?.customerPriceHistory.orEmpty()
            if (history.isNotEmpty()) {
                item {
                    SectionCard(title = "سجلُّ التسعير (آخر ${history.size} تغييرًا)") {
                        history.forEach { row ->
                            KeyValue(
                                "${row.partyName} · ${row.itemName}",
                                (row.previousUnitPrice?.let { Dec.money(it) } ?: "—") + " ← " +
                                    Dec.money(row.newUnitPrice) + " ر.س",
                            )
                        }
                    }
                }
            }
        }
    }
}

/** نموذجُ سعرٍ — upsert بلا مفتاح نيّة: المسارُ يوحّد السجلّ بالعميل/الصنف. */
@Composable
private fun PriceForm(vm: AppViewModel, onDone: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var sending by remember { mutableStateOf(false) }

    var partyId by rememberSaveable { mutableStateOf("") }
    var partyLabel by rememberSaveable { mutableStateOf("") }
    var itemId by rememberSaveable { mutableStateOf("") }
    var itemLabel by rememberSaveable { mutableStateOf("") }
    var unitPrice by rememberSaveable { mutableStateOf("") }
    var maxBonusPct by rememberSaveable { mutableStateOf("") }
    var maxBonusKg by rememberSaveable { mutableStateOf("") }
    var preferredInvoiceMode by rememberSaveable { mutableStateOf("zatca_tax") }
    var creditLimit by rememberSaveable { mutableStateOf("") }
    var paymentTermsDays by rememberSaveable { mutableStateOf("15") }
    var lockPrice by rememberSaveable { mutableStateOf(true) }
    var maxDiscountPct by rememberSaveable { mutableStateOf("") }
    var changeReason by rememberSaveable { mutableStateOf("") }
    var notes by rememberSaveable { mutableStateOf("") }
    var pickParty by remember { mutableStateOf(false) }
    var pickItem by remember { mutableStateOf(false) }
    var localError by remember { mutableStateOf<String?>(null) }

    LazyColumn(
        Modifier.fillMaxSize().padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            SectionCard(
                title = "تسجيلُ/تحديثُ سعر عميل",
                subtitle = "السجلُّ الموحَّدُ بالعميل والصنف — سببُ التغيير إلزاميٌّ في سجلّ التسعير",
            ) {
                OutlinedTextField(
                    value = partyLabel,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("العميل *") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { IconButton(onClick = { pickParty = true }) { Text("اختر") } },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = itemLabel,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("الصنف (اتركه فارغًا = جميع أصناف المخبز)") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { IconButton(onClick = { pickItem = true }) { Text("اختر") } },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = unitPrice,
                    onValueChange = { if (Dec.isValidInput(it)) unitPrice = it },
                    label = { Text("سعرُ الوحدة (ر.س) *") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = preferredInvoiceMode == "zatca_tax",
                        onClick = { preferredInvoiceMode = "zatca_tax" },
                        label = { Text("فاتورة ضريبيّة") },
                    )
                    FilterChip(
                        selected = preferredInvoiceMode == "internal_delivery",
                        onClick = { preferredInvoiceMode = "internal_delivery" },
                        label = { Text("تسليمٌ داخليّ") },
                    )
                }
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = maxBonusPct,
                    onValueChange = { if (Dec.isValidInput(it)) maxBonusPct = it },
                    label = { Text("أقصى مجاني (%)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = maxBonusKg,
                    onValueChange = { if (Dec.isValidInput(it)) maxBonusKg = it },
                    label = { Text("أقصى مجاني للفاتورة (كجم)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = creditLimit,
                    onValueChange = { if (Dec.isValidInput(it)) creditLimit = it },
                    label = { Text("حدُّ الائتمان (ر.س)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = paymentTermsDays,
                    onValueChange = { if (it.all { ch -> ch.isDigit() }) paymentTermsDays = it },
                    label = { Text("أجلُ الدفع (أيّام)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = maxDiscountPct,
                    onValueChange = { if (Dec.isValidInput(it)) maxDiscountPct = it },
                    label = { Text("أقصى خصم (%)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    Text("قفلُ السعر على المندوب", Modifier.weight(1f))
                    androidx.compose.material3.Switch(checked = lockPrice, onCheckedChange = { lockPrice = it })
                }
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = changeReason,
                    onValueChange = { changeReason = it },
                    label = { Text("سببُ التغيير *") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = notes,
                    onValueChange = { notes = it },
                    label = { Text("ملاحظات") },
                    modifier = Modifier.fillMaxWidth(),
                )
                if (localError != null) {
                    Spacer(Modifier.height(8.dp))
                    StatusChip(localError ?: "", ChipTone.DANGER)
                }
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ActionButton(
                        label = if (sending) "جارٍ الحفظ…" else "حفظُ السعر",
                        onClick = {
                            localError = when {
                                partyId.isBlank() -> "اختر العميل أولًا."
                                !Dec.isPositive(unitPrice) -> "سعرُ الوحدة يجب أن يكون رقمًا موجبًا."
                                changeReason.isBlank() -> "سببُ التغيير إلزاميّ."
                                else -> null
                            }
                            if (localError != null) return@ActionButton
                            sending = true
                            vm.upsertCustomerPrice(
                                buildJsonObject {
                                    put("partyId", partyId)
                                    if (itemId.isNotBlank()) put("itemId", itemId)
                                    put("unitPrice", Dec.wire(unitPrice))
                                    put("preferredInvoiceMode", preferredInvoiceMode)
                                    if (maxBonusPct.isNotBlank()) put("maxBonusPct", Dec.wire(maxBonusPct))
                                    if (maxBonusKg.isNotBlank()) put("maxBonusKgPerInvoice", Dec.wire(maxBonusKg))
                                    if (creditLimit.isNotBlank()) put("creditLimit", Dec.wire(creditLimit))
                                    if (paymentTermsDays.isNotBlank()) put("paymentTermsDays", paymentTermsDays.toInt())
                                    put("lockPrice", lockPrice)
                                    if (maxDiscountPct.isNotBlank()) put("maxDiscountPct", Dec.wire(maxDiscountPct))
                                    put("changeReason", changeReason.trim())
                                    if (notes.isNotBlank()) put("notes", notes.trim())
                                },
                            ) { result ->
                                sending = false
                                if (result is ActionResult.Synced) onDone()
                            }
                        },
                        enabled = !sending,
                        loading = sending,
                        modifier = Modifier.weight(1f),
                    )
                    ActionButton(
                        label = "رجوع",
                        onClick = onDone,
                        enabled = !sending,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }

    if (pickParty) {
        PickerDialog(
            title = "اختر العميل",
            items = state.parties.map { PickerItem(it.id, it.displayName, trailing = it.taxNo) },
            onDismiss = { pickParty = false },
            onSelect = { item ->
                partyId = item.id
                partyLabel = item.title
            },
        )
    }
    if (pickItem) {
        PickerDialog(
            title = "اختر الصنف (أو ألغِ = كلّ الأصناف)",
            items = state.items.map { PickerItem(it.id, it.label) },
            onDismiss = { pickItem = false },
            onSelect = { item ->
                itemId = item.id
                itemLabel = item.title
            },
        )
    }
}
