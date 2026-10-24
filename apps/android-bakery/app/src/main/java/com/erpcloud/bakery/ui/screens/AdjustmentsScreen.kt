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
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.data.ActionResult
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.ActionButton
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.MissingPermissionHint
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.ConfirmDialog
import com.erpcloud.bakery.ui.components.DatePickerField
import com.erpcloud.bakery.ui.components.EmptyState
import com.erpcloud.bakery.ui.components.KeyValue
import com.erpcloud.bakery.ui.components.PickerDialog
import com.erpcloud.bakery.ui.components.PickerItem
import com.erpcloud.bakery.ui.components.PullRefreshBox
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.components.StatusChip
import com.erpcloud.bakery.util.Dec
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * شاشةُ المنصرفات — إضافاتُ واستقطاعاتُ الراتب (من تطبيق الطاقم):
 * `GET/POST /hrm/adjustments` بإذنَي `hrm.view/hrm.manage`
 * + **اعتمادُ** ما يحتاج موافقةً (`hrm.adjust.approve`).
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
            if (!showCreate && state.can("hrm.manage")) {
                FloatingActionButton(onClick = { showCreate = true }) {
                    Icon(Icons.Default.Add, contentDescription = "منصرف جديد")
                }
            }
        },
    ) { padding ->
        // لا يُخفى الزرُّ بصمتًا: إن غاب الإذنُ يُشرَح السببُ بالعربية
        if (!state.can("hrm.manage")) {
            MissingPermissionHint("تسجيل منصرف", "hrm.manage", Modifier.padding(padding))
        }
        if (showCreate) {
            AdjustmentForm(vm, onDone = { showCreate = false })
            return@Scaffold
        }
        PullRefreshBox(
            refreshing = state.staff.loadingKey == "adjustments",
            onRefresh = { vm.loadAdjustments() },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            if (state.staff.loadingKey == "adjustments") {
                CenterLoading("جارٍ تحميل المنصرفات…")
            } else {
                val adjustments = state.staff.adjustments
                if (adjustments.isEmpty()) {
                    EmptyState(state.staff.error ?: "لا منصرفاتٍ بعد.")
                } else {
                    LazyColumn(
                        Modifier.fillMaxSize(),
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
                } // LazyColumn
                } // else: non-empty list
            } // else: loaded
        } // PullRefreshBox
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
/**
 * إنشاءُ منصرف/إضافة — مرآةُ نافذة الويب: موظفٌ + **نوعُ إجراءٍ** (إلزاميّ عند الخادم)
 * + قيمةٌ نصيّة + تاريخُ سريان. والنوعُ نفسُه يحملُ «إضافة/استقطاع»، فلا يُرسَلُ
 * `kind` من هنا إطلاقًا — الخادمُ يشتقُّه من النوع.
 *
 * «تُخصم من الراتب» (subFromSalary): الإيقافُ يعني دفعَ المبلغ اليوم من صندوقٍ أو
 * بنكٍ — والخادمُ يطلبُ حينها `cashLocationId` حتمًا (٤٢٢ بلاهُ).
 */
@Composable
private fun AdjustmentForm(vm: AppViewModel, onDone: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var employeeId by remember { mutableStateOf("") }
    var employeeLabel by remember { mutableStateOf("") }
    var typeId by remember { mutableStateOf("") }
    var typeLabel by remember { mutableStateOf("") }
    var typeKind by remember { mutableStateOf("deduction") }
    var valueText by remember { mutableStateOf("") }
    var startsOn by remember { mutableStateOf(todayIso()) }
    var endsOn by remember { mutableStateOf("") }
    var subFromSalary by remember { mutableStateOf(true) }
    var paymentMethod by remember { mutableStateOf("cash") }
    var cashLocationId by remember { mutableStateOf("") }
    var cashLabel by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var pickEmployee by remember { mutableStateOf(false) }
    var pickType by remember { mutableStateOf(false) }
    var pickMethod by remember { mutableStateOf(false) }
    var pickCash by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    val activeTypes = state.staff.adjustmentTypes.filter { it.isActive != false }

    /** درجُ الصرف حسب الطريقة — نقديٌّ من صندوق، وتحويلٌ من بنك (كما في حوار الدفع). */
    val methodDrawers = state.staff.cashLocations.filter { loc ->
        loc.isActive && (if (paymentMethod == "cash") loc.kind != "bank" else loc.kind == "bank")
    }
    LaunchedEffect(paymentMethod, state.staff.cashLocations.size) {
        if (methodDrawers.none { it.id == cashLocationId }) {
            val first = methodDrawers.firstOrNull()
            cashLocationId = first?.id ?: ""
            cashLabel = first?.name ?: ""
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
                    value = typeLabel,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("نوعُ الإجراء *") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { IconButton(onClick = { pickType = true }) { Text("اختر") } },
                    supportingText = {
                        if (activeTypes.isEmpty()) {
                            Text("لا أنواعُ إجراءاتٍ مسجَّلة بعد — أضِف نوعًا من إدارة الطاقم أولًا.")
                        } else if (typeId.isNotBlank()) {
                            Text(if (typeKind == "addition") "إضافةٌ على الراتب" else "استقطاعٌ من الراتب")
                        }
                    },
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
                DatePickerField(label = "تاريخُ السريان (YYYY-MM-DD) *", value = startsOn, onValueChange = { startsOn = it })
                Spacer(Modifier.height(8.dp))
                DatePickerField(label = "تاريخُ الانتهاء (اختياريّ)", value = endsOn, onValueChange = { endsOn = it })
                Spacer(Modifier.height(4.dp))
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("تُخصم من الراتب", style = MaterialTheme.typography.bodyMedium)
                        Text(
                            "عند إيقافه يُصرَف المبلغ اليوم من صندوقٍ أو بنك",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Switch(checked = subFromSalary, onCheckedChange = { subFromSalary = it })
                }
                if (!subFromSalary) {
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = Labels.payMethod(paymentMethod),
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("طريقةُ الصرف *") },
                        modifier = Modifier.fillMaxWidth(),
                        trailingIcon = { IconButton(onClick = { pickMethod = true }) { Text("اختر") } },
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = cashLabel,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text(if (paymentMethod == "cash") "الصندوق (للنقدي) *" else "البنك (للتحويل) *") },
                        modifier = Modifier.fillMaxWidth(),
                        trailingIcon = { IconButton(onClick = { pickCash = true }) { Text("اختر") } },
                    )
                }
                Spacer(Modifier.height(8.dp))
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
                                typeId.isBlank() -> "اختر نوعَ الإجراء — لا يقبلُ الخادمُ منصرفًا بلا نوع."
                                !Dec.isPositive(valueText) -> "القيمةُ رقمٌ موجبٌ (نصٌّ دقيق)."
                                startsOn.isBlank() || !Regex("""^\d{4}-\d{2}-\d{2}$""").matches(startsOn.trim()) ->
                                    "تاريخُ السريان بصيغة YYYY-MM-DD."
                                endsOn.isNotBlank() && !Regex("""^\d{4}-\d{2}-\d{2}$""").matches(endsOn.trim()) ->
                                    "تاريخُ الانتهاء بصيغة YYYY-MM-DD."
                                !subFromSalary && cashLocationId.isBlank() ->
                                    "اختر الصندوق أو البنك الذي يخرج منه المبلغ."
                                else -> null
                            }
                            if (error != null) return@ActionButton
                            sending = true
                            val body = buildJsonObject {
                                put("employeeId", employeeId)
                                put("typeId", typeId)
                                put("valueText", Dec.wire(valueText))
                                put("startsOn", startsOn.trim())
                                if (endsOn.isNotBlank()) put("endsOn", endsOn.trim())
                                put("subFromSalary", subFromSalary)
                                if (!subFromSalary) {
                                    put("paymentMethod", paymentMethod)
                                    put("cashLocationId", cashLocationId)
                                }
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
            onSelect = { employeeId = it.id; employeeLabel = it.title; pickEmployee = false },
        )
    }
    if (pickType) {
        PickerDialog(
            title = "نوعُ الإجراء",
            items = activeTypes.map { t ->
                PickerItem(t.id, t.name, trailing = if (t.kind == "addition") "إضافة" else "استقطاع")
            },
            onDismiss = { pickType = false },
            onSelect = { item ->
                typeId = item.id
                typeLabel = item.title
                typeKind = activeTypes.firstOrNull { it.id == item.id }?.kind ?: "deduction"
                pickType = false
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
            title = if (paymentMethod == "cash") "اختر الصندوق" else "اختر البنك",
            items = methodDrawers.map { PickerItem(it.id, it.name, trailing = if (it.isDefault) "افتراضيّة" else null) },
            onDismiss = { pickCash = false },
            onSelect = { cashLocationId = it.id; cashLabel = it.title; pickCash = false },
        )
    }
}
