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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.data.ActionResult
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
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * شاشةُ الإنتاج — دفعاتُ المصنع كما تعود في لوحة الخطّ، ودفعةٌ جديدةٌ
 * (إذنُ van_sales.production.manage). قواعدُ الخادم حرفيّةً هنا:
 * الكميةُ المنتجةُ موجبةٌ، والفاقدُ صفرٌ أو أكثر **بسببٍ إلزاميٍّ مع أيّ فاقد**،
 * والصنفُ مطلوبٌ، وتكلفةُ الوحدة موجبةٌ إن أُدخلت.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProductionScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    val dash = state.dashboard
    var showForm by remember { mutableStateOf(false) }
    val scope = androidx.compose.runtime.rememberCoroutineScope()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("الإنتاج") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
        floatingActionButton = {
            if (state.can("van_sales.production.manage")) {
                FloatingActionButton(onClick = { showForm = !showForm }) {
                    Icon(Icons.Default.Add, contentDescription = "دفعة جديدة")
                }
            }
        },
    ) { padding ->
        if (showForm) {
            BatchForm(
                vm = vm,
                onDone = { showForm = false },
            )
            return@Scaffold
        }
        if (state.loadingDashboard && dash == null) {
            CenterLoading("جارٍ التحميل…", Modifier.padding(padding))
            return@Scaffold
        }
        val batches = dash?.productionBatches.orEmpty()
        if (batches.isEmpty()) {
            EmptyState("لا دفعاتِ إنتاجٍ بعد.", Modifier.padding(padding))
            return@Scaffold
        }
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(batches, key = { it.id }) { batch ->
                var busy by remember { mutableStateOf(false) }
                SectionCard(
                    title = "دفعة ${batch.batchNo.ifBlank { "—" }} — ${batch.itemName.ifBlank { "صنف" }}",
                    subtitle = "تاريخ الإنتاج: ${Labels.dateOrDash(batch.productionDate)}",
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        val (statusText, tone) = Labels.batchStatus(batch.status)
                        StatusChip(statusText, tone)
                        StatusChip(Labels.costBasis(batch.costBasis), ChipTone.NEUTRAL)
                    }
                    Spacer(Modifier.height(6.dp))
                    KeyValue("المنتج (كجم)", Dec.kg(batch.producedQty))
                    KeyValue("الفاقد (كجم)", Dec.kg(batch.scrapQty))
                    KeyValue("المتاحُ بالمستودع", Dec.kg(batch.availableWarehouseQty))
                    KeyValue("تكلفةُ الوحدة", Dec.money(batch.unitCost) + " ر.س")
                    KeyValue("إجماليُّ التكلفة", Dec.money(batch.totalCost) + " ر.س")
                    if (batch.supervisorName.isNotBlank()) KeyValue("المشرف", batch.supervisorName)
                    if (batch.notes.isNotBlank()) KeyValue("ملاحظات", batch.notes)
                    Spacer(Modifier.height(8.dp))
                    androidx.compose.material3.OutlinedButton(
                        onClick = {
                            busy = true
                            scope.launch {
                                try {
                                    val context = vm.androidContext()
                                    val mac = state.session.printerMac
                                    val width = state.session.printerWidthDots
                                    val bitmap = withContext(kotlinx.coroutines.Dispatchers.IO) {
                                        val rendered = com.erpcloud.bakery.printing.BakeryDocs.batchLabel(batch)
                                        if (mac.isNotBlank()) {
                                            com.erpcloud.bakery.printing.EscPos.printBitmap(context, mac, width, rendered)
                                        }
                                        rendered
                                    }
                                    if (mac.isBlank()) {
                                        com.erpcloud.bakery.printing.PrintKit.printViaSystem(
                                            context, bitmap, "بطاقة دفعة ${batch.batchNo}",
                                        )
                                    }
                                } catch (error: Exception) {
                                    vm.showPrintError(error.message ?: "تعذّرت الطباعة")
                                } finally {
                                    busy = false
                                }
                            }
                        },
                        enabled = !busy,
                    ) { Text("طباعةُ البطاقة") }
                }
            }
        }
    }
}

