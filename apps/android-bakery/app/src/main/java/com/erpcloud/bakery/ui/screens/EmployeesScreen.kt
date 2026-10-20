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
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.data.ActionResult
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.ActionButton
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.MissingPermissionHint
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
 * شاشةُ الموظفين (من تطبيق الطاقم) — القائمةُ + إنشاءُ موظفٍ بإذن `hrm.manage`:
 * الرقمُ والاسمُ إلزاميّان، والقسمُ/الوظيفةُ/الفرعُ/تاريخُ التعيين اختياريّة،
 * ومكوّناتُ الراتب (أساسي/بدلات…) تُدخل كما في بطاقة الموظف.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EmployeesScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var showCreate by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { vm.loadEmployees() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("الموظفون") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
        floatingActionButton = {
            if (!showCreate && state.can("hrm.manage")) {
                FloatingActionButton(onClick = { showCreate = true }) {
                    Icon(Icons.Default.Add, contentDescription = "موظف جديد")
                }
            }
        },
    ) { padding ->
        // لا يُخفى الزرُّ بصمتًا: إن غاب الإذنُ يُشرَح السببُ بالعربية
        if (!state.can("hrm.manage")) {
            MissingPermissionHint("إضافة موظف", "hrm.manage", Modifier.padding(padding))
        }
        if (showCreate) {
            EmployeeForm(vm, onDone = { showCreate = false })
            return@Scaffold
        }
        if (state.staff.loadingKey == "employees") {
            CenterLoading("جارٍ تحميل الموظفين…", Modifier.padding(padding))
            return@Scaffold
        }
        val employees = state.staff.employees
        if (employees.isEmpty()) {
            EmptyState(state.staff.error ?: "لا موظفينَ بعد.", Modifier.padding(padding))
            return@Scaffold
        }
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(employees, key = { it.id }) { employee ->
                val (statusText, tone) = Labels.docStatus(employee.status)
                SectionCard(
                    title = employee.name,
                    subtitle = "رقمُ الموظف: ${employee.employeeNo.ifBlank { "—" }}",
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        StatusChip(statusText, tone)
                        employee.departmentName?.let { StatusChip(it, ChipTone.NEUTRAL) }
                    }
                    Spacer(Modifier.height(6.dp))
                    employee.jobName?.let { KeyValue("الوظيفة", it) }
                    employee.managementName?.let { KeyValue("الإدارة", it) }
                    employee.hireDate?.let { KeyValue("تاريخُ التعيين", Labels.dateOrDash(it)) }
                    employee.mobile?.let { KeyValue("الجوّال", it) } ?: employee.phone?.let { KeyValue("الهاتف", it) }
                    employee.accountCode?.let { KeyValue("رقمُ الحساب", it) }
                    if (employee.totalSalary != null && Dec.isPositive(employee.totalSalary)) {
                        KeyValue("إجماليُّ الراتب", Dec.money(employee.totalSalary) + " ر.س")
                    }
                    if (employee.salaryComponents.isNotEmpty()) {
                        employee.salaryComponents.forEach { (code, value) ->
                            if (Dec.isPositive(value)) KeyValue("· $code", Dec.money(value) + " ر.س")
                        }
                    }
                }
            }
        }
    }
}

