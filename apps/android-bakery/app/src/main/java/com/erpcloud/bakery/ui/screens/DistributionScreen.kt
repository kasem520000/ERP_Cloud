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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.data.ActionResult
import com.erpcloud.bakery.data.api.LoadOrderDto
import com.erpcloud.bakery.printing.loadOrderNotice
import com.erpcloud.bakery.printing.EscPos
import com.erpcloud.bakery.printing.PrintKit
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
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * شاشةُ التوزيع — أوامرُ التحميل من لوحة الخطّ بقراراتها:
 * تأكيدُ الاستلام/رفضُه (المندوبُ صاحبُ العهدة أو إدارةُ التحميل)، إلغاءٌ قبل
 * الاستلام، قرارُ فرق العبور (إرجاع/عجز)، وإنشاءُ أمرٍ جديد. وما **ليس** هنا:
 * الإقفالُ والاعتماد — شاشةُ العهدة (ونقرةُ الطباعة تُخرج إشعارَ تحميل ESC/POS).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DistributionScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    val dash = state.dashboard
    var showForm by remember { mutableStateOf(false) }
    val scope = androidx.compose.runtime.rememberCoroutineScope()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("التوزيع والتحميل") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
        floatingActionButton = {
            if (state.can("van_sales.load.manage")) {
                FloatingActionButton(onClick = { showForm = !showForm }) {
                    Icon(Icons.Default.Add, contentDescription = "أمر تحميل جديد")
                }
            }
        },
    ) { padding ->
        if (showForm) {
            LoadOrderForm(vm = vm, onDone = { showForm = false })
            return@Scaffold
        }
        if (state.loadingDashboard && dash == null) {
            CenterLoading("جارٍ التحميل…", Modifier.padding(padding))
            return@Scaffold
        }
        val orders = dash?.loadOrders.orEmpty()
        if (orders.isEmpty()) {
            EmptyState("لا أوامرَ تحميلٍ بعد.", Modifier.padding(padding))
            return@Scaffold
        }
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(orders, key = { it.id }) { order ->
                LoadOrderCard(
                    vm = vm,
                    order = order,
                    scope = scope,
                )
            }
        }
    }
}

