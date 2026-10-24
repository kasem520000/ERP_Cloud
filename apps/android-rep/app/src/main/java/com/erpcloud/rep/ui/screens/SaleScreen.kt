@file:OptIn(ExperimentalMaterial3Api::class)

package com.erpcloud.rep.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.PointOfSale
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.erpcloud.rep.data.ActionResult
import com.erpcloud.rep.data.api.SaleRequest
import com.erpcloud.rep.data.offline.QueueOperation
import com.erpcloud.rep.ui.AppViewModel
import com.erpcloud.rep.ui.SubmitOutcome
import com.erpcloud.rep.ui.components.ActionButton
import com.erpcloud.rep.ui.components.PickerDialog
import com.erpcloud.rep.ui.components.PickerItem
import com.erpcloud.rep.ui.components.SectionCard
import com.erpcloud.rep.util.Dec

/**
 * شاشةُ مستندِ البيع — البيعُ من أمر تحميل المندوب نفسه فقط، والعميلُ بطاقةٌ أو
 * اسمٌ نقديّ، والجسمُ يحمل مفتاحَ عدم تكرارٍ واحدًا للنيّةِ الواحدة.
 */
@Composable
fun SaleScreen(vm: AppViewModel, onDone: () -> Unit) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val workspace = state.workspace

    var loadOrderId by rememberSaveable { mutableStateOf("") }
    var registeredCustomer by rememberSaveable { mutableStateOf(false) }
    var partyId by rememberSaveable { mutableStateOf("") }
    var customerName by rememberSaveable { mutableStateOf("") }
    var invoiceMode by rememberSaveable { mutableStateOf("zatca_tax") }
    var paymentMethod by rememberSaveable { mutableStateOf("cash") }
    var soldQty by rememberSaveable { mutableStateOf("") }
    var bonusQty by rememberSaveable { mutableStateOf("") }
    var bonusReason by rememberSaveable { mutableStateOf("") }
    var unitPrice by rememberSaveable { mutableStateOf("") }
    var discountAmount by rememberSaveable { mutableStateOf("") }
    var discountReason by rememberSaveable { mutableStateOf("") }
    var notes by rememberSaveable { mutableStateOf("") }

    var showLoadPicker by remember { mutableStateOf(false) }
    var showPartyPicker by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var localError by remember { mutableStateOf<String?>(null) }
    /** مفتاحُ النيّة الحاليّة + بصمةُ جسمها — النيّةُ الواحدةُ مفتاحٌ واحد،
     *  ويُحفظان نصَّين كي ينجوا من موت العملية: فلو مات التطبيقُ بعد الحفظ في
     *  الطابور وقبل إغلاق الشاشة، لا تُبنى نيّةٌ ثانيةٌ بمفتاحٍ جديد. */
    var intentKey by rememberSaveable { mutableStateOf("") }
    var intentFingerprint by rememberSaveable { mutableStateOf("") }
    fun currentIntent(): Pair<String, String>? =
        intentKey.takeIf { it.isNotBlank() }?.let { it to intentFingerprint }

    val saleable = workspace?.saleableLoadOrders ?: emptyList()
    val loadOrder = saleable.firstOrNull { it.id == loadOrderId }
    val party = state.parties.firstOrNull { it.id == partyId }

    // آخرُ سعرٍ باع به المندوبُ لنفسِ صنفِ هذا الأمر — من مستنداته كما يعيدها الخادم
    val lastPrice = loadOrder?.let { order ->
        workspace?.documents
            ?.filter { it.isSale && !it.isVoided && it.itemName == order.itemName }
            ?.maxByOrNull { it.docDate }
            ?.takeIf { Dec.isPositive(it.unitPrice) }
    }

    val creditBlockedReason: String? = when {
        paymentMethod == "credit" && (!registeredCustomer || partyId.isBlank()) ->
            "البيعُ الآجل يتطلّب اختيار بطاقة عميل مسجَّل."
        paymentMethod == "credit" && party?.creditHold == true ->
            "العميلُ موقوفٌ ائتمانيًّا (إيقاف البيع الآجل) — اختر الدفع النقديّ أو البطاقة."
        Dec.isPositive(bonusQty) && bonusReason.trim().isEmpty() ->
            "يجب تحديد سبب منح الكمية المجانية / البونص (ترويجي، عينات، تعويض تلف…)."
        else -> null
    }

    val custodyWarning: String? = remember(loadOrder, soldQty, bonusQty) {
        val order = loadOrder ?: return@remember null
        val requested = Dec.orZero(soldQty).add(Dec.orZero(bonusQty))
        val expected = Dec.orZero(order.expectedRemainingQty)
        if (requested.signum() > 0 && requested > expected) {
            "تحذير: المطلوب (${Dec.kg(requested.toPlainString())} كجم) أكبر من المتبقّي المتوقّع (${Dec.kg(order.expectedRemainingQty)} كجم) — الحكم النهائي للخادم."
        } else null
    }

    fun buildRequest(): SaleRequest? {
        if (loadOrderId.isBlank()) return null
        val sold = Dec.parse(soldQty)
        if (sold == null || sold.signum() <= 0) return null
        if (creditBlockedReason != null) return null
        return SaleRequest(
            loadOrderId = loadOrderId,
            partyId = if (registeredCustomer) partyId.ifBlank { null } else null,
            customerName = if (!registeredCustomer || partyId.isBlank()) customerName.trim().ifBlank { "محل تجزئة نقدي" } else null,
            invoiceMode = invoiceMode,
            paymentMethod = paymentMethod,
            soldQty = Dec.wire(soldQty),
            bonusQty = Dec.wire(bonusQty).ifBlank { null },
            bonusReason = if (Dec.isPositive(bonusQty)) bonusReason.trim().ifBlank { null } else null,
            unitPrice = Dec.wire(unitPrice).ifBlank { null },
            discountAmount = Dec.wire(discountAmount).ifBlank { null },
            discountReason = if (Dec.isPositive(discountAmount)) discountReason.trim().ifBlank { null } else null,
            notes = notes.trim().ifBlank { null },
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("مستندُ بيع جديد", fontWeight = FontWeight.ExtraBold) },
                navigationIcon = {
                    IconButton(onClick = onDone) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SectionCard(title = "١) أمرُ التحميل") {
                OutlinedButton(
                    onClick = { showLoadPicker = true },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        loadOrder?.let { "${it.number} — ${it.itemName} (متبقٍّ ${Dec.kg(it.expectedRemainingQty)} كجم)" }
                            ?: "اختر أمرَ التحميل"
                    )
                }
                if (loadOrder != null && Dec.isPositive(loadOrder.expectedRemainingQty)) {
                    Text(
                        "بيعُك من هذا الأمر فقط — وما تبقّى فيه ${Dec.kg(loadOrder.expectedRemainingQty)} كجم، " +
                            "والخادمُ يرفضُ ما يتجاوزُ عهدتَك.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            SectionCard(title = "٢) العميل") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = !registeredCustomer,
                        onClick = { registeredCustomer = false; partyId = "" },
                        label = { Text("عميلٌ نقديّ") },
                    )
                    FilterChip(
                        selected = registeredCustomer,
                        onClick = { registeredCustomer = true; customerName = "" },
                        label = { Text("عميلٌ ببطاقة") },
                    )
                }
                if (registeredCustomer) {
                    OutlinedButton(onClick = { showPartyPicker = true }, modifier = Modifier.fillMaxWidth()) {
                        Text(party?.displayName ?: "اختر بطاقةَ العميل")
                    }
                    if (party?.creditHold == true) {
                        Text(
                            "هذا العميل موقوفٌ ائتمانيًّا — يُسمح بالبيع النقدي أو البطاقة فقط.",
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    } else if (party?.creditLimit != null && Dec.isPositive(party.creditLimit)) {
                        Text(
                            "الحدُّ الائتمانيّ المسجَّل: ${Dec.money(party.creditLimit)} ريال" +
                                (party.paymentTermsDays?.let { " · شروط السداد: $it يومًا" } ?: ""),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                } else {
                    OutlinedTextField(
                        value = customerName,
                        onValueChange = { customerName = it },
                        label = { Text("اسمُ العميل النقديّ") },
                        supportingText = { Text("افتراضيًّا «محل تجزئة نقدي»") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            SectionCard(title = "٣) الفاتورة والدفع") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = invoiceMode == "zatca_tax",
                        onClick = { invoiceMode = "zatca_tax" },
                        label = { Text("فاتورة ضريبية") },
                    )
                    FilterChip(
                        selected = invoiceMode == "internal_delivery",
                        onClick = { invoiceMode = "internal_delivery" },
                        label = { Text("تسليمٌ داخليّ") },
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = paymentMethod == "cash", onClick = { paymentMethod = "cash" }, label = { Text("نقديّ") })
                    FilterChip(selected = paymentMethod == "card", onClick = { paymentMethod = "card" }, label = { Text("بطاقة") })
                    FilterChip(
                        selected = paymentMethod == "credit",
                        onClick = {
                            paymentMethod = "credit"
                            if (!registeredCustomer) {
                                registeredCustomer = true
                                customerName = ""
                            }
                        },
                        label = { Text("آجل") },
                    )
                }
            }

            SectionCard(title = "٤) الكميّات والسعر") {
                OutlinedTextField(
                    value = soldQty,
                    onValueChange = { if (Dec.isValidInput(it)) soldQty = it },
                    label = { Text("الكميّة المباعة (كجم) *") },
                    isError = soldQty.isNotBlank() && Dec.parse(soldQty)?.signum() != 1,
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = bonusQty,
                    onValueChange = { if (Dec.isValidInput(it)) bonusQty = it },
                    label = { Text("الكميّة المجانية/البونص (كجم)") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (Dec.isPositive(bonusQty)) {
                    OutlinedTextField(
                        value = bonusReason,
                        onValueChange = { bonusReason = it },
                        label = { Text("سببُ البونص *") },
                        isError = bonusReason.trim().isEmpty(),
                        supportingText = { Text("إلزاميّ عند منح بونص (ترويجي، عينات، تعويض تلف…)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                OutlinedTextField(
                    value = unitPrice,
                    onValueChange = { if (Dec.isValidInput(it)) unitPrice = it },
                    label = { Text("سعرُ الكيلو (ريال)") },
                    supportingText = {
                        Text(
                            if (lastPrice != null) {
                                "آخرُ سعرٍ بعتَ به على هذا الأمر: ${Dec.money(lastPrice.unitPrice)} ريال"
                            } else {
                                "اتركه فارغًا ليسعّره الخادم من بطاقة العميل وقوائم الأسعار"
                            }
                        )
                    },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (lastPrice != null && unitPrice.isBlank()) {
                    TextButton(onClick = { unitPrice = Dec.money(lastPrice.unitPrice) }) {
                        Text("استعمالُ آخر سعر (${Dec.money(lastPrice.unitPrice)} ريال)")
                    }
                }
                OutlinedTextField(
                    value = discountAmount,
                    onValueChange = { if (Dec.isValidInput(it)) discountAmount = it },
                    label = { Text("الخصم (ريال)") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (Dec.isPositive(discountAmount)) {
                    OutlinedTextField(
                        value = discountReason,
                        onValueChange = { discountReason = it },
                        label = { Text("سببُ الخصم") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                OutlinedTextField(
                    value = notes,
                    onValueChange = { notes = it },
                    label = { Text("ملاحظات") },
                    modifier = Modifier.fillMaxWidth(),
                )
                // معاينةٌ تقديريّةٌ للمجموع عند إدخال السعر محليًّا (والحكم النهائي للخادم)
                val soldBd = Dec.parse(soldQty)
                val priceBd = Dec.parse(unitPrice)
                if (soldBd != null && soldBd.signum() > 0 && priceBd != null && priceBd.signum() > 0) {
                    val discBd = Dec.orZero(discountAmount)
                    val subBd = soldBd.multiply(priceBd).subtract(discBd)
                        .max(java.math.BigDecimal.ZERO)
                        .setScale(2, java.math.RoundingMode.HALF_UP)
                    val vatBd = if (invoiceMode == "zatca_tax") {
                        subBd.multiply(java.math.BigDecimal("0.15"))
                            .setScale(2, java.math.RoundingMode.HALF_UP)
                    } else java.math.BigDecimal.ZERO.setScale(2)
                    val grandBd = subBd.add(vatBd)
                    Text(
                        "تقديرُ الفاتورة: صافي ${subBd.toPlainString()} + ضريبة ${vatBd.toPlainString()} = ${grandBd.toPlainString()} ريال (يُحتسب رسميًّا في الخادم).",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }

            if (custodyWarning != null) {
                Text(
                    custodyWarning,
                    color = MaterialTheme.colorScheme.tertiary,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            if (creditBlockedReason != null) {
                Text(
                    creditBlockedReason,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            if (localError != null) {
                Text(localError ?: "", color = MaterialTheme.colorScheme.error)
            }
            if (!state.online) {
                Text(
                    "لا اتصال — سيُحفظ البيعُ في الطابور ويُرسل بمفتاح عدم تكرارٍ واحد عند عودة الشبكة.",
                    color = MaterialTheme.colorScheme.tertiary,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }

            ActionButton(
                label = "إصدارُ المستند",
                icon = Icons.Default.PointOfSale,
                loading = busy,
                enabled = buildRequest() != null,
                modifier = Modifier.fillMaxWidth(),
                onClick = {
                    val request = buildRequest() ?: return@ActionButton
                    busy = true
                    localError = null
                    vm.submitIntent(
                        operation = QueueOperation.DOCUMENT,
                        targetId = null,
                        request = request,
                        currentIntent = currentIntent(),
                    ) { outcome: SubmitOutcome ->
                        busy = false
                        when (val result = outcome.result) {
                            is ActionResult.Synced -> {
                                intentKey = ""; intentFingerprint = ""
                                onDone()
                            }
                            is ActionResult.StoredOffline -> {
                                intentKey = ""; intentFingerprint = ""
                                onDone()
                            }
                            is ActionResult.Refused -> {
                                intentKey = outcome.intent?.first ?: ""
                                intentFingerprint = outcome.intent?.second ?: ""
                                localError = result.messageAr
                            }
                            is ActionResult.Blocked -> localError = result.reasonsAr.joinToString(" · ")
                        }
                    }
                },
            )
        }
    }

    if (showLoadPicker) {
        PickerDialog(
            title = "اختر أمرَ التحميل (القابلَ للبيع)",
            items = saleable.map {
                PickerItem(
                    id = it.id,
                    title = "${it.number} — ${it.itemName}",
                    subtitle = "الدفعة ${it.productionBatchNo}",
                    trailing = "متبقٍّ ${Dec.kg(it.expectedRemainingQty)} كجم",
                )
            },
            onDismiss = { showLoadPicker = false },
            onSelect = { loadOrderId = it.id },
        )
    }

    if (showPartyPicker) {
        PickerDialog(
            title = "اختر بطاقةَ العميل",
            items = state.parties.map { PickerItem(id = it.id, title = it.displayName, subtitle = it.phone) },
            onDismiss = { showPartyPicker = false },
            onSelect = { partyId = it.id },
        )
    }
}
