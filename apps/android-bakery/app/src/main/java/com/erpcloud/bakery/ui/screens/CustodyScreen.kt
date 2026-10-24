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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.data.ActionResult
import com.erpcloud.bakery.data.api.LoadOrderDto
import com.erpcloud.bakery.printing.closingSummary
import com.erpcloud.bakery.printing.EscPos
import com.erpcloud.bakery.printing.PrintKit
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.EmptyState
import com.erpcloud.bakery.ui.components.KeyValue
import com.erpcloud.bakery.ui.components.MissingPermissionHint
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.components.StatusChip
import com.erpcloud.bakery.util.Dec
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * شاشةُ العهدة والإقفال — ما ينتظرُ قرارَ المشرف/المحاسب:
 * أوامرُ «بانتظار الإقفال» يُغلقها صاحبُ الوردية (van_sales.closing.submit)،
 * وأوامرُ «بانتظار تسوية المخزون» يُعتمدها المحاسبُ (van_sales.closing.approve)
 * بجردِه الفعليّ ومصيرِ المتبقّي وتفويضِ ترحيل مستند الجرد.
 *
 * القاعدةُ الحرجة من الخادم: إعلانُ `actualRemainingQty` و`vehicleCountQty`
 * **بديلان** لا رفيقان (XOR)، وإقرارُ الفائض (`surplusAcknowledged`) إلزاميٌّ
 * عند فائضٍ بالجرد، و`remainingAction` إلزاميٌّ عند متبقٍّ فعليّ.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CustodyScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    val dash = state.dashboard
    val scope = androidx.compose.runtime.rememberCoroutineScope()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("العهدة والإقفال") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
    ) { padding ->
        if (state.loadingDashboard && dash == null) {
            CenterLoading("جارٍ التحميل…", Modifier.padding(padding))
            return@Scaffold
        }
        val pending = dash?.loadOrders.orEmpty().filter {
            it.status == "pending_closing" || it.status == "pending_stock_settlement"
        }
        if (pending.isEmpty()) {
            EmptyState("لا وردياتَ تنتظر الإقفال أو الاعتماد.", Modifier.padding(padding))
            return@Scaffold
        }
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(pending, key = { it.id }) { order ->
                CustodyCard(vm = vm, order = order, scope = scope)
            }
        }
    }
}

