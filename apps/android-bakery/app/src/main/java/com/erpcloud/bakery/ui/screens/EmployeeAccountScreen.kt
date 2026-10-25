package com.erpcloud.bakery.ui.screens

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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.PickerTrigger
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.DatePickerField
import com.erpcloud.bakery.ui.components.EmptyState
import com.erpcloud.bakery.ui.components.KeyValue
import com.erpcloud.bakery.ui.components.PickerDialog
import com.erpcloud.bakery.ui.components.PickerItem
import com.erpcloud.bakery.ui.components.PullRefreshBox
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.components.StatusChip
import com.erpcloud.bakery.util.Dec

/**
 * شاشةُ حساب الموظف (من تطبيق الطاقم) — `GET /payroll/employee-statement`:
 * موظفٌ + فترةٌ (من/إلى أو **الفترةُ كاملة**) → ملخّصٌ (مدين/دائن/رصيد)
 * وقيودُ الحساب صفًا صفًا كما يحسبها الخادم.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EmployeeAccountScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var employeeId by remember { mutableStateOf("") }
    var employeeLabel by remember { mutableStateOf("") }
    var from by remember { mutableStateOf("${java.time.Year.now().value}-01-01") }
    var to by remember { mutableStateOf(todayIso()) }
    var fullPeriod by remember { mutableStateOf(false) }
    var pickEmployee by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    androidx.compose.runtime.LaunchedEffect(Unit) { if (state.staff.employees.isEmpty()) vm.loadEmployees() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("حسابُ الموظف") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
    ) { padding ->
        PullRefreshBox(
            refreshing = state.staff.loadingKey == "employee-statement",
            onRefresh = {
                if (employeeId.isNotBlank()) vm.employeeStatement(employeeId, from.trim(), to.trim(), fullPeriod)
                else vm.loadEmployees()
            },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            Column(Modifier.fillMaxSize().padding(horizontal = 14.dp)) {
                SectionCard(title = "بياناتُ الكشف") {
                    OutlinedTextField(
                        value = employeeLabel,
                        onValueChange = {},
                        readOnly = true,
                        interactionSource = rememberPickerInteractionSource { pickEmployee = true },
                        label = { Text("الموظف *") },
                        modifier = Modifier.fillMaxWidth(),
                        trailingIcon = { PickerTrigger(onClick = { pickEmployee = true }) },
                    )
                    if (!fullPeriod) {
                        Spacer(Modifier.height(8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            DatePickerField(
                                label = "من",
                                value = from,
                                onValueChange = { from = it },
                                modifier = Modifier.weight(1f),
                            )
                            DatePickerField(
                                label = "إلى",
                                value = to,
                                onValueChange = { to = it },
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                        androidx.compose.material3.Checkbox(checked = fullPeriod, onCheckedChange = { fullPeriod = it })
                        Text("الفترةُ الكاملة (كلُّ القيود)")
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedButton(
                            onClick = {
                                error = when {
                                    employeeId.isBlank() -> "اختر الموظف."
                                    !fullPeriod && !(Regex("""^\d{4}-\d{2}-\d{2}$""").matches(from.trim()) &&
                                        Regex("""^\d{4}-\d{2}-\d{2}$""").matches(to.trim())) ->
                                        "التاريخانِ بصيغة YYYY-MM-DD."
                                    else -> null
                                }
                                if (error == null) {
                                    vm.employeeStatement(employeeId, from.trim(), to.trim(), fullPeriod)
                                }
                            },
                            modifier = Modifier.weight(1f),
                        ) { Text("عرضُ الكشف") }
                    }
                    if (error != null) {
                        Spacer(Modifier.height(6.dp))
                        StatusChip(error ?: "", ChipTone.DANGER)
                    }
                }
                Spacer(Modifier.height(10.dp))

                if (state.staff.loadingKey == "employee-statement") {
                    CenterLoading("جارٍ توليد كشف الحساب…")
                } else {
                    val statement = state.staff.employeeStatement
                    if (statement == null) {
                        EmptyState("اختر موظفًا واضغط «عرضُ الكشف».")
                    } else {
                        LazyColumn(
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 20.dp),
                        ) {
                            item {
                                SectionCard(
                                    title = "ملخّصُ الحساب",
                                    subtitle = "من ${Labels.dateOrDash(statement.from)} إلى ${Labels.dateOrDash(statement.to)}",
                                ) {
                                    KeyValue("الموظف", statement.employee.name)
                                    KeyValue("إجماليُّ المدين", Dec.money(statement.summary.totalDebit) + " ر.س")
                                    KeyValue("إجماليُّ الدائن", Dec.money(statement.summary.totalCredit) + " ر.س")
                                    val (balanceText, tone) = when {
                                        Dec.isPositive(statement.summary.balanceDebit) ->
                                            Dec.money(statement.summary.balanceDebit) + " ر.س علينا" to ChipTone.WARN
                                        Dec.isPositive(statement.summary.balanceCredit) ->
                                            Dec.money(statement.summary.balanceCredit) + " ر.س له" to ChipTone.OK
                                        else -> "مُقفَّل" to ChipTone.OK
                                    }
                                    KeyValue("الرصيد", balanceText)
                                    Spacer(Modifier.height(4.dp))
                                    StatusChip("رصيد", tone)
                                }
                            }
                            if (statement.rows.isEmpty()) {
                                item { EmptyState("لا قيودَ في هذه الفترة.") }
                            } else {
                                items(statement.rows, key = { it.seq }) { row ->
                                    SectionCard(
                                        title = row.description?.takeIf { it.isNotBlank() } ?: row.entryNumber ?: "قيد",
                                        subtitle = "${Labels.dateOrDash(row.date)}" + (row.entryNumber?.let { " · قيد $it" } ?: ""),
                                    ) {
                                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                            if (Dec.isPositive(row.debit)) StatusChip("مدين " + Dec.money(row.debit), ChipTone.WARN)
                                            if (Dec.isPositive(row.credit)) StatusChip("دائن " + Dec.money(row.credit), ChipTone.OK)
                                            row.branchName?.let { StatusChip(it, ChipTone.NEUTRAL) }
                                        }
                                        row.entryType.takeIf { it.isNotBlank() }?.let {
                                            Spacer(Modifier.height(4.dp))
                                            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        }
                                        row.runningBalance?.let { KeyValue("الرصيدُ بعد القيد", Dec.money(it) + " ر.س") }
                                    }
                                }
                            }
                        }
                    }
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
}