/** نموذجُ دفعةٍ جديدة — نيّةٌ واحدةٌ مفتاحٌ واحد: المفتاحُ يُبنى عند أوّل إرسال ويُعاد استعماله. */
@Composable
private fun BatchForm(vm: AppViewModel, onDone: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var intentKey by rememberSaveable { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }

    var itemId by rememberSaveable { mutableStateOf("") }
    var itemLabel by rememberSaveable { mutableStateOf("") }
    var warehouseId by rememberSaveable { mutableStateOf("") }
    var warehouseLabel by rememberSaveable { mutableStateOf("") }
    var productionDate by rememberSaveable { mutableStateOf(todayIso()) }
    var producedQty by rememberSaveable { mutableStateOf("") }
    var scrapQty by rememberSaveable { mutableStateOf("") }
    var scrapReason by rememberSaveable { mutableStateOf("") }
    var unitCost by rememberSaveable { mutableStateOf("") }
    var supervisorName by rememberSaveable { mutableStateOf("") }
    var notes by rememberSaveable { mutableStateOf("") }
    var pickItems by remember { mutableStateOf(false) }
    var pickWarehouses by remember { mutableStateOf(false) }
    var localError by remember { mutableStateOf<String?>(null) }

    // المستودعُ الرئيسيّ كما تقوله اللوحة — يُقترح مرّةً ولا يُخترع مستودع.
    androidx.compose.runtime.LaunchedEffect(state.warehouses, state.dashboard?.mainWarehouseId) {
        if (warehouseId.isBlank() && state.warehouses.isNotEmpty()) {
            val main = state.warehouses.firstOrNull { it.id == state.dashboard?.mainWarehouseId }
                ?: state.warehouses.firstOrNull { it.isDefault == true }
            if (main != null) {
                warehouseId = main.id
                warehouseLabel = main.label
            }
        }
    }

    LazyColumn(
        Modifier.fillMaxSize().padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            SectionCard(title = "دفعةُ إنتاجٍ جديدة", subtitle = "الحقولُ بالأحمر إلزاميّةٌ عند الخادم") {
                OutlinedTextField(
                    value = itemLabel,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("الصنف *") },
                    placeholder = { Text("اختر الصنف") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = {
                        IconButton(onClick = { pickItems = true }) { Text("اختر") }
                    },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = warehouseLabel,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("المستودع *") },
                    placeholder = { Text("المستودع الرئيسيّ") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = {
                        IconButton(onClick = { pickWarehouses = true }) { Text("اختر") }
                    },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = productionDate,
                    onValueChange = { productionDate = it },
                    label = { Text("تاريخ الإنتاج (YYYY-MM-DD)") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = producedQty,
                    onValueChange = { if (Dec.isValidInput(it)) producedQty = it },
                    label = { Text("الكميّةُ المنتجة (كجم) *") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = scrapQty,
                    onValueChange = { if (Dec.isValidInput(it)) scrapQty = it },
                    label = { Text("الفاقد (كجم)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (Dec.isPositive(scrapQty)) {
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = scrapReason,
                        onValueChange = { scrapReason = it },
                        label = { Text("سببُ الفاقد * (إلزاميٌّ مع أيّ فاقد)") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = unitCost,
                    onValueChange = { if (Dec.isValidInput(it)) unitCost = it },
                    label = { Text("تكلفةُ الوحدة (ر.س) — اختياريّة") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = supervisorName,
                    onValueChange = { supervisorName = it },
                    label = { Text("المشرف") },
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
                    com.erpcloud.bakery.ui.components.ActionButton(
                        label = if (sending) "جارٍ الإرسال…" else "تسجيل الدفعة",
                        onClick = {
                            val produced = Dec.parse(producedQty)
                            val unitCostValue = Dec.parse(unitCost)
                            localError = when {
                                itemId.isBlank() -> "اختر الصنف أولًا."
                                produced == null || produced.signum() <= 0 ->
                                    "الكميّةُ المنتجةُ يجب أن تكون رقمًا موجبًا."
                                Dec.isPositive(scrapQty) && scrapReason.isBlank() ->
                                    "سببُ الفاقد إلزاميٌّ مع أيّ كمية فاقد."
                                unitCostValue?.signum() == -1 ->
                                    "تكلفةُ الوحدة تُقبل موجبةً فقط."
                                else -> null
                            }
                            if (localError != null) return@ActionButton
                            sending = true
                            val body = buildJsonObject {
                                put("itemId", itemId)
                                if (warehouseId.isNotBlank()) put("warehouseId", warehouseId)
                                put("productionDate", productionDate.trim())
                                put("producedQty", Dec.wire(producedQty))
                                if (scrapQty.isNotBlank()) put("scrapQty", Dec.wire(scrapQty))
                                if (scrapReason.isNotBlank()) put("scrapReason", scrapReason.trim())
                                if (unitCost.isNotBlank()) put("unitCost", Dec.wire(unitCost))
                                if (supervisorName.isNotBlank()) put("supervisorName", supervisorName.trim())
                                if (notes.isNotBlank()) put("notes", notes.trim())
                            }
                            val withKey = vm.ensureIdempotencyKey("bakery-batch", body, intentKey)
                            intentKey = (withKey["idempotencyKey"] as? JsonPrimitive)?.content ?: intentKey
                            vm.createProductionBatch(withKey) { result ->
                                sending = false
                                if (result is ActionResult.Synced) onDone()
                            }
                        },
                        enabled = !sending,
                        loading = sending,
                        modifier = Modifier.weight(1f),
                    )
                    com.erpcloud.bakery.ui.components.ActionButton(
                        label = "رجوع",
                        onClick = onDone,
                        enabled = !sending,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }

    if (pickItems) {
        PickerDialog(
            title = "اختر الصنف",
            items = state.items.map { PickerItem(it.id, it.label) },
            onDismiss = { pickItems = false },
            onSelect = { item ->
                itemId = item.id
                itemLabel = item.title
            },
        )
    }
    if (pickWarehouses) {
        PickerDialog(
            title = "اختر المستودع",
            items = state.warehouses.map { PickerItem(it.id, it.label, trailing = if (it.isDefault == true) "افتراضيّ" else null) },
            onDismiss = { pickWarehouses = false },
            onSelect = { item ->
                warehouseId = item.id
                warehouseLabel = item.title
            },
        )
    }
}

/** تاريخُ اليوم بصيغة ISO — للحقولِ الافتراضيّة (SimpleDateFormat: minSdk 24). */
internal fun todayIso(): String =
    SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
