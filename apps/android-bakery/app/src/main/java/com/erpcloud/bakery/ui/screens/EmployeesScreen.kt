package com.erpcloud.bakery.ui.screens

import androidx.activity.compose.BackHandler
import com.erpcloud.bakery.ui.components.rememberPickerInteractionSource

import androidx.compose.foundation.Canvas
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
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.data.ActionResult
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.ActionButton
import com.erpcloud.bakery.ui.components.PickerTrigger
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.MissingPermissionHint
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.DatePickerField
import com.erpcloud.bakery.ui.components.EmptyState
import com.erpcloud.bakery.ui.components.InlineAction
import com.erpcloud.bakery.ui.components.KeyValue
import com.erpcloud.bakery.ui.components.PickerDialog
import com.erpcloud.bakery.ui.components.PickerItem
import com.erpcloud.bakery.ui.components.PullRefreshBox
import com.erpcloud.bakery.ui.components.SearchField
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.components.StatusChip
import com.erpcloud.bakery.ui.theme.BakeryColors
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
    var query by remember { mutableStateOf("") }
    var editTarget by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { vm.loadEmployees() }

    val inSubView = showCreate || editTarget != null
    BackHandler(enabled = inSubView) {
        if (showCreate) showCreate = false else editTarget = null
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        when {
                            showCreate -> "إضافة موظف جديد"
                            editTarget != null -> "تعديل بيانات الموظف"
                            else -> "الموظفون"
                        },
                    )
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Transparent),
                navigationIcon = {
                    IconButton(
                        onClick = {
                            if (showCreate) showCreate = false
                            else if (editTarget != null) editTarget = null
                            else onBack()
                        },
                    ) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
        floatingActionButton = {
            if (!showCreate && editTarget == null && state.can("hrm.manage")) {
                // FAB الموك-أب: حاويةٌ كهرمانيّةٌ فاتحةٌ (#FFEDD5) بأيقونةٍ غامقةٍ وزوايا ١٨.
                FloatingActionButton(onClick = { showCreate = true }, shape = MaterialTheme.shapes.medium) {
                    Icon(Icons.Default.Add, contentDescription = "موظف جديد")
                }
            }
        },
    ) { padding ->
        if (showCreate) {
            androidx.compose.foundation.layout.Box(Modifier.fillMaxSize().padding(padding)) {
                EmployeeForm(vm, onDone = { showCreate = false })
            }
            return@Scaffold
        }
        val editing = editTarget?.let { id -> state.staff.employees.firstOrNull { it.id == id } }
        if (editing != null) {
            androidx.compose.foundation.layout.Box(Modifier.fillMaxSize().padding(padding)) {
                EmployeeForm(vm, initial = editing, onDone = { editTarget = null })
            }
            return@Scaffold
        }
        PullRefreshBox(
            refreshing = state.staff.loadingKey == "employees",
            onRefresh = { vm.loadEmployees() },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            Column(Modifier.fillMaxSize()) {
                if (!state.can("hrm.manage")) {
                    MissingPermissionHint(
                        "إضافة موظف",
                        "hrm.manage",
                        Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                    )
                }
                SearchField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.padding(start = 14.dp, end = 14.dp, top = 6.dp),
                    placeholder = "ابحثُ بالاسم أو الرقم أو الجوّال",
                )
                val employees = if (query.isBlank()) {
                    state.staff.employees
                } else {
                    val needle = query.trim()
                    state.staff.employees.filter { row ->
                        row.name.contains(needle, ignoreCase = true) ||
                            row.employeeNo.contains(needle, ignoreCase = true) ||
                            (row.mobile?.contains(needle, ignoreCase = true) ?: false)
                    }
                }
                if (state.staff.loadingKey == "employees") {
                    CenterLoading("جارٍ تحميل الموظفين…")
                } else if (employees.isEmpty()) {
                    EmptyState(if (query.isBlank()) state.staff.error ?: "لا موظفينَ بعد." else "لا موظفَ يطابقُ البحث.")
                } else {
                    LazyColumn(
                        Modifier.fillMaxSize(),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 14.dp, end = 14.dp, bottom = 20.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(employees, key = { it.id }) { employee ->
                            val (statusText, tone) = Labels.docStatus(employee.status)
                            // الموك-أب 08: «موقوفة» بشارةِ خطرٍ حمراء — لا كهرمانِ التحذير.
                            val employmentTone = if (employee.status == "suspended") ChipTone.DANGER else tone
                            SectionCard(
                                title = employee.name,
                                subtitle = "رقمُ الموظف: ${employee.employeeNo.ifBlank { "—" }}",
                            ) {
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    StatusChip(statusText, employmentTone)
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
                                // تفصيلُ مكوّناتِ الراتب بعد فاصلٍ متقطّع — الصفوفُ الموجبةُ فقط كما كانت.
                                val visibleComponents = employee.salaryComponents.filter { (_, value) -> Dec.isPositive(value) }
                                if (visibleComponents.isNotEmpty()) {
                                    SalaryComponentsSeparator()
                                    visibleComponents.forEach { (code, value) ->
                                        KeyValue("· ${salaryComponentLabel(code)}", Dec.money(value) + " ر.س")
                                    }
                                }
                                Spacer(Modifier.height(8.dp))
                                if (state.can("hrm.manage")) {
                                    InlineAction(label = "تعديل", onClick = { editTarget = employee.id })
                                } else {
                                    MissingPermissionHint("تعديل موظف", "hrm.manage")
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** إنشاءُ/تعديلُ موظف — `POST /hrm/employees` للإنشاء و`PATCH /hrm/employees/{id}`
 * للتعديل: الرقمُ والاسمُ إلزاميّان، والقسمُ/الوظيفةُ/الفرعُ/تاريخُ التعيين اختياريّة،
 * ومكوّناتُ الراتب السبعة (أساسي/سكن/نقل/طعام/تأمين/علاوة/أخرى) تُرسَل في
 * `salaryComponents` كما في بطاقة الموظف. عند التعديل يُحافَظُ على أيِّ مكوّنٍ
 * آخر لا يُحرِّرُه النموذج. */
@Composable
private fun EmployeeForm(
    vm: AppViewModel,
    onDone: () -> Unit,
    initial: com.erpcloud.bakery.data.api.EmployeeDto? = null,
) {
    val state by vm.uiState.collectAsState()
    var employeeNo by remember { mutableStateOf(initial?.employeeNo ?: "") }
    var name by remember { mutableStateOf(initial?.name ?: "") }
    var mobile by remember { mutableStateOf(initial?.mobile ?: "") }
    var nationalId by remember { mutableStateOf(initial?.nationalId ?: "") }
    var hireDate by remember { mutableStateOf(initial?.hireDate ?: todayIso()) }
    var departmentId by remember { mutableStateOf(initial?.departmentId ?: "") }
    var departmentLabel by remember {
        mutableStateOf(initial?.departmentId?.let { id -> state.staff.departments.firstOrNull { it.id == id }?.name } ?: "")
    }
    var jobId by remember { mutableStateOf(initial?.jobId ?: "") }
    var jobLabel by remember {
        mutableStateOf(initial?.jobId?.let { id -> state.staff.jobs.firstOrNull { it.id == id }?.name } ?: "")
    }
    var branchId by remember { mutableStateOf(initial?.branchId ?: "") }
    var branchLabel by remember {
        mutableStateOf(initial?.branchId?.let { id -> state.staff.branches.firstOrNull { it.id == id }?.nameAr } ?: "")
    }
    var basic by remember { mutableStateOf(salaryOf(initial, "basic", "base")) }
    var housing by remember { mutableStateOf(salaryOf(initial, "housing")) }
    var transport by remember { mutableStateOf(salaryOf(initial, "transport")) }
    var food by remember { mutableStateOf(salaryOf(initial, "food")) }
    var medical by remember { mutableStateOf(salaryOf(initial, "medical")) }
    var fixedBonus by remember { mutableStateOf(salaryOf(initial, "fixedBonus")) }
    var other by remember { mutableStateOf(salaryOf(initial, "other")) }
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
            SectionCard(
                title = if (initial == null) "موظفٌ جديد" else "تعديلُ الموظف",
                subtitle = if (initial == null) "الرقمُ والاسمُ إلزاميّان — ومكوّناتُ الراتب كما في بطاقة الموظف" else "تعديلٌ جزئيّ بإذن hrm.manage — يُحافَظُ على مكوّناتِ الراتب غير المعروفة",
            ) {
                OutlinedTextField(value = employeeNo, onValueChange = { employeeNo = it }, label = { Text("رقمُ الموظف *") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("الاسم *") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = mobile, onValueChange = { mobile = it }, label = { Text("الجوّال") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = nationalId, onValueChange = { nationalId = it }, label = { Text("رقمُ الهويّة") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                DatePickerField(label = "تاريخُ التعيين (YYYY-MM-DD)", value = hireDate, onValueChange = { hireDate = it })
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = departmentLabel,
                    onValueChange = {},
                    readOnly = true,
                    interactionSource = rememberPickerInteractionSource { pickDepartment = true },
                    label = { Text("القسم") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { PickerTrigger(onClick = { pickDepartment = true }) },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = jobLabel,
                    onValueChange = {},
                    readOnly = true,
                    interactionSource = rememberPickerInteractionSource { pickJob = true },
                    label = { Text("الوظيفة") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { PickerTrigger(onClick = { pickJob = true }) },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = branchLabel,
                    onValueChange = {},
                    readOnly = true,
                    interactionSource = rememberPickerInteractionSource { pickBranch = true },
                    label = { Text("الفرع") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { PickerTrigger(onClick = { pickBranch = true }) },
                )
                Spacer(Modifier.height(10.dp))
                Text("مكوّناتُ الراتب (ر.س)", style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(6.dp))
                SalaryField("الراتبُ الأساسيّ", basic) { basic = it }
                SalaryField("بدلُ السكن", housing) { housing = it }
                SalaryField("بدلُ النقل", transport) { transport = it }
                SalaryField("بدلُ الطعام", food) { food = it }
                SalaryField("بدلُ التأمين الطبّيّ", medical) { medical = it }
                SalaryField("علاوةٌ ثابتة", fixedBonus) { fixedBonus = it }
                SalaryField("أخرى", other) { other = it }
                if (error != null) {
                    Spacer(Modifier.height(8.dp))
                    StatusChip(error ?: "", ChipTone.DANGER)
                }
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ActionButton(
                        label = when {
                            sending -> "جارٍ الحفظ…"
                            initial == null -> "حفظُ الموظف"
                            else -> "حفظُ التعديل"
                        },
                        onClick = {
                            error = when {
                                employeeNo.isBlank() -> "رقمُ الموظف إلزاميّ."
                                name.isBlank() -> "اسمُ الموظف إلزاميّ."
                                listOf(basic, housing, transport, food, medical, fixedBonus, other)
                                    .any { (Dec.parse(it)?.signum() ?: 0) < 0 } -> "قيمُ مكوّناتِ الراتب موجبةٌ فقط."
                                else -> null
                            }
                            if (error != null) return@ActionButton
                            sending = true
                            val components = buildJsonObject {
                                if (basic.isNotBlank()) put("basic", Dec.wire(basic))
                                if (housing.isNotBlank()) put("housing", Dec.wire(housing))
                                if (transport.isNotBlank()) put("transport", Dec.wire(transport))
                                if (food.isNotBlank()) put("food", Dec.wire(food))
                                if (medical.isNotBlank()) put("medical", Dec.wire(medical))
                                if (fixedBonus.isNotBlank()) put("fixedBonus", Dec.wire(fixedBonus))
                                if (other.isNotBlank()) put("other", Dec.wire(other))
                            }
                            val body = buildJsonObject {
                                put("employeeNo", employeeNo.trim())
                                put("name", name.trim())
                                if (mobile.isNotBlank()) put("mobile", mobile.trim())
                                if (nationalId.isNotBlank()) put("nationalId", nationalId.trim())
                                if (hireDate.isNotBlank()) put("hireDate", hireDate.trim())
                                if (departmentId.isNotBlank()) put("departmentId", departmentId)
                                if (jobId.isNotBlank()) put("jobId", jobId)
                                if (branchId.isNotBlank()) put("branchId", branchId)
                                if (initial == null) {
                                    if (components.isNotEmpty()) put("salaryComponents", components)
                                } else {
                                    val merged = buildJsonObject {
                                        initial.salaryComponents.forEach { (code, value) ->
                                            if (code !in SALARY_KEYS && value.isNotBlank()) put(code, value)
                                        }
                                        components.forEach { key, value -> put(key, value) }
                                    }
                                    put("salaryComponents", merged)
                                }
                            }
                            if (initial == null) {
                                vm.createEmployee(body) { result ->
                                    sending = false
                                    if (result is ActionResult.Synced) {
                                        vm.loadEmployees()
                                        onDone()
                                    }
                                }
                            } else {
                                vm.updateEmployee(initial.id, body) { result ->
                                    sending = false
                                    if (result is ActionResult.Synced) {
                                        vm.loadEmployees()
                                        onDone()
                                    }
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

/** قراءةُ مكوّنِ راتبٍ من بطاقة الموظف — أوّلُ مفتاحٍ غيرِ فارغٍ من المفاتيح المعطاة
 * (يُقرأ «basic» و«base» معًا لأنّ نموذجَ الإشاء القديم كان يُرسِل «base»). */
private fun salaryOf(employee: com.erpcloud.bakery.data.api.EmployeeDto?, vararg keys: String): String {
    val components = employee?.salaryComponents ?: return ""
    for (key in keys) {
        val value = components[key]
        if (!value.isNullOrBlank()) return value
    }
    return ""
}

/** مفاتيحُ مكوّناتِ الراتب التي يُحرِّرها النموذج — ما عداها يُحفَظُ عند التعديل كما هو. */
private val SALARY_KEYS = setOf("basic", "base", "housing", "transport", "food", "medical", "fixedBonus", "other")

/** أسماءُ مكوّناتِ الراتب كما في بطاقة الموظف والموك-أب 08 — غيرُ المعروف يُعرَضُ خامًا كما جاء. */
private fun salaryComponentLabel(code: String): String = when (code) {
    "basic", "base" -> "الراتبُ الأساسيّ"
    "housing" -> "بدلُ السكن"
    "transport" -> "بدلُ النقل"
    "food" -> "بدلُ الطعام"
    "medical" -> "بدلُ التأمين الطبّيّ"
    "fixedBonus" -> "علاوةٌ ثابتة"
    "other" -> "أخرى"
    else -> code
}

/** فاصلٌ متقطّعٌ دافئٌ يفصلُ تفصيلَ مكوّناتِ الراتب عن بياناتِ البطاقة (كما في الموك-أب 08). */
@Composable
private fun SalaryComponentsSeparator() {
    val hairline = BakeryColors.Hairline
    Canvas(Modifier.fillMaxWidth().height(9.dp)) {
        val y = size.height / 2f
        drawLine(
            color = hairline,
            start = Offset(0f, y),
            end = Offset(size.width, y),
            strokeWidth = 1.dp.toPx(),
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 5.dp.toPx())),
        )
    }
}

/** حقلُ مكوّنِ راتبٍ رقميّ — أرقامٌ وعلامةٌ عشريّة فقط. */
@Composable
private fun SalaryField(label: String, value: String, onValueChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = { if (Dec.isValidInput(it)) onValueChange(it) },
        label = { Text(label) },
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Decimal),
        modifier = Modifier.fillMaxWidth(),
    )
}