/** بطاقةُ ورديةٍ تنتظر قرارًا — إقفالٌ من صاحبها أو اعتمادٌ من المحاسب. */
@Composable
private fun CustodyCard(
    vm: AppViewModel,
    order: LoadOrderDto,
    scope: kotlinx.coroutines.CoroutineScope,
) {
    val state by vm.uiState.collectAsState()
    var busy by remember { mutableStateOf(false) }
    var showClosing by remember { mutableStateOf(false) }
    var showApprove by remember { mutableStateOf(false) }

    val (statusText, tone) = Labels.loadStatus(order.status)
    val variance = Dec.parse(order.countVarianceQty)
    val isSurplus = variance != null && variance.signum() < 0

    SectionCard(
        title = "${order.number.ifBlank { "أمر" }} — ${order.salesmanName.ifBlank { "مندوب" }}",
        subtitle = "${order.itemName.ifBlank { "صنف" }} · ${Labels.dateOrDash(order.loadDate)}",
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            StatusChip(statusText, tone)
            if (isSurplus) StatusChip("فائضُ جردٍ يحتاج إقرارًا", ChipTone.WARN)
        }
        Spacer(Modifier.height(6.dp))
        KeyValue("أساسُ العهدة (مستلَم)", Dec.kg(order.receivedQty))
        KeyValue("المُباع", Dec.kg(order.soldQty))
        KeyValue("المجاني", Dec.kg(order.bonusQty))
        KeyValue("المرتجع", Dec.kg(order.returnedQty))
        KeyValue("التالف", Dec.kg(order.damagedQty))
        KeyValue("المتوقّعُ البقاء بالجرد", Dec.kg(order.expectedRemainingQty))
        KeyValue("المتبقّي الفعليّ (المُعلن)", Dec.kg(order.actualRemainingQty))
        KeyValue(
            "فرقُ الاعتماد",
            Dec.kg(order.countVarianceQty) + " كجم" + if (isSurplus) " (فائض)" else "",
        )
        if (order.vehicleCountQty != null) {
            KeyValue("عددُ المركبة المُعلن", Dec.kg(order.vehicleCountQty))
            if (order.otherCustodyQty != null) KeyValue("منه عهدةُ أوامرٍ أخرى", Dec.kg(order.otherCustodyQty))
        }
        KeyValue("النقدُ المتوقّع", Dec.money(order.expectedCash) + " ر.س")
        KeyValue("المُحصَّل", Dec.money(order.collectedCash) + " ر.س")
        KeyValue("فرقُ النقد", Dec.money(order.cashVariance) + " ر.س")
        if (order.closingNotes.isNotBlank()) KeyValue("ملاحظاتُ الإقفال", order.closingNotes)
        if (order.closingSubmittedAt != null) KeyValue("أُقفل في", order.closingSubmittedAt)
        if (order.approvedAt != null) KeyValue("اعتُمد في", order.approvedAt)

        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (order.status == "pending_closing" && state.can("van_sales.closing.submit")) {
                OutlinedButton(onClick = { showClosing = true }, enabled = !busy) { Text("إقفالُ الوردية") }
            }
            if (state.can("van_sales.closing.approve")) {
                OutlinedButton(
                    onClick = {
                        if (order.status == "pending_stock_settlement") {
                            busy = true
                            vm.settleStock(
                                order.id,
                                buildJsonObject {
                                    put("settleStockAdjustment", true)
                                    put("remainingAction", order.remainingAction ?: "return_to_main")
                                },
                            ) { busy = false }
                        } else {
                            showApprove = true
                        }
                    },
                    enabled = !busy,
                ) {
                    Text(if (order.status == "pending_stock_settlement") "استكمالُ التسوية" else "اعتمادُ الإقفال")
                }
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
                                val rendered = closingSummary(order)
                                if (mac.isNotBlank()) {
                                    EscPos.printBitmap(context, mac, width, rendered)
                                }
                                rendered
                            }
                            if (mac.isBlank()) {
                                PrintKit.printViaSystem(context, bitmap, "ملخص إقفال ${order.number}")
                            }
                        } catch (error: Exception) {
                            vm.showPrintError(error.message ?: "تعذّرت الطباعة")
                        } finally {
                            busy = false
                        }
                    }
                },
                enabled = !busy,
            ) { Text("طباعةُ الملخص") }
        }
    }

    // B12: لا يُخفى الإقفالُ ولا الاعتمادُ بصمتًا عند غياب الإذن — اللافتةُ تُسمّي الصلاحية.
    if (order.status == "pending_closing" && !state.can("van_sales.closing.submit")) {
        MissingPermissionHint("إقفالُ الوردية", "van_sales.closing.submit")
    }
    if (!state.can("van_sales.closing.approve")) {
        MissingPermissionHint("اعتمادُ الإقفال", "van_sales.closing.approve")
    }

    if (showClosing) {
        ClosingDialog(
            order = order,
            busy = busy,
            onDismiss = { showClosing = false },
            onSend = { body, onResult ->
                busy = true
                vm.submitClosing(order.id, body) { result ->
                    busy = false
                    onResult(result)
                }
            },
        )
    }
    if (showApprove) {
        ApproveDialog(
            order = order,
            busy = busy,
            onDismiss = { showApprove = false },
            onSend = { body, onResult ->
                busy = true
                vm.approveClosing(order.id, body) { result ->
                    busy = false
                    onResult(result)
                }
            },
        )
    }
}

