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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.data.ActionResult
import com.erpcloud.bakery.data.api.SalesRegistryDto
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.ActionButton
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.DocumentDetailDialog
import com.erpcloud.bakery.ui.components.InlineAction
import com.erpcloud.bakery.ui.components.MissingPermissionHint
import com.erpcloud.bakery.ui.components.SearchField
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
 * شاشةُ سجلّ مناديب المبيعات (من تطبيق الطاقم) — `GET/POST /sales/salesmen`
 * بإذنَي `sales.view` / `sales.salesman.manage`: تعريفُ المندوبِ ونسبُ عمولاته
 * (البيع/التحصيل/الربح) وربطُه ببطاقة موظف.
 *
 * ملاحظةُ الفصل: هذه بطاقاتُ مناديب المبيعات الرسميّة — أمّا عهدُ التوزيع
 * (سيارات الخبز) فشأنُها شاشةُ «المناديب والعهدة» في وحدة التوزيع.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SalesRegistryScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var showCreate by remember { mutableStateOf(false) }
    var editTarget by remember { mutableStateOf<SalesRegistryDto?>(null) }
    var search by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        vm.loadSalesRegistry()
        vm.ensureEmployees()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("مناديبُ المبيعات") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
        floatingActionButton = {
            if (!showCreate && state.can("sales.salesman.manage")) {
                FloatingActionButton(onClick = { showCreate = true }) {
                    Icon(Icons.Default.Add, contentDescription = "مندوب جديد")
                }
            }
        },
    ) { padding ->
        // لا يُخفى الزرُّ بصمتًا: إن غابَ الإذنُ يُشرَح السببُ بالعربية
        if (!state.can("sales.salesman.manage")) {
            MissingPermissionHint("إضافة مندوب أو تعديله", "sales.salesman.manage", Modifier.padding(padding))
        }
        if (showCreate) {
            SalesmanRegistryForm(vm, onDone = { showCreate = false })
            return@Scaffold
        }
        if (state.staff.loadingKey == "sales-registry") {
            CenterLoading("جارٍ تحميل المناديب…", Modifier.padding(padding))
            return@Scaffold
        }
        val registry = state.staff.salesRegistry
        if (registry.isEmpty()) {
            EmptyState(state.staff.error ?: "لا مناديبَ مبيعاتٍ بعد.", Modifier.padding(padding))
            return@Scaffold
        }
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                SearchField(
                    value = search,
                    onValueChange = { search = it },
                    placeholder = "بحثٌ بالاسم أو الجوّال…",
                )
            }
            val visible = registry.filter { salesman ->
                val needle = search.trim()
                needle.isBlank() ||
                    salesman.name.contains(needle, ignoreCase = true) ||
                    (salesman.mobile ?: "").contains(needle, ignoreCase = true)
            }
            if (visible.isEmpty()) {
                item { EmptyState("لا نتائجَ مطابقة.") }
            }
            items(visible, key = { it.id }) { salesman ->
                val employeeName = salesman.employeeId
                    ?.let { id -> state.staff.employees.firstOrNull { it.id == id }?.name }
                SectionCard(
                    title = salesman.name,
                    subtitle = employeeName?.let { "الموظف: $it" } ?: "بلا بطاقة موظفٍ مرتبطة",
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        StatusChip(if (salesman.active) "نشط" else "موقوف", if (salesman.active) ChipTone.OK else ChipTone.WARN)
                        salesman.mobile?.let { StatusChip(it, ChipTone.NEUTRAL) }
                    }
                    Spacer(Modifier.height(6.dp))
                    salesman.commissionRate?.let { KeyValue("عمولةُ المبيعات", Dec.money(it) + "%") }
                    salesman.collectionCommissionRate?.let { KeyValue("عمولةُ التحصيل", Dec.money(it) + "%") }
                    salesman.profitCommissionRate?.let { KeyValue("عمولةُ الربح", Dec.money(it) + "%") }
                    salesman.notes?.let { KeyValue("ملاحظات", it) }
                    if (state.can("sales.salesman.manage")) {
                        Spacer(Modifier.height(8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            InlineAction(label = "تعديل", onClick = { editTarget = salesman })
                        }
                    }
                }
            }
        }
    }
    editTarget?.let { salesman ->
        EditSalesmanDialog(
            vm = vm,
            salesman = salesman,
            onDismiss = { editTarget = null },
        )
    }
}