/** إنشاءُ موظف — `POST /hrm/employees`. */
@Composable
private fun EmployeeForm(vm: AppViewModel, onDone: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var employeeNo by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var mobile by remember { mutableStateOf("") }
    var nationalId by remember { mutableStateOf("") }
    var hireDate by remember { mutableStateOf(todayIso()) }
    var baseSalary by remember { mutableStateOf("") }
    var departmentId by remember { mutableStateOf("") }
    var departmentLabel by remember { mutableStateOf("") }
    var jobId by remember { mutableStateOf("") }
    var jobLabel by remember { mutableStateOf("") }
    var branchId by remember { mutableStateOf("") }
    var branchLabel by remember { mutableStateOf("") }
    var pickDepartment by remember { mutableStateOf(false) }
    var pickJob by remember { mutableStateOf(false) }
    var pickBranch by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    LazyColumn(
        Modifier.fillMaxSize().padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            SectionCard(title = "موظفٌ جديد", subtitle = "الرقمُ والاسمُ إلزاميّان — والبقيةُ تُستكمل من بطاقة الموظف") {
                OutlinedTextField(value = employeeNo, onValueChange = { employeeNo = it }, label = { Text("رقمُ الموظف *") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("الاسم *") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = mobile, onValueChange = { mobile = it }, label = { Text("الجوّال") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = nationalId, onValueChange = { nationalId = it }, label = { Text("رقمُ الهويّة") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = hireDate, onValueChange = { hireDate = it }, label = { Text("تاريخُ التعيين (YYYY-MM-DD)") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = departmentLabel,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("القسم") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { IconButton(onClick = { pickDepartment = true }) { Text("اختر") } },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = jobLabel,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("الوظيفة") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { IconButton(onClick = { pickJob = true }) { Text("اختر") } },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = branchLabel,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("الفرع") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { IconButton(onClick = { pickBranch = true }) { Text("اختر") } },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = baseSalary,
                    onValueChange = { if (Dec.isValidInput(it)) baseSalary = it },
                    label = { Text("الراتبُ الأساسيّ (ر.س)") },
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (error != null) {
                    Spacer(Modifier.height(8.dp))
                    StatusChip(error ?: "", ChipTone.DANGER)
                }
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ActionButton(
                        label = if (sending) "جارٍ الحفظ…" else "حفظُ الموظف",
                        onClick = {
                            error = when {
                                employeeNo.isBlank() -> "رقمُ الموظف إلزاميّ."
                                name.isBlank() -> "اسمُ الموظف إلزاميّ."
                                (Dec.parse(baseSalary)?.signum() ?: 0) < 0 -> "الراتبُ موجبٌ فقط."
                                else -> null
                            }
                            if (error != null) return@ActionButton
                            sending = true
                            val body = buildJsonObject {
                                put("employeeNo", employeeNo.trim())
                                put("name", name.trim())
                                if (mobile.isNotBlank()) put("mobile", mobile.trim())
                                if (nationalId.isNotBlank()) put("nationalId", nationalId.trim())
                                if (hireDate.isNotBlank()) put("hireDate", hireDate.trim())
                                if (departmentId.isNotBlank()) put("departmentId", departmentId)
                                if (jobId.isNotBlank()) put("jobId", jobId)
                                if (branchId.isNotBlank()) put("branchId", branchId)
                                if (baseSalary.isNotBlank()) {
                                    put("salaryComponents", buildJsonObject { put("base", Dec.wire(baseSalary)) })
                                }
                            }
                            vm.createEmployee(body) { result ->
                                sending = false
                                if (result is ActionResult.Synced) {
                                    vm.loadEmployees()
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

    if (pickDepartment) {
        PickerDialog(
            title = "اختر القسم",
            items = state.staff.departments.map { PickerItem(it.id, it.name, trailing = it.code) },
            onDismiss = { pickDepartment = false },
            onSelect = { departmentId = it.id; departmentLabel = it.title },
        )
    }
    if (pickJob) {
        PickerDialog(
            title = "اختر الوظيفة",
            items = state.staff.jobs.map { PickerItem(it.id, it.name, trailing = it.code) },
            onDismiss = { pickJob = false },
            onSelect = { jobId = it.id; jobLabel = it.title },
        )
    }
    if (pickBranch) {
        PickerDialog(
            title = "اختر الفرع",
            items = state.staff.branches.map { PickerItem(it.id, it.nameAr, trailing = if (it.isDefault) "افتراضيّ" else null) },
            onDismiss = { pickBranch = false },
            onSelect = { branchId = it.id; branchLabel = it.title },
        )
    }
}