/** حوارُ إقفال الوردية — من صاحبها: الأرقامُ كما عدّها في السيارة. */
@Composable
private fun ClosingDialog(
    order: LoadOrderDto,
    busy: Boolean,
    onDismiss: () -> Unit,
    onSend: (kotlinx.serialization.json.JsonObject, (ActionResult) -> Unit) -> Unit,
) {
    var returnedQty by rememberSaveable(order.id) { mutableStateOf("") }
    var damagedQty by rememberSaveable(order.id) { mutableStateOf("") }
    var damageReason by rememberSaveable(order.id) { mutableStateOf("") }
    var collectedCash by rememberSaveable(order.id) { mutableStateOf(order.collectedCash) }
    var actualRemainingQty by rememberSaveable(order.id) { mutableStateOf("") }
    var vehicleCountQty by rememberSaveable(order.id) { mutableStateOf("") }
    var closingNotes by rememberSaveable(order.id) { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(
                onClick = {
                    val damaged = Dec.parse(damagedQty)
                    error = when {
                        damaged != null && damaged.signum() < 0 -> "التالفُ لا يكون سالبًا."
                        Dec.isPositive(damagedQty) && damageReason.isBlank() -> "سببُ التالف إلزاميٌّ مع أيّ كميةٍ تالفة."
                        actualRemainingQty.isNotBlank() && vehicleCountQty.isNotBlank() ->
                            "أعلن واحدًا فقط: إمّا المتبقّي الفعليّ لهذا الأمر أو عددُ المركبة كلّها."
                        else -> null
                    }
                    if (error != null) return@TextButton
                    onSend(
                        buildJsonObject {
                            if (returnedQty.isNotBlank()) put("returnedQty", Dec.wire(returnedQty))
                            if (damagedQty.isNotBlank()) put("damagedQty", Dec.wire(damagedQty))
                            if (damageReason.isNotBlank()) put("damageReason", damageReason.trim())
                            if (collectedCash.isNotBlank()) put("collectedCash", Dec.wire(collectedCash))
                            if (actualRemainingQty.isNotBlank()) put("actualRemainingQty", Dec.wire(actualRemainingQty))
                            if (vehicleCountQty.isNotBlank()) put("vehicleCountQty", Dec.wire(vehicleCountQty))
                            if (closingNotes.isNotBlank()) put("closingNotes", closingNotes.trim())
                        },
                    ) { result -> if (result is ActionResult.Synced) onDismiss() else error = resultMessage(result) }
                },
                enabled = !busy,
            ) { Text(if (busy) "جارٍ…" else "إقفالُ الوردية") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("رجوع") } },
        title = { Text("إقفال وردية ${order.number}") },
        text = {
            Column {
                Text(
                    "ما تعلنه هنا هو أساسُ جرد المحاسب: المتبقّي الفعليّ (أو عددُ المركبة كلّها فيُشتقّ نصيبُ هذا الأمر)، والباقي يُقرأ من المستندات.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(10.dp))
                NumField("المرتجع إلى المستودع (كجم)", returnedQty) { returnedQty = it }
                NumField("التالف (كجم)", damagedQty) { damagedQty = it }
                if (Dec.isPositive(damagedQty)) {
                    OutlinedTextField(
                        value = damageReason,
                        onValueChange = { damageReason = it },
                        label = { Text("سببُ التالف *") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                NumField("النقدُ المُحصَّل (ر.س)", collectedCash) { collectedCash = it }
                NumField("المتبقّي الفعليّ بالجرد لهذا الأمر (كجم)", actualRemainingQty) { actualRemainingQty = it }
                Text(
                    "أو",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                NumField("عددُ المركبة كلّها (كجم)", vehicleCountQty) { vehicleCountQty = it }
                OutlinedTextField(
                    value = closingNotes,
                    onValueChange = { closingNotes = it },
                    label = { Text("ملاحظاتُ الإقفال") },
                    modifier = Modifier.fillMaxWidth(),
                )
                if (error != null) {
                    Spacer(Modifier.height(8.dp))
                    StatusChip(error ?: "", ChipTone.DANGER)
                }
            }
        },
    )
}

/** حوارُ اعتماد المحاسب — الجردُ الفعليّ ومصيرُ المتبقّي وتفويضُ الترحيل. */
@Composable
private fun ApproveDialog(
    order: LoadOrderDto,
    busy: Boolean,
    onDismiss: () -> Unit,
    onSend: (kotlinx.serialization.json.JsonObject, (ActionResult) -> Unit) -> Unit,
) {
    var returnedQty by rememberSaveable(order.id) { mutableStateOf(order.returnedQty) }
    var damagedQty by rememberSaveable(order.id) { mutableStateOf(order.damagedQty) }
    var collectedCash by rememberSaveable(order.id) { mutableStateOf(order.collectedCash) }
    var actualRemainingQty by rememberSaveable(order.id) { mutableStateOf(order.actualRemainingQty) }
    var vehicleCountQty by rememberSaveable(order.id) { mutableStateOf(order.vehicleCountQty ?: "") }
    var remainingAction by rememberSaveable(order.id) { mutableStateOf(order.remainingAction ?: "return_to_main") }
    var damageInspected by rememberSaveable(order.id) { mutableStateOf(order.damageInspected) }
    var salaryDeductionApproved by rememberSaveable(order.id) { mutableStateOf(order.salaryDeductionApproved) }
    var settleStockAdjustment by rememberSaveable(order.id) { mutableStateOf(false) }
    var surplusAcknowledged by rememberSaveable(order.id) { mutableStateOf(false) }
    var notes by rememberSaveable(order.id) { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    val expectedRem = Dec.orZero(order.expectedRemainingQty)
    val otherCustody = Dec.orZero(order.otherCustodyQty)
    val liveActualRemaining = when {
        vehicleCountQty.isNotBlank() ->
            (Dec.parse(vehicleCountQty) ?: java.math.BigDecimal.ZERO).subtract(otherCustody).max(java.math.BigDecimal.ZERO)
        actualRemainingQty.isNotBlank() -> Dec.parse(actualRemainingQty)
        else -> Dec.parse(order.actualRemainingQty)
    }
    val liveVariance = liveActualRemaining?.let { expectedRem.subtract(it) } ?: Dec.parse(order.countVarianceQty)
    val isSurplus = liveVariance != null && liveVariance.signum() < 0
    val needsRemainingAction = liveActualRemaining != null && liveActualRemaining.signum() > 0

    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(
                onClick = {
                    error = when {
                        actualRemainingQty.isNotBlank() && vehicleCountQty.isNotBlank() ->
                            "أعلن واحدًا فقط: المتبقّي الفعليّ أو عددَ المركبة — لا الاثنين."
                        needsRemainingAction && remainingAction.isBlank() ->
                            "حدّد مصيرَ المتبقّي: إعادةٌ للمستودع الرئيسيّ أو بقاءٌ في السيارة."
                        isSurplus && !surplusAcknowledged ->
                            "جردُك يُظهر فائضًا (${Dec.kg(liveVariance?.abs()?.toPlainString())} كجم) — الإقرارُ الصريحُ إلزاميٌّ حمايةً من خطأ الإدخال."
                        else -> null
                    }
                    if (error != null) return@TextButton
                    onSend(
                        buildJsonObject {
                            if (returnedQty.isNotBlank()) put("returnedQty", Dec.wire(returnedQty))
                            if (damagedQty.isNotBlank()) put("damagedQty", Dec.wire(damagedQty))
                            if (collectedCash.isNotBlank()) put("collectedCash", Dec.wire(collectedCash))
                            put("damageInspected", damageInspected)
                            put("salaryDeductionApproved", salaryDeductionApproved)
                            if (actualRemainingQty.isNotBlank()) put("actualRemainingQty", Dec.wire(actualRemainingQty))
                            if (vehicleCountQty.isNotBlank()) put("vehicleCountQty", Dec.wire(vehicleCountQty))
                            if (needsRemainingAction) put("remainingAction", remainingAction)
                            put("settleStockAdjustment", settleStockAdjustment)
                            if (isSurplus) put("surplusAcknowledged", surplusAcknowledged)
                            if (notes.isNotBlank()) put("notes", notes.trim())
                        },
                    ) { result -> if (result is ActionResult.Synced) onDismiss() else error = resultMessage(result) }
                },
                enabled = !busy,
            ) { Text(if (busy) "جارٍ…" else "اعتمادُ الإقفال") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("رجوع") } },
        title = { Text("اعتماد إقفال ${order.number}") },
        text = {
            Column {
                KeyValue("المتوقّعُ البقاء", Dec.kg(order.expectedRemainingQty) + " كجم")
                KeyValue("المُعلنُ بالجرد", Dec.kg(liveActualRemaining?.toPlainString() ?: order.actualRemainingQty) + " كجم")
                KeyValue(
                    "فرقُ الاعتماد",
                    Dec.kg(liveVariance?.toPlainString() ?: order.countVarianceQty) + " كجم" +
                        when {
                            liveVariance == null || liveVariance.signum() == 0 -> " (مطابق)"
                            liveVariance.signum() < 0 -> " (فائض)"
                            else -> " (عجز)"
                        },
                )
                KeyValue("قيمةُ فرق الجرد بالتكلفة", Dec.money(order.countVarianceCostValue) + " ر.س")
                Spacer(Modifier.height(10.dp))
                NumField("تصحيحُ الجرد الفعليّ (كجم) — اختياريّ", actualRemainingQty) {
                    actualRemainingQty = it
                    if (it.isNotBlank()) vehicleCountQty = ""
                }
                Text(
                    "أو عددُ المركبة كلّها (يُشتقّ نصيبُ الأمر):",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                NumField("", vehicleCountQty) {
                    vehicleCountQty = it
                    if (it.isNotBlank()) actualRemainingQty = ""
                }
                if (needsRemainingAction) {
                    Text("مصيرُ المتبقّي الفعليّ:", fontWeight = FontWeight.SemiBold)
                    FilterChip(
                        selected = remainingAction == "return_to_main",
                        onClick = { remainingAction = "return_to_main" },
                        label = { Text("إعادةٌ إلى المستودع الرئيسيّ") },
                    )
                    FilterChip(
                        selected = remainingAction == "carry_over",
                        onClick = { remainingAction = "carry_over" },
                        label = { Text("يبقى في السيارة (عهدةٌ قائمة)") },
                    )
                }
                SwitchRow("فحصُ التالف تمّ (damageInspected)", damageInspected) { damageInspected = it }
                SwitchRow("تحميلُ قيمة العجز على المندوب (خصمٌ من الراتب)", salaryDeductionApproved) { salaryDeductionApproved = it }
                SwitchRow(
                    "تفويضُ ترحيل مستند الجرد الرسميّ (بدونه يبقى مسودةً والعهدةُ معلّقة)",
                    settleStockAdjustment,
                ) { settleStockAdjustment = it }
                if (isSurplus) {
                    SwitchRow("أُقرّ بأنّ الجردَ فائضٌ عن العهدة (${Dec.kg(liveVariance?.abs()?.toPlainString())} كجم) وصحيح", surplusAcknowledged) { surplusAcknowledged = it }
                }
                OutlinedTextField(
                    value = notes,
                    onValueChange = { notes = it },
                    label = { Text("ملاحظاتُ الاعتماد") },
                    modifier = Modifier.fillMaxWidth(),
                )
                if (error != null) {
                    Spacer(Modifier.height(8.dp))
                    StatusChip(error ?: "", ChipTone.DANGER)
                }
            }
        },
    )
}

/** حقلُ رقمٍ بفحصِ الإدخال. */
@Composable
private fun NumField(label: String, value: String, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = { if (Dec.isValidInput(it)) onChange(it) },
        label = { if (label.isNotBlank()) Text(label) },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** سطرُ مفتاح + مفتاحٍ كهربائيّ. */
@Composable
private fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

private fun resultMessage(result: ActionResult): String = when (result) {
    is ActionResult.Refused -> result.messageAr
    is ActionResult.Offline -> result.messageAr
    is ActionResult.Synced -> result.messageAr
}