/** بطاقةُ أمرِ تحميلٍ واحد بقراراته. */
@Composable
private fun LoadOrderCard(
    vm: AppViewModel,
    order: LoadOrderDto,
    scope: kotlinx.coroutines.CoroutineScope,
) {
    val state by vm.uiState.collectAsState()
    var busy by remember { mutableStateOf(false) }
    var showReject by remember { mutableStateOf(false) }
    var showCancel by remember { mutableStateOf(false) }
    var showTransit by remember { mutableStateOf(false) }
    var rejectReason by rememberSaveable(order.id) { mutableStateOf("") }
    var cancelReason by rememberSaveable(order.id) { mutableStateOf("") }
    var transitMode by rememberSaveable(order.id) { mutableStateOf("return") }

    val (statusText, tone) = Labels.loadStatus(order.status)
    SectionCard(
        title = "${order.number.ifBlank { "أمر" }} — ${order.salesmanName.ifBlank { "مندوب" }}",
        subtitle = "${order.itemName.ifBlank { "صنف" }} · ${Labels.dateOrDash(order.loadDate)}" +
            (if (order.vehiclePlate.isNotBlank()) " · ${order.vehiclePlate}" else ""),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            StatusChip(statusText, tone)
            if (order.awaitingTransitDecision) StatusChip("قرارُ فرقِ عبورٍ مطلوب", ChipTone.DANGER)
        }
        Spacer(Modifier.height(6.dp))
        KeyValue("المحمَّل (كجم)", Dec.kg(order.loadedQty))
        KeyValue("المستلَم (كجم)", Dec.kg(order.receivedQty))
        if (order.discrepancyQty.isNotBlank() && Dec.parse(order.discrepancyQty)?.signum() != 0) {
            KeyValue("فرقُ العبور", Dec.kg(order.discrepancyQty))
        }
        KeyValue("المُباع", Dec.kg(order.soldQty))
        KeyValue("المجاني", Dec.kg(order.bonusQty))
        KeyValue("المتبقّي بالعهدة", Dec.kg(order.remainingQty))
        KeyValue("النقدُ المتوقّع", Dec.money(order.expectedCash) + " ر.س")
        KeyValue("المُحصَّل", Dec.money(order.collectedCash) + " ر.س")
        if (order.productionBatchNo.isNotBlank()) KeyValue("دفعةُ الإنتاج", order.productionBatchNo)
        if (order.stockSettlementStatus != "not_required") {
            KeyValue("تسويةُ المخزون", Labels.stockSettlement(order.stockSettlementStatus))
        }
        if (order.notes.isNotBlank()) KeyValue("ملاحظات", order.notes)

        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            // تأكيدُ الاستلام: المندوبُ صاحبُ العهدة أو إدارةُ التحميل.
            if (order.awaitingReceipt) {
                OutlinedButton(
                    onClick = {
                        busy = true
                        vm.confirmReceipt(order.id, buildJsonObject { put("receivedQty", order.loadedQty) }) {
                            busy = false
                        }
                    },
                    enabled = !busy,
                ) { Text("تأكيدُ الاستلام") }
                OutlinedButton(onClick = { showReject = true }, enabled = !busy) { Text("رفض") }
            }
            if (order.awaitingTransitDecision && state.can("van_sales.load.manage")) {
                OutlinedButton(onClick = { showTransit = true }, enabled = !busy) { Text("قرارُ الفرق") }
            }
            if ((order.status == "pending_receipt") && state.can("van_sales.load.manage")) {
                OutlinedButton(onClick = { showCancel = true }, enabled = !busy) { Text("إلغاء") }
            }
            OutlinedButton(
                onClick = {
                    busy = true
                    scope.launch {
                        try {
                            val context = vm.androidContext()
                            val mac = state.session.printerMac
                            val width = state.session.printerWidthDots
                            val bitmap = withContext(kotlinx.coroutines.Dispatchers.IO) {
                                val rendered = loadOrderNotice(order)
                                if (mac.isNotBlank()) {
                                    EscPos.printBitmap(context, mac, width, rendered)
                                }
                                rendered
                            }
                            if (mac.isBlank()) {
                                PrintKit.printViaSystem(context, bitmap, "إشعار تحميل ${order.number}")
                            }
                        } catch (error: Exception) {
                            vm.showPrintError(error.message ?: "تعذّرت الطباعة")
                        } finally {
                            busy = false
                        }
                    }
                },
                enabled = !busy,
            ) { Text("طباعة") }
        }
    }

    if (showReject) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { showReject = false },
            confirmButton = {
                androidx.compose.material3.TextButton(
                    onClick = {
                        showReject = false
                        busy = true
                        vm.rejectReceipt(order.id, buildJsonObject { put("reason", rejectReason) }) { busy = false }
                    },
                    enabled = !busy,
                ) { Text("رفضُ الاستلام") }
            },
            dismissButton = {
                androidx.compose.material3.TextButton(onClick = { showReject = false }) { Text("رجوع") }
            },
            title = { Text("رفضُ استلام التوريد ${order.number}") },
            text = {
                Column {
                    Text(
                        "الكميّةُ تبقى رسميًّا في الطريق وتُعاد إلى المصدر بمناقلةِ إرجاع — والسببُ جزءٌ من أثر التدقيق.",
                    )
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(
                        value = rejectReason,
                        onValueChange = { rejectReason = it },
                        label = { Text("سببُ الرفض") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
        )
    }
    if (showCancel) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { showCancel = false },
            confirmButton = {
                androidx.compose.material3.TextButton(
                    onClick = {
                        showCancel = false
                        busy = true
                        vm.cancelLoadOrder(order.id, buildJsonObject { put("reason", cancelReason) }) { busy = false }
                    },
                    enabled = !busy,
                ) { Text("إلغاءُ الأمر") }
            },
            dismissButton = {
                androidx.compose.material3.TextButton(onClick = { showCancel = false }) { Text("رجوع") }
            },
            title = { Text("إلغاءُ أمر التحميل ${order.number}") },
            text = {
                Column {
                    Text(
                        "قبلَ الاستلام فقط: يُلغى الأمرُ عبر إلغاءِ المناقلة الرسميّة فتعود الكميّاتُ ويُعكس القيد.",
                    )
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(
                        value = cancelReason,
                        onValueChange = { cancelReason = it },
                        label = { Text("سببُ الإلغاء") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
        )
    }
    if (showTransit) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { showTransit = false },
            confirmButton = {
                androidx.compose.material3.TextButton(
                    onClick = {
                        showTransit = false
                        busy = true
                        vm.closeTransitDifference(
                            order.id,
                            buildJsonObject {
                                put("mode", transitMode)
                                put("reason", "قرار فرق العبور من تطبيق الإدارة")
                            },
                        ) { busy = false }
                    },
                ) { Text(if (transitMode == "return") "إرجاعٌ إلى المصدر" else "تسجيلُ عجز التحويل") }
            },
            dismissButton = {
                androidx.compose.material3.TextButton(onClick = { showTransit = false }) { Text("رجوع") }
            },
            title = { Text("قرارُ فرق العبور — ${order.number}") },
            text = {
                Column {
                    Text(
                        "الفرق: ${Dec.kg(order.discrepancyQty)} كجم — قرارٌ ماليٌّ صريحٌ ينفّذه محرّكُ المخزون بقيوده وحساباته من ملفّ الترحيل.",
                    )
                    Spacer(Modifier.height(10.dp))
                    androidx.compose.material3.FilterChip(
                        selected = transitMode == "return",
                        onClick = { transitMode = "return" },
                        label = { Text("إرجاعٌ إلى المصدر (مناقلةُ إرجاع)") },
                    )
                    Spacer(Modifier.height(6.dp))
                    androidx.compose.material3.FilterChip(
                        selected = transitMode == "shortage",
                        onClick = { transitMode = "shortage" },
                        label = { Text("عجزُ تحويل (قيدُ عجز)") },
                    )
                }
            },
        )
    }
}

/** نموذجُ أمرِ تحميلٍ جديد — المندوبُ والصنفُ والكميّةُ أساس، والبقيةُ اختياريّة. */
@Composable
private fun LoadOrderForm(vm: AppViewModel, onDone: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var intentKey by rememberSaveable { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }

    var salesmanId by rememberSaveable { mutableStateOf("") }
    var salesmanLabel by rememberSaveable { mutableStateOf("") }
    var itemId by rememberSaveable { mutableStateOf("") }
    var itemLabel by rememberSaveable { mutableStateOf("") }
    var loadedQty by rememberSaveable { mutableStateOf("") }
    var vehiclePlate by rememberSaveable { mutableStateOf("") }
    var productionBatchNo by rememberSaveable { mutableStateOf("") }
    var maxBonusQty by rememberSaveable { mutableStateOf("") }
    var notes by rememberSaveable { mutableStateOf("") }
    var pickSalesman by remember { mutableStateOf(false) }
    var pickItem by remember { mutableStateOf(false) }
    var localError by remember { mutableStateOf<String?>(null) }

    LazyColumn(
        Modifier.fillMaxSize().padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            SectionCard(
                title = "أمرُ تحميلٍ جديد",
                subtitle = "المستودعُ المصدر يُحلّه الخادم (مستودعُ المندوب من بطاقته) — لا يُخترع مستودع",
            ) {
                OutlinedTextField(
                    value = salesmanLabel,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("المندوب *") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { IconButton(onClick = { pickSalesman = true }) { Text("اختر") } },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = itemLabel,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("الصنف *") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { IconButton(onClick = { pickItem = true }) { Text("اختر") } },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = loadedQty,
                    onValueChange = { if (Dec.isValidInput(it)) loadedQty = it },
                    label = { Text("الكميّةُ المحمَّلة (كجم) *") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = vehiclePlate,
                    onValueChange = { vehiclePlate = it },
                    label = { Text("لوحةُ المركبة") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = productionBatchNo,
                    onValueChange = { productionBatchNo = it },
                    label = { Text("رقمُ دفعة الإنتاج (إلزاميٌّ للأصناف المتتبَّعة بالدفعات)") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = maxBonusQty,
                    onValueChange = { if (Dec.isValidInput(it)) maxBonusQty = it },
                    label = { Text("سقفُ المجاني (كجم) — الافتراضيّ من السياسة") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
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
                        label = if (sending) "جارٍ الإرسال…" else "إنشاءُ الأمر",
                        onClick = {
                            val loaded = Dec.parse(loadedQty)
                            localError = when {
                                salesmanId.isBlank() -> "اختر المندوب أولًا."
                                itemId.isBlank() -> "اختر الصنف."
                                loaded == null || loaded.signum() <= 0 ->
                                    "الكميّةُ المحمَّلةُ يجب أن تكون رقمًا موجبًا."
                                else -> null
                            }
                            if (localError != null) return@ActionButton
                            sending = true
                            val body = buildJsonObject {
                                put("salesmanId", salesmanId)
                                put("itemId", itemId)
                                put("loadedQty", Dec.wire(loadedQty))
                                if (vehiclePlate.isNotBlank()) put("vehiclePlate", vehiclePlate.trim())
                                if (productionBatchNo.isNotBlank()) put("productionBatchNo", productionBatchNo.trim())
                                if (maxBonusQty.isNotBlank()) put("maxBonusQty", Dec.wire(maxBonusQty))
                                if (notes.isNotBlank()) put("notes", notes.trim())
                            }
                            val withKey = vm.ensureIdempotencyKey("bakery-load", body, intentKey)
                            intentKey = (withKey["idempotencyKey"] as? JsonPrimitive)?.content ?: intentKey
                            vm.createLoadOrder(withKey) { result ->
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

    if (pickSalesman) {
        PickerDialog(
            title = "اختر المندوب",
            items = state.salesmen
                .filter { it.active }
                .map { s ->
                    PickerItem(
                        id = s.id,
                        title = s.name,
                        subtitle = s.warehouseName,
                        trailing = if (s.vehiclePlate != null) s.vehiclePlate else null,
                    )
                },
            onDismiss = { pickSalesman = false },
            onSelect = { item ->
                salesmanId = item.id
                salesmanLabel = item.title
            },
        )
    }
    if (pickItem) {
        PickerDialog(
            title = "اختر الصنف",
            items = state.items.map { PickerItem(it.id, it.label) },
            onDismiss = { pickItem = false },
            onSelect = { item ->
                itemId = item.id
                itemLabel = item.title
            },
        )
    }
}