/** إنشاءُ مندوب مبيعات — `POST /sales/salesmen` (name إلزاميّ + العمولات). */
@Composable
private fun SalesmanRegistryForm(vm: AppViewModel, onDone: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var name by remember { mutableStateOf("") }
    var mobile by remember { mutableStateOf("") }
    var commissionRate by remember { mutableStateOf("") }
    var collectionRate by remember { mutableStateOf("") }
    var profitRate by remember { mutableStateOf("") }
    var employeeId by remember { mutableStateOf("") }
    var employeeLabel by remember { mutableStateOf("") }
    var pickEmployee by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    SectionCard(
        title = "مندوبُ مبيعاتٍ جديد",
        subtitle = "الاسمُ إلزاميّ — والعمولاتُ نسبٌ تُدخل نصوصًا دقيقة",
        modifier = Modifier.padding(14.dp),
    ) {
        OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("الاسم *") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = mobile, onValueChange = { mobile = it }, label = { Text("الجوّال") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = employeeLabel,
            onValueChange = {},
            readOnly = true,
            label = { Text("بطاقةُ الموظف (اختياريّ)") },
            modifier = Modifier.fillMaxWidth(),
            trailingIcon = { IconButton(onClick = { pickEmployee = true }) { Text("اختر") } },
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = commissionRate,
            onValueChange = { if (Dec.isValidInput(it)) commissionRate = it },
            label = { Text("عمولةُ المبيعات (%)") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = collectionRate,
            onValueChange = { if (Dec.isValidInput(it)) collectionRate = it },
            label = { Text("عمولةُ التحصيل (%)") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = profitRate,
            onValueChange = { if (Dec.isValidInput(it)) profitRate = it },
            label = { Text("عمولةُ الربح (%)") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.fillMaxWidth(),
        )
        if (error != null) {
            Spacer(Modifier.height(8.dp))
            StatusChip(error ?: "", ChipTone.DANGER)
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ActionButton(
                label = if (sending) "جارٍ الحفظ…" else "حفظُ المندوب",
                onClick = {
                    error = when {
                        name.isBlank() -> "اسمُ المندوب إلزاميّ."
                        listOf(commissionRate, collectionRate, profitRate).any { Dec.parse(it)?.signum() == -1 } ->
                            "النِّسَبُ لا تقبل سالبًا."
                        else -> null
                    }
                    if (error != null) return@ActionButton
                    sending = true
                    val body = buildJsonObject {
                        put("name", name.trim())
                        if (mobile.isNotBlank()) put("mobile", mobile.trim())
                        if (employeeId.isNotBlank()) put("employeeId", employeeId)
                        if (commissionRate.isNotBlank()) put("commissionRate", Dec.wire(commissionRate))
                        if (collectionRate.isNotBlank()) put("collectionCommissionRate", Dec.wire(collectionRate))
                        if (profitRate.isNotBlank()) put("profitCommissionRate", Dec.wire(profitRate))
                    }
                    vm.createSalesRegistry(body) { result ->
                        sending = false
                        if (result is ActionResult.Synced) {
                            vm.loadSalesRegistry()
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

    if (pickEmployee) {
        // الموظفون يُحمَّلون عند الحاجة (اختياريٌّ هنا — فشلُه لا يمنع الإنشاء).
        LaunchedEffect(Unit) { if (state.staff.employees.isEmpty()) vm.loadEmployees() }
        PickerDialog(
            title = "بطاقةُ الموظف",
            items = state.staff.employees.map { PickerItem(it.id, it.name, trailing = it.employeeNo) },
            onDismiss = { pickEmployee = false },
            onSelect = { employeeId = it.id; employeeLabel = it.title },
        )
    }
}
/**
 * تعديلُ مندوب مبيعات (المرحلة 2) — `PATCH /sales/salesmen/{id}` بإذن
 * `sales.salesman.manage`: حوارٌ مُسبقُ التعبئة (الاسم/الجوال/الهاتف/بطاقةُ
 * الموظف/المستودع/نِسَبُ العمولة/الحالة/ملاحظات)، ولا يُرسَل من الحقولِ
 * إلا ما تغيّر فعلًا عن الأصل — الحقولُ الفارغةُ لا تُرفَع.
 */
@Composable
private fun EditSalesmanDialog(vm: AppViewModel, salesman: SalesRegistryDto, onDismiss: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var name by remember { mutableStateOf(salesman.name) }
    var mobile by remember { mutableStateOf(salesman.mobile ?: "") }
    var tel by remember { mutableStateOf(salesman.tel ?: "") }
    var employeeId by remember { mutableStateOf(salesman.employeeId ?: "") }
    var warehouseId by remember { mutableStateOf(salesman.warehouseId ?: "") }
    var commissionRate by remember { mutableStateOf(salesman.commissionRate ?: "") }
    var collectionRate by remember { mutableStateOf(salesman.collectionCommissionRate ?: "") }
    var profitRate by remember { mutableStateOf(salesman.profitCommissionRate ?: "") }
    var notes by remember { mutableStateOf(salesman.notes ?: "") }
    var active by remember { mutableStateOf(salesman.active) }
    var pickEmployee by remember { mutableStateOf(false) }
    var pickWarehouse by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    // الموظفون والمستودعاتُ عند الحاجة — بطاقةُ الموظف تُحسِّنُ وصفَ القائمة.
    LaunchedEffect(Unit) {
        if (state.staff.employees.isEmpty()) vm.ensureEmployees()
        if (state.warehouses.isEmpty()) vm.refreshLookups()
    }

    val employeeLabel = state.staff.employees.firstOrNull { it.id == employeeId }?.name ?: ""
    val warehouseLabel = state.warehouses.firstOrNull { it.id == warehouseId }?.label ?: ""

    DocumentDetailDialog(
        title = "تعديلُ المندوب",
        subtitle = salesman.name,
        onDismiss = { if (!sending) onDismiss() },
    ) {
        OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("الاسم *") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = mobile, onValueChange = { mobile = it }, label = { Text("الجوّال") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = tel, onValueChange = { tel = it }, label = { Text("الهاتف") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = employeeLabel,
            onValueChange = {},
            readOnly = true,
            label = { Text("بطاقةُ الموظف") },
            modifier = Modifier.fillMaxWidth(),
            trailingIcon = { IconButton(onClick = { pickEmployee = true }) { Text("اختر") } },
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = warehouseLabel,
            onValueChange = {},
            readOnly = true,
            label = { Text("مستودعُ المندوب") },
            modifier = Modifier.fillMaxWidth(),
            trailingIcon = { IconButton(onClick = { pickWarehouse = true }) { Text("اختر") } },
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = commissionRate,
            onValueChange = { if (Dec.isValidInput(it)) commissionRate = it },
            label = { Text("عمولةُ المبيعات (%)") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = collectionRate,
            onValueChange = { if (Dec.isValidInput(it)) collectionRate = it },
            label = { Text("عمولةُ التحصيل (%)") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = profitRate,
            onValueChange = { if (Dec.isValidInput(it)) profitRate = it },
            label = { Text("عمولةُ الربح (%)") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = notes, onValueChange = { notes = it }, label = { Text("ملاحظات") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
        ) {
            Text("مندوبٌ نشط", style = MaterialTheme.typography.bodyMedium)
            Switch(checked = active, onCheckedChange = { active = it })
        }
        if (error != null) {
            Spacer(Modifier.height(8.dp))
            StatusChip(error ?: "", ChipTone.DANGER)
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ActionButton(
                label = if (sending) "جارٍ الحفظ…" else "حفظُ التعديلات",
                onClick = {
                    error = when {
                        name.isBlank() -> "اسمُ المندوب إلزاميّ."
                        listOf(commissionRate, collectionRate, profitRate).any { Dec.parse(it)?.signum() == -1 } ->
                            "النِّسَبُ لا تقبل سالبًا."
                        else -> null
                    }
                    if (error != null) return@ActionButton
                    val body = buildJsonObject {
                        if (name.isNotBlank() && name.trim() != salesman.name) put("name", name.trim())
                        if (mobile.isNotBlank() && mobile.trim() != (salesman.mobile ?: "")) put("mobile", mobile.trim())
                        if (tel.isNotBlank() && tel.trim() != (salesman.tel ?: "")) put("tel", tel.trim())
                        if (employeeId.isNotBlank() && employeeId != (salesman.employeeId ?: "")) put("employeeId", employeeId)
                        if (warehouseId.isNotBlank() && warehouseId != (salesman.warehouseId ?: "")) put("warehouseId", warehouseId)
                        if (commissionRate.isNotBlank() && commissionRate.trim() != (salesman.commissionRate ?: "")) put("commissionRate", Dec.wire(commissionRate))
                        if (collectionRate.isNotBlank() && collectionRate.trim() != (salesman.collectionCommissionRate ?: "")) put("collectionCommissionRate", Dec.wire(collectionRate))
                        if (profitRate.isNotBlank() && profitRate.trim() != (salesman.profitCommissionRate ?: "")) put("profitCommissionRate", Dec.wire(profitRate))
                        if (notes.isNotBlank() && notes.trim() != (salesman.notes ?: "")) put("notes", notes.trim())
                        if (active != salesman.active) put("active", active)
                    }
                    if (body.keys.isEmpty()) {
                        error = "لم يُدخَل أيُّ تغييرٍ ليُحفَظ."
                        return@ActionButton
                    }
                    sending = true
                    vm.updateSalesRegistry(salesman.id, body) { result ->
                        sending = false
                        when (result) {
                            is ActionResult.Synced -> {
                                vm.loadSalesRegistry()
                                onDismiss()
                            }
                            is ActionResult.Refused -> error = result.messageAr
                            is ActionResult.Offline -> error = result.messageAr
                        }
                    }
                },
                enabled = !sending,
                loading = sending,
                modifier = Modifier.weight(1f),
            )
            ActionButton(
                label = "رجوع",
                onClick = { if (!sending) onDismiss() },
                enabled = !sending,
                modifier = Modifier.weight(1f),
            )
        }
    }

    if (pickEmployee) {
        PickerDialog(
            title = "بطاقةُ الموظف",
            items = state.staff.employees.map { PickerItem(it.id, it.name, trailing = it.employeeNo) },
            onDismiss = { pickEmployee = false },
            onSelect = { employeeId = it.id },
        )
    }
    if (pickWarehouse) {
        PickerDialog(
            title = "مستودعُ المندوب",
            items = state.warehouses.map { PickerItem(it.id, it.label) },
            onDismiss = { pickWarehouse = false },
            onSelect = { warehouseId = it.id },
        )
    }
}
