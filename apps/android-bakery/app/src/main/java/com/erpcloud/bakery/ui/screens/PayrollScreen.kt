package com.erpcloud.bakery.ui.screens

import androidx.activity.compose.BackHandler
import com.erpcloud.bakery.ui.components.rememberPickerInteractionSource

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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SecondaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.data.ActionResult
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.ActionButton
import com.erpcloud.bakery.ui.components.PickerTrigger
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.MissingPermissionHint
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
 * شاشةُ مسيّرات الرواتب (من تطبيق الطاقم) — تبويبان:
 *
 * 1. **المسيّرات**: إنشاءُ run لشهرٍ (yearMonth)، ترحيلُه (`payroll.post`)،
 *    ثمّ دفعُه (`payroll.pay` — يحتاج ملفَّ دفعٍ وطريقةً وخزينةً للنقد).
 * 2. **أذونُ الصرف**: `salary-payments` — ما صُرف فعلًا لكل موظفٍ وشهر.
 *
 * المنطقُ كما في الويب: مسيّرةٌ draft → posted → paid؛ والمعاينةُ (preview)
 * تجلبُ الإجماليّات من الخادم لا من العميل.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PayrollScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var tab by remember { mutableIntStateOf(0) }
    var showCreate by remember { mutableStateOf(false) }
    var postTarget by remember { mutableStateOf<String?>(null) }
    var payTarget by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { vm.loadPayroll() }

    // B1: تبويبُ «أذون الصرف» لم يكن يُحمَّل أبدًا — يُطلَقُ التحميلُ عند فتحه
    // (loadPayroll يجلبها مع المسيّرات، وهذا يضمنُ التحديثَ عند التنقّل إلى التبويب).
    LaunchedEffect(tab) {
        if (tab == 1 && state.staff.salaryPayments.isEmpty()) vm.loadSalaryPayments()
    }

    BackHandler(enabled = showCreate) { showCreate = false }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (showCreate) "إنشاء مسيّرة رواتب" else "الرواتب") },
                navigationIcon = {
                    IconButton(onClick = { if (showCreate) showCreate = false else onBack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع")
                    }
                },
            )
        },
        floatingActionButton = {
            if (!showCreate && tab == 0 && state.can("hrm.manage")) {
                FloatingActionButton(onClick = { showCreate = true }) {
                    Icon(Icons.Default.Add, contentDescription = "مسيّرة جديدة")
                }
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            if (!state.can("hrm.manage")) {
                MissingPermissionHint(
                    "إنشاء مسير رواتب",
                    "hrm.manage",
                    Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                )
            }
            SecondaryTabRow(selectedTabIndex = tab) {
                Tab(selected = tab == 0, onClick = { tab = 0; showCreate = false }, text = { Text("المسيّرات") })
                Tab(selected = tab == 1, onClick = { tab = 1; showCreate = false }, text = { Text("أذونُ الصرف") })
            }
            if (state.staff.loadingKey == "payroll" || state.staff.loadingKey == "salary-payments") {
                CenterLoading("جارٍ التحميل…")
                return@Column
            }
            if (showCreate && tab == 0) {
                CreateRunForm(vm, onDone = { showCreate = false })
                return@Column
            }
            if (tab == 0) {
                val runs = state.staff.payrollRuns
                if (runs.isEmpty()) {
                    EmptyState(state.staff.error ?: "لا مسيّراتٍ بعد.")
                } else {
                    LazyColumn(
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(runs, key = { it.id }) { run ->
                            val (statusText, tone) = Labels.docStatus(run.status)
                            SectionCard(
                                title = "مسيّرة ${run.yearMonth}",
                                subtitle = run.periodId?.let { "الفترة: $it" } ?: "",
                            ) {
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    StatusChip(statusText, tone)
                                    run.currency?.let { StatusChip(it, ChipTone.NEUTRAL) }
                                }
                                Spacer(Modifier.height(6.dp))
                                run.summary?.preview?.let { preview ->
                                    KeyValue("عددُ الموظفين", preview.employeeCount.toString())
                                    preview.netPayable?.let { KeyValue("الصافيُّ المستحقّ", Dec.money(it) + " ر.س") }
                                    if (preview.lines.isNotEmpty()) {
                                        KeyValue("سطورُ المسيّرة", preview.lines.size.toString())
                                    }
                                }
                                Spacer(Modifier.height(8.dp))
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    if (run.status == "draft" && state.can("hrm.payroll.post")) {
                                        OutlinedButton(onClick = { postTarget = run.id }) { Text("ترحيلُ المسيّرة") }
                                    }
                                    if (run.status == "posted" && state.can("hrm.payroll.post")) {
                                        OutlinedButton(onClick = { payTarget = run.id }) { Text("دفعُ المسيّرة") }
                                    }
                                }
                            }
                        }
                    }
                }
            } else {
                val payments = state.staff.salaryPayments
                if (payments.isEmpty()) {
                    EmptyState(state.staff.error ?: "لا أذونِ صرفٍ بعد.")
                } else {
                    LazyColumn(
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(payments, key = { it.id }) { payment ->
                            SectionCard(
                                title = payment.employeeName ?: "موظف",
                                subtitle = "إذن ${payment.number} · شهر ${payment.yearMonth} · ${Labels.dateOrDash(payment.paymentDate)}",
                            ) {
                                payment.net?.let { KeyValue("الصافي المصروف", Dec.money(it) + " ر.س") }
                                payment.method?.let { KeyValue("طريقةُ الصرف", Labels.payMethod(it)) }
                                payment.voucherNumber?.takeIf { it.isNotBlank() }?.let { KeyValue("رقمُ السند", it) }
                                payment.cashLocationName?.let { KeyValue("الخزينة", it) }
                                payment.branchName?.let { KeyValue("الفرع", it) }
                                payment.notes?.takeIf { it.isNotBlank() }?.let { KeyValue("ملاحظات", it) }
                            }
                        }
                    }
                }
            }
        }
    }

    if (postTarget != null) {
        val id = postTarget ?: ""
        ConfirmDialog(
            title = "ترحيلُ المسيّرة",
            message = "الترحيلُ يُقفل المعاينةَ ويُثبّت الإجماليّات — لا تعديلَ بعده. هل تُرحّلها؟",
            confirmLabel = "ترحيل",
            onConfirm = {
                postTarget = null
                vm.postPayrollRun(id, buildJsonObject { }) { result ->
                    if (result is ActionResult.Synced) vm.loadPayroll()
                }
            },
            onDismiss = { postTarget = null },
        )
    }
    if (payTarget != null) {
        val id = payTarget ?: ""
        PayRunDialog(vm, runId = id, onDone = { payTarget = null })
    }
}

