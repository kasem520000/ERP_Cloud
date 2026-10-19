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
 * شاشةُ المنصرفات — إضافاتُ واستقطاعاتُ الراتب (من تطبيق الطاقم):
 * `GET/POST /payroll/adjustments` بإذنَي `payroll.adjust.view/create`
 * + **اعتمادُ** ما يحتاج موافقةً (`payroll.adjust.approve`).
 *
 * كلُّ منصرفٍ يبدأ من تاريخٍ (startsOn) ويحملُ قيمةً نصيّة (valueText) أو صيغةَ
 * نسبةٍ — والخادمُ يحسب أثرها في المسيّرة، لا التطبيق.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdjustmentsScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var showCreate by remember { mutableStateOf(false) }
    var approveTarget by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { vm.loadAdjustments() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("المنصرفات والإضافات") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
        floatingActionButton = {
            if (!showCreate && state.can("payroll.adjust.create")) {
                FloatingActionButton(onClick = { showCreate = true }) {
                    Icon(Icons.Default.Add, contentDescription = "منصرف جديد")
                }
            }
        },
    ) { padding ->
        if (showCreate) {
            AdjustmentForm(vm, onDone = { showCreate = false })
            return@Scaffold
        }
        if (state.staff.loadingKey == "adjustments") {
            CenterLoading("جارٍ تحميل المنصرفات…", Modifier.padding(padding))
            return@Scaffold
        }
        val adjustments = state.staff.adjustments
        if (adjustments.isEmpty()) {
            EmptyState(state.staff.error ?: "لا منصرفاتٍ بعد.", Modifier.padding(padding))
            return@Scaffold
        }
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(adjustments, key = { it.id }) { adjustment ->
                val (statusText, tone) = Labels.docStatus(adjustment.status)
                SectionCard(
                    title = adjustment.employeeName ?: "موظف",
                    subtitle = listOfNotNull(adjustment.typeName, adjustment.number?.let { "رقم $it" }).joinToString(" · "),
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        StatusChip(Labels.adjustmentKind(adjustment.kind), if (adjustment.kind == "addition") ChipTone.OK else ChipTone.WARN)
                        StatusChip(statusText, tone)
                    }
                    Spacer(Modifier.height(6.dp))
                    KeyValue("القيمة", Dec.money(adjustment.valueText) + " ر.س")
                    KeyValue("يسري من", Labels.dateOrDash(adjustment.startsOn))
                    adjustment.endsOn?.let { KeyValue("ينتهي في", Labels.dateOrDash(it)) }
                    adjustment.paymentMethod?.let { KeyValue("طريقةُ الصرف", Labels.payMethod(it)) }
                    adjustment.cashLocationName?.let { KeyValue("الخزينة", it) }
                    adjustment.reason?.takeIf { it.isNotBlank() }?.let { KeyValue("السبب", it) }
                    if (adjustment.status == "draft" && state.can("hrm.adjust.approve")) {
                        Spacer(Modifier.height(8.dp))
                        OutlinedButton(onClick = { approveTarget = adjustment.id }) { Text("اعتمادُ المنصرف") }
                    }
                }
            }
        }
    }

    if (approveTarget != null) {
        val id = approveTarget ?: ""
        ConfirmDialog(
            title = "اعتمادُ المنصرف",
            message = "الاعتمادُ يُدخلُ المنصرفَ في حساب الموظف ومسيّراته القادمة. هل تعتمده؟",
            confirmLabel = "اعتماد",
            onConfirm = {
                approveTarget = null
                vm.approveAdjustment(id) { result ->
                    if (result is ActionResult.Synced) vm.loadAdjustments()
                }
            },
            onDismiss = { approveTarget = null },
        )
    }
}

