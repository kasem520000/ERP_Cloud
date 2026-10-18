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
import androidx.compose.material3.TopAppBar
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
    val currentIntent: Pair<String, String>?
        get() = intentKey.takeIf { it.isNotBlank() }?.let { it to intentFingerprint }

    val saleable = workspace?.saleableLoadOrders ?: emptyList()
    val loadOrder = saleable.firstOrNull { it.id == loadOrderId }
    val party = state.parties.firstOrNull { it.id == partyId }

    fun buildRequest(): SaleRequest? {
        if (loadOrderId.isBlank()) return null
        val sold = Dec.parse(soldQty)
        if (sold == null || sold.signum() <= 0) return null
        return SaleRequest(
            loadOrderId = loadOrderId,
            partyId = partyId.ifBlank { null },
            customerName = if (partyId.isBlank()) customerName.trim().ifBlank { "محل تجزئة نقدي" } else null,
            invoiceMode = invoiceMode,
            paymentMethod = paymentMethod,
            soldQty = soldQty.trim(),
            bonusQty = bonusQty.trim().ifBlank { null },
            bonusReason = bonusReason.trim().ifBlank { null },
            unitPrice = unitPrice.trim().ifBlank { null },
            discountAmount = discountAmount.trim().ifBlank { null },
            discountReason = discountReason.trim().ifBlank { null },
            notes = notes.trim().ifBlank { null },
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("مستندُ بيع جديد") },
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
                    FilterChip(selected = paymentMethod == "credit", onClick = { paymentMethod = "credit" }, label = { Text("آجل") })
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
                if (Dec.parse(bonusQty)?.signum() > 0) {
                    OutlinedTextField(
                        value = bonusReason,
                        onValueChange = { bonusReason = it },
                        label = { Text("سببُ البونص") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                OutlinedTextField(
                    value = unitPrice,
                    onValueChange = { if (Dec.isValidInput(it)) unitPrice = it },
                    label = { Text("سعرُ الكيلو (ريال)") },
                    supportingText = { Text("اتركه فارغًا ليسعّره الخادم من بطاقة العميل وقوائم الأسعار") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = discountAmount,
                    onValueChange = { if (Dec.isValidInput(it)) discountAmount = it },
                    label = { Text("الخصم (ريال)") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = notes,
                    onValueChange = { notes = it },
                    label = { Text("ملاحظات") },
                    modifier = Modifier.fillMaxWidth(),
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
                        currentIntent = currentIntent,
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