/** إنشاءُ مسيّرة — `POST /payroll/runs` بـ yearMonth (YYYY-MM). */
@Composable
private fun CreateRunForm(vm: AppViewModel, onDone: () -> Unit) {
    val defaultMonth = java.time.LocalDate.now().let {
        java.lang.String.format(java.util.Locale.US, "%04d-%02d", it.year, it.monthValue)
    }
    var yearMonth by remember { mutableStateOf(defaultMonth) }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    SectionCard(
        title = "مسيّرةُ رواتبٍ جديدة",
        subtitle = "شهرٌ بصيغة YYYY-MM — تُنشأ مسودّةً ثمّ تُرحَّل وتُدفع",
        modifier = Modifier.padding(14.dp),
    ) {
        OutlinedTextField(
            value = yearMonth,
            onValueChange = { yearMonth = Dec.normalizeDigits(it) },
            label = { Text("الشهر (YYYY-MM) *") },
            modifier = Modifier.fillMaxWidth(),
        )
        if (error != null) {
            Spacer(Modifier.height(8.dp))
            StatusChip(error ?: "", ChipTone.DANGER)
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ActionButton(
                label = if (sending) "جارٍ الإنشاء…" else "إنشاءُ المسيّرة",
                onClick = {
                    val ym = Dec.normalizeDigits(yearMonth).trim()
                    error = if (!Regex("""^\d{4}-(0[1-9]|1[0-2])$""").matches(ym)) {
                        "الشهرُ بصيغة YYYY-MM (مثل 2026-10)."
                    } else null
                    if (error != null) return@ActionButton
                    sending = true
                    val body = buildJsonObject { put("yearMonth", ym) }
                    vm.createPayrollRun(body) { result ->
                        sending = false
                        if (result is ActionResult.Synced) {
                            vm.loadPayroll()
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

/** حوارُ دفع المسيّرة — ملفُّ الدفع إلزاميٌّ (سند/نقد/تحويل) + الخزينة للنقد. */
@Composable
private fun PayRunDialog(vm: AppViewModel, runId: String, onDone: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var method by remember { mutableStateOf("cash") }
    var cashLocationId by remember { mutableStateOf("") }
    var cashLabel by remember { mutableStateOf("") }
    var branchId by remember { mutableStateOf("") }
    var branchLabel by remember { mutableStateOf("") }
    var pickCash by remember { mutableStateOf(false) }
    var pickBranch by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { vm.ensureCashLocations() }

    LaunchedEffect(state.staff.cashLocations, state.staff.branches) {
        if (cashLocationId.isBlank()) {
            state.staff.cashLocations.firstOrNull()?.let { cashLocationId = it.id; cashLabel = it.name }
        }
        if (branchId.isBlank()) {
            (state.staff.branches.firstOrNull { it.isDefault } ?: state.staff.branches.firstOrNull())
                ?.let { branchId = it.id; branchLabel = it.nameAr }
        }
    }

    /** درجُ الدفع حسب الطريقة — نقديٌّ/شيكاتٌ من صندوق، وتحويلٌ من بنك (كما في حوار الدفع). */
    val methodDrawers = state.staff.cashLocations.filter { loc ->
        loc.isActive && (if (method == "bank_transfer") loc.kind == "bank" else loc.kind != "bank")
    }
    LaunchedEffect(method) {
        if (methodDrawers.none { it.id == cashLocationId }) {
            methodDrawers.firstOrNull()?.let { cashLocationId = it.id; cashLabel = it.name }
        }
    }

    androidx.compose.material3.AlertDialog(
        onDismissRequest = { if (!sending) onDone() },
        title = { Text("دفعُ المسيّرة") },
        text = {
            Column {
                Text("الملفُّ الرسميُّ للدفع (payment file) إلزاميٌّ عند الخادم — واخترِ الخزينةَ للنقد.", style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = branchLabel,
                    onValueChange = {},
                    readOnly = true,
                    interactionSource = rememberPickerInteractionSource { pickBranch = true },
                    label = { Text("الفرع * (لملفّ الدفع)") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { PickerTrigger(onClick = { pickBranch = true }) },
                )
                Spacer(Modifier.height(6.dp))
                listOf(
                    "cash" to "نقد",
                    "bank_transfer" to "تحويل بنكي",
                ).forEach { (value, labelAr) ->
                    Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                        androidx.compose.material3.RadioButton(selected = method == value, onClick = { method = value })
                        Text(labelAr)
                    }
                }
                OutlinedTextField(
                    value = cashLabel,
                    onValueChange = {},
                    readOnly = true,
                    interactionSource = rememberPickerInteractionSource { pickCash = true },
                    label = { Text("الخزينة *") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { PickerTrigger(onClick = { pickCash = true }) },
                )
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
                        branchId.isBlank() -> "اختر الفرع — ملفُّ الدفع يُقيَّد عليه."
                        cashLocationId.isBlank() -> "اختر الخزينة (إلزاميّةٌ في ملفّ الدفع عند الخادم)."
                        else -> null
                    }
                    if (error != null) return@TextButton
                    sending = true
                    val body = buildJsonObject {
                        put("branchId", branchId)
                        put("cashLocationId", cashLocationId)
                        put("method", method)
                    }
                    vm.payPayrollRun(runId, body) { result ->
                        sending = false
                        if (result is ActionResult.Synced) {
                            vm.loadPayroll()
                            onDone()
                        }
                    }
                },
                enabled = !sending,
            ) { Text(if (sending) "جارٍ الدفع…" else "دفع") }
        },
        dismissButton = {
            androidx.compose.material3.TextButton(onClick = onDone, enabled = !sending) { Text("إلغاء") }
        },
    )

    if (pickBranch) {
        PickerDialog(
            title = "اختر الفرع",
            items = state.staff.branches.map { PickerItem(it.id, it.nameAr, trailing = if (it.isDefault) "افتراضيّ" else null) },
            onDismiss = { pickBranch = false },
            onSelect = { branchId = it.id; branchLabel = it.title; pickBranch = false },
        )
    }
    if (pickCash) {
        PickerDialog(
            title = if (method == "bank_transfer") "اختر البنك" else "اختر الخزينة",
            items = methodDrawers.map { PickerItem(it.id, it.name, trailing = if (it.isDefault) "افتراضيّة" else null) },
            onDismiss = { pickCash = false },
            onSelect = { cashLocationId = it.id; cashLabel = it.title; pickCash = false },
        )
    }
}