/** إنشاءُ منصرف/إضافة — موظفٌ + نوعٌ + قيمةٌ نصيّة + تاريخُ السريان. */
@Composable
private fun AdjustmentForm(vm: AppViewModel, onDone: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var employeeId by remember { mutableStateOf("") }
    var employeeLabel by remember { mutableStateOf("") }
    var kind by remember { mutableStateOf("deduction") }
    var valueText by remember { mutableStateOf("") }
    var startsOn by remember { mutableStateOf(todayIso()) }
    var paymentMethod by remember { mutableStateOf("cash") }
    var cashLocationId by remember { mutableStateOf("") }
    var cashLabel by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var pickEmployee by remember { mutableStateOf(false) }
    var pickKind by remember { mutableStateOf(false) }
    var pickMethod by remember { mutableStateOf(false) }
    var pickCash by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    LaunchedEffect(state.staff.cashLocations) {
        if (cashLocationId.isBlank()) {
            state.staff.cashLocations.firstOrNull()?.let { cashLocationId = it.id; cashLabel = it.name }
        }
    }

    LazyColumn(
        Modifier.fillMaxSize().padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            SectionCard(title = "منصرفٌ جديد", subtitle = "الاستقطاعُ يدخل مسيّرات الموظف من تاريخ السريان") {
                OutlinedTextField(
                    value = employeeLabel,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("الموظف *") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { IconButton(onClick = { pickEmployee = true }) { Text("اختر") } },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = if (kind == "addition") "إضافة" else "استقطاع",
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("النوع *") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { IconButton(onClick = { pickKind = true }) { Text("اختر") } },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = valueText,
                    onValueChange = { if (Dec.isValidInput(it)) valueText = it },
                    label = { Text("القيمة (ر.س) *") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = startsOn, onValueChange = { startsOn = it }, label = { Text("تاريخُ السريان (YYYY-MM-DD) *") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = Labels.payMethod(paymentMethod),
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("طريقةُ الصرف") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { IconButton(onClick = { pickMethod = true }) { Text("اختر") } },
                )
                Spacer(Modifier.height(8.dp))
                if (paymentMethod == "cash") {
                    OutlinedTextField(
                        value = cashLabel,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("الخزينة (للنقد)") },
                        modifier = Modifier.fillMaxWidth(),
                        trailingIcon = { IconButton(onClick = { pickCash = true }) { Text("اختر") } },
                    )
                    Spacer(Modifier.height(8.dp))
                }
                OutlinedTextField(value = notes, onValueChange = { notes = it }, label = { Text("السبب/ملاحظات") }, modifier = Modifier.fillMaxWidth())
                if (error != null) {
                    Spacer(Modifier.height(8.dp))
                    StatusChip(error ?: "", ChipTone.DANGER)
                }
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ActionButton(
                        label = if (sending) "جارٍ الحفظ…" else "حفظُ المنصرف",
                        onClick = {
                            error = when {
                                employeeId.isBlank() -> "اختر الموظف."
                                !Dec.isPositive(valueText) -> "القيمةُ رقمٌ موجبٌ (نصٌّ دقيق)."
                                startsOn.isBlank() || !Regex("""^\d{4}-\d{2}-\d{2}$""").matches(startsOn.trim()) ->
                                    "تاريخُ السريان بصيغة YYYY-MM-DD."
                                else -> null
                            }
                            if (error != null) return@ActionButton
                            sending = true
                            val body = buildJsonObject {
                                put("employeeId", employeeId)
                                put("kind", kind)
                                put("valueText", Dec.wire(valueText))
                                put("startsOn", startsOn.trim())
                                put("paymentMethod", paymentMethod)
                                if (paymentMethod == "cash" && cashLocationId.isNotBlank()) put("cashLocationId", cashLocationId)
                                if (notes.isNotBlank()) put("reason", notes.trim())
                            }
                            vm.createAdjustment(body) { result ->
                                sending = false
                                if (result is ActionResult.Synced) {
                                    vm.loadAdjustments()
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

    if (pickEmployee) {
        PickerDialog(
            title = "اختر الموظف",
            items = state.staff.employees.map { PickerItem(it.id, it.name, trailing = it.employeeNo) },
            onDismiss = { pickEmployee = false },
            onSelect = { employeeId = it.id; employeeLabel = it.title },
        )
    }
    if (pickKind) {
        PickerDialog(
            title = "نوعُ المنصرف",
            items = listOf(
                PickerItem("addition", "إضافة"),
                PickerItem("deduction", "استقطاع"),
            ),
            onDismiss = { pickKind = false },
            onSelect = {
                kind = it.id
                pickKind = false
            },
        )
    }
    if (pickMethod) {
        PickerDialog(
            title = "طريقةُ الصرف",
            items = listOf(
                PickerItem("cash", "نقدي"),
                PickerItem("bank", "تحويل بنكي"),
            ),
            onDismiss = { pickMethod = false },
            onSelect = {
                paymentMethod = it.id
                pickMethod = false
            },
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
}
