package com.erpcloud.bakery.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import com.erpcloud.bakery.ui.components.rememberPickerInteractionSource

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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.data.ActionResult
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.ActionButton
import com.erpcloud.bakery.ui.components.PickerTrigger
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.EmptyState
import com.erpcloud.bakery.ui.components.InlineAction
import com.erpcloud.bakery.ui.components.KeyValue
import com.erpcloud.bakery.ui.components.MissingPermissionHint
import com.erpcloud.bakery.ui.components.PickerDialog
import com.erpcloud.bakery.ui.components.PickerItem
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.components.StatusChip
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * شاشةُ **الفروع والمستودعات والخزائن** — ركائزُ المنشأة التي بدونها لا يُرقَّمُ
 * مستندٌ ولا يستقرُّ مخزونٌ ولا مال: أيّ فاتورةٍ أو سندٍ يحتاجُ فرعًا، وأيُّ حركةٍ
 * مخزنيّةٍ تحتاجُ مستودعًا، وأيُّ سندٍ نقديٍّ يحتاجُ خزينة.
 *
 * وهنا تُدارُ من الهاتف مباشرةً: قائمةٌ + **إنشاء** + **تعديل** (الفروع)، بإذونٍ
 * من عائلة `organization.*`. مخططاتُ zod عند هذه المسارات **صارمة** — لا مفاتيحَ
 * زائدةَ تُرسَل أبدًا (لا idempotencyKey هنا).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OrgScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var createBranch by remember { mutableStateOf(false) }
    var createWarehouse by remember { mutableStateOf(false) }
    var createCash by remember { mutableStateOf(false) }
    var editBranchId by remember { mutableStateOf<String?>(null) }
    var editWarehouseId by remember { mutableStateOf<String?>(null) }
    var editCashId by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { vm.loadOrg() }

    val inSubView = createBranch || createWarehouse || createCash
    val closeSubView = {
        createBranch = false
        createWarehouse = false
        createCash = false
    }
    BackHandler(enabled = inSubView) { closeSubView() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        when {
                            createBranch -> "إضافة فرع جديد"
                            createWarehouse -> "إضافة مستودع جديد"
                            createCash -> "إضافة خزينة جديدة"
                            else -> "الفروع والمستودعات والخزائن"
                        },
                    )
                },
                navigationIcon = {
                    IconButton(onClick = { if (inSubView) closeSubView() else onBack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع")
                    }
                },
            )
        },
    ) { padding ->
        if (createBranch) {
            Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState())) {
                BranchForm(vm, onDone = { createBranch = false; vm.loadOrg() })
            }
            return@Scaffold
        }
        if (createWarehouse) {
            Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState())) {
                WarehouseForm(vm, onDone = { createWarehouse = false; vm.loadOrg() })
            }
            return@Scaffold
        }
        if (createCash) {
            Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState())) {
                CashForm(vm, onDone = { createCash = false; vm.loadOrg() })
            }
            return@Scaffold
        }
        if (state.staff.loadingKey == "org") {
            CenterLoading("جارٍ تحميل بيانات المنشأة…", Modifier.padding(padding))
            return@Scaffold
        }
        val error = state.staff.error
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                Text("الفروع", style = MaterialTheme.typography.titleMedium)
                if (!state.can("organization.branch.manage")) {
                    MissingPermissionHint("إضافة/تعديل فرع", "organization.branch.manage")
                }
            }
            if (state.staff.branches.isEmpty()) {
                item { EmptyState(error ?: "لا فروعَ بعد — الفروعُ شرطُ ترقيمِ المستندات.") }
            } else {
                items(state.staff.branches, key = { it.id }) { branch ->
                    SectionCard(title = branch.nameAr, subtitle = "الرمز: ${branch.code ?: "—"}") {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            if (branch.isDefault) StatusChip("افتراضيّ", ChipTone.OK)
                            StatusChip(if (branch.isActive) "نشط" else "موقوف", if (branch.isActive) ChipTone.NEUTRAL else ChipTone.DANGER)
                        }
                        if (state.can("organization.branch.manage")) {
                            Spacer(Modifier.height(8.dp))
                            OutlinedButton(onClick = { editBranchId = branch.id }) { Text("تعديل") }
                        }
                    }
                }
            }
            if (state.can("organization.branch.manage")) {
                item {
                    OutlinedButton(onClick = { createBranch = true }, modifier = Modifier.fillMaxWidth()) {
                        Text("+ فرعٌ جديد")
                    }
                }
            }

            item {
                Spacer(Modifier.height(8.dp))
                Text("المستودعات", style = MaterialTheme.typography.titleMedium)
                if (!state.can("organization.warehouse.manage")) {
                    MissingPermissionHint("إضافة مستودع", "organization.warehouse.manage")
                }
            }
            if (state.warehouses.isEmpty()) {
                item { EmptyState(error ?: "لا مستودعاتَ بعد.") }
            } else {
                items(state.warehouses, key = { it.id }) { warehouse ->
                    SectionCard(title = warehouse.label, subtitle = "الرمز: ${warehouse.code ?: "—"}") {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            if (warehouse.isDefault == true) StatusChip("افتراضيّ", ChipTone.OK)
                            if (warehouse.isActive == false) StatusChip("موقوف", ChipTone.DANGER)
                        }
                        state.staff.branches.firstOrNull { it.id == warehouse.branchId }?.let {
                            KeyValue("الفرع", it.nameAr)
                        }
                        if (state.can("organization.warehouse.manage")) {
                            Spacer(Modifier.height(8.dp))
                            InlineAction(label = "تعديل", onClick = { editWarehouseId = warehouse.id })
                        }
                    }
                }
            }
            if (state.can("organization.warehouse.manage")) {
                item {
                    OutlinedButton(onClick = { createWarehouse = true }, modifier = Modifier.fillMaxWidth()) {
                        Text("+ مستودعٌ جديد")
                    }
                }
            }

            item {
                Spacer(Modifier.height(8.dp))
                Text("الخزائن والصناديق", style = MaterialTheme.typography.titleMedium)
                if (!state.can("organization.cashlocation.manage")) {
                    MissingPermissionHint("إضافة خزينة", "organization.cashlocation.manage")
                }
            }
            if (state.staff.cashLocations.isEmpty()) {
                item { EmptyState(error ?: "لا خزائنَ بعد — سنداتُ القبض والصرف تحتاجُها.") }
            } else {
                items(state.staff.cashLocations, key = { it.id }) { cash ->
                    SectionCard(title = cash.displayName) {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            StatusChip(
                                when (cash.kind) {
                                    "bank" -> "حساب بنكيّ"
                                    else -> "صندوق نقديّ"
                                },
                                ChipTone.INFO,
                            )
                            if (cash.isDefault) StatusChip("افتراضيّ", ChipTone.OK)
                            if (!cash.isActive) StatusChip("موقوف", ChipTone.DANGER)
                        }
                        cash.bank?.bankName?.takeIf { it.isNotBlank() }?.let {
                            KeyValue("البنك", it)
                        }
                        state.staff.branches.firstOrNull { it.id == cash.branchId }?.let {
                            KeyValue("الفرع", it.nameAr)
                        }
                        if (state.can("organization.cashlocation.manage")) {
                            Spacer(Modifier.height(8.dp))
                            InlineAction(label = "تعديل", onClick = { editCashId = cash.id })
                        }
                    }
                }
            }
            if (state.can("organization.cashlocation.manage")) {
                item {
                    OutlinedButton(onClick = { createCash = true }, modifier = Modifier.fillMaxWidth()) {
                        Text("+ خزينةٌ جديدة")
                    }
                }
            }
        }
    }

    editBranchId?.let { id ->
        val branch = state.staff.branches.firstOrNull { it.id == id }
        if (branch != null) {
            BranchEditDialog(
                branch = branch,
                onDismiss = { editBranchId = null },
                onSave = { nameAr, isDefault, isActive ->
                    vm.updateBranch(
                        id,
                        buildJsonObject {
                            put("nameAr", nameAr.trim())
                            put("isDefault", isDefault)
                            put("isActive", isActive)
                        },
                    ) { result ->
                        if (result is ActionResult.Synced) vm.loadOrg()
                    }
                    editBranchId = null
                },
            )
        }
    }
    editWarehouseId?.let { id ->
        val warehouse = state.warehouses.firstOrNull { it.id == id }
        if (warehouse != null) {
            WarehouseEditDialog(
                warehouse = warehouse,
                branches = state.staff.branches,
                onDismiss = { editWarehouseId = null },
                onSave = { name, branchId, isDefault, isActive ->
                    vm.updateWarehouse(
                        id,
                        buildJsonObject {
                            put("name", name.trim())
                            if (branchId.isNotBlank()) put("branchId", branchId)
                            put("isDefault", isDefault)
                            put("isActive", isActive)
                        },
                    ) { result ->
                        if (result is ActionResult.Synced) vm.loadOrg()
                    }
                    editWarehouseId = null
                },
            )
        }
    }
    editCashId?.let { id ->
        val cash = state.staff.cashLocations.firstOrNull { it.id == id }
        if (cash != null) {
            CashLocationEditDialog(
                cash = cash,
                onDismiss = { editCashId = null },
                onSave = { name, isDefault, isActive ->
                    vm.updateCashLocation(
                        id,
                        buildJsonObject {
                            put("name", name.trim())
                            put("isDefault", isDefault)
                            put("isActive", isActive)
                        },
                    ) { result ->
                        if (result is ActionResult.Synced) vm.loadOrg()
                    }
                    editCashId = null
                },
            )
        }
    }
}

/** إنشاءُ فرع — `POST /branches` (code, nameAr — zod صارم). */
@Composable
private fun BranchForm(vm: AppViewModel, onDone: () -> Unit) {
    var code by remember { mutableStateOf("") }
    var nameAr by remember { mutableStateOf("") }
    var isDefault by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    SectionCard(title = "فرعٌ جديد", subtitle = "الفرعُ يُرقِّمُ المستنداتِ ويجمّعُ حركاتِه", modifier = Modifier.padding(14.dp)) {
        OutlinedTextField(value = code, onValueChange = { code = it }, label = { Text("الرمز * (مثال: MAIN)") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = nameAr, onValueChange = { nameAr = it }, label = { Text("الاسمُ بالعربيّة *") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = isDefault, onCheckedChange = { isDefault = it })
            Text("الفرعُ الافتراضيّ")
        }
        if (error != null) {
            Spacer(Modifier.height(8.dp))
            StatusChip(error ?: "", ChipTone.DANGER)
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ActionButton(
                label = if (sending) "جارٍ الحفظ…" else "حفظُ الفرع",
                onClick = {
                    error = when {
                        code.isBlank() -> "رمزُ الفرع إلزاميّ."
                        nameAr.isBlank() -> "اسمُ الفرع إلزاميّ."
                        else -> null
                    }
                    if (error != null) return@ActionButton
                    sending = true
                    vm.createBranch(
                        buildJsonObject {
                            put("code", code.trim())
                            put("nameAr", nameAr.trim())
                            put("isDefault", isDefault)
                        },
                    ) { result ->
                        sending = false
                        if (result is ActionResult.Synced) onDone()
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

/** تعديلُ فرع — `PATCH /branches/{id}` (nameAr/isDefault/isActive — الرمزُ لا يُعدَّل). */
@Composable
private fun BranchEditDialog(
    branch: com.erpcloud.bakery.data.api.BranchDto,
    onDismiss: () -> Unit,
    onSave: (nameAr: String, isDefault: Boolean, isActive: Boolean) -> Unit,
) {
    var nameAr by remember { mutableStateOf(branch.nameAr) }
    var isDefault by remember { mutableStateOf(branch.isDefault) }
    var isActive by remember { mutableStateOf(branch.isActive) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("تعديلُ الفرع ${branch.code ?: ""}") },
        text = {
            Column {
                OutlinedTextField(value = nameAr, onValueChange = { nameAr = it }, label = { Text("الاسمُ بالعربيّة") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = isDefault, onCheckedChange = { isDefault = it })
                    Text("افتراضيّ")
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = isActive, onCheckedChange = { isActive = it })
                    Text("نشط")
                }
            }
        },
        confirmButton = { TextButton(onClick = { onSave(nameAr, isDefault, isActive) }) { Text("حفظ") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}

/** إنشاءُ مستودع — `POST /warehouses` (branchId, code, name). */
@Composable
private fun WarehouseForm(vm: AppViewModel, onDone: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var code by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var branchId by remember { mutableStateOf("") }
    var branchLabel by remember { mutableStateOf("") }
    var pickBranch by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    SectionCard(title = "مستودعٌ جديد", modifier = Modifier.padding(14.dp)) {
        OutlinedTextField(
            value = branchLabel,
            onValueChange = {},
            readOnly = true,
            interactionSource = rememberPickerInteractionSource { pickBranch = true },
            label = { Text("الفرع *") },
            modifier = Modifier.fillMaxWidth(),
            trailingIcon = { PickerTrigger(onClick = { pickBranch = true }) },
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = code, onValueChange = { code = it }, label = { Text("الرمز * (مثال: WH1)") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("الاسم *") }, modifier = Modifier.fillMaxWidth())
        if (error != null) {
            Spacer(Modifier.height(8.dp))
            StatusChip(error ?: "", ChipTone.DANGER)
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ActionButton(
                label = if (sending) "جارٍ الحفظ…" else "حفظُ المستودع",
                onClick = {
                    error = when {
                        branchId.isBlank() -> "اختر الفرع."
                        code.isBlank() -> "رمزُ المستودع إلزاميّ."
                        name.isBlank() -> "اسمُ المستودع إلزاميّ."
                        else -> null
                    }
                    if (error != null) return@ActionButton
                    sending = true
                    vm.createWarehouse(
                        buildJsonObject {
                            put("branchId", branchId)
                            put("code", code.trim())
                            put("name", name.trim())
                        },
                    ) { result ->
                        sending = false
                        if (result is ActionResult.Synced) onDone()
                    }
                },
                enabled = !sending,
                loading = sending,
                modifier = Modifier.weight(1f),
            )
            ActionButton(label = "رجوع", onClick = onDone, enabled = !sending, modifier = Modifier.weight(1f))
        }
    }

    if (pickBranch) {
        PickerDialog(
            title = "اختر الفرع",
            items = state.staff.branches.map { PickerItem(it.id, it.nameAr) },
            onDismiss = { pickBranch = false },
            onSelect = { branchId = it.id; branchLabel = it.title },
        )
    }
}

/** إنشاءُ خزينة — `POST /cash-locations` (branchId, kind: safe|bank, name). */
@Composable
private fun CashForm(vm: AppViewModel, onDone: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var name by remember { mutableStateOf("") }
    var bankName by remember { mutableStateOf("") }
    var kind by remember { mutableStateOf("safe") }
    var kindLabel by remember { mutableStateOf("صندوق نقديّ") }
    var branchId by remember { mutableStateOf("") }
    var branchLabel by remember { mutableStateOf("") }
    var pickBranch by remember { mutableStateOf(false) }
    var pickKind by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    SectionCard(title = "خزينةٌ جديدة", subtitle = "الصندوقُ للنقدِ والبنكُ للتحويلات", modifier = Modifier.padding(14.dp)) {
        OutlinedTextField(
            value = branchLabel,
            onValueChange = {},
            readOnly = true,
            interactionSource = rememberPickerInteractionSource { pickBranch = true },
            label = { Text("الفرع *") },
            modifier = Modifier.fillMaxWidth(),
            trailingIcon = { PickerTrigger(onClick = { pickBranch = true }) },
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = kindLabel,
            onValueChange = {},
            readOnly = true,
            interactionSource = rememberPickerInteractionSource { pickKind = true },
            label = { Text("النوع *") },
            modifier = Modifier.fillMaxWidth(),
            trailingIcon = { PickerTrigger(onClick = { pickKind = true }) },
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("الاسم * (مثال: الصندوق الرئيسيّ)") }, modifier = Modifier.fillMaxWidth())
        if (kind == "bank") {
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(value = bankName, onValueChange = { bankName = it }, label = { Text("اسم البنك * (مثال: مصرف الراجحي)") }, modifier = Modifier.fillMaxWidth())
        }
        if (error != null) {
            Spacer(Modifier.height(8.dp))
            StatusChip(error ?: "", ChipTone.DANGER)
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ActionButton(
                label = if (sending) "جارٍ الحفظ…" else "حفظُ الخزينة",
                onClick = {
                    error = when {
                        branchId.isBlank() -> "اختر الفرع."
                        name.isBlank() -> "اسمُ الخزينة إلزاميّ."
                        kind == "bank" && bankName.isBlank() -> "اسمُ البنك إلزاميّ."
                        else -> null
                    }
                    if (error != null) return@ActionButton
                    sending = true
                    vm.createCashLocation(
                        buildJsonObject {
                            put("branchId", branchId)
                            put("kind", kind)
                            put("name", name.trim())
                            if (kind == "bank") {
                                put(
                                    "bank",
                                    buildJsonObject { put("bankName", bankName.trim()) },
                                )
                            }
                        },
                    ) { result ->
                        sending = false
                        if (result is ActionResult.Synced) onDone()
                    }
                },
                enabled = !sending,
                loading = sending,
                modifier = Modifier.weight(1f),
            )
            ActionButton(label = "رجوع", onClick = onDone, enabled = !sending, modifier = Modifier.weight(1f))
        }
    }

    if (pickBranch) {
        PickerDialog(
            title = "اختر الفرع",
            items = state.staff.branches.map { PickerItem(it.id, it.nameAr) },
            onDismiss = { pickBranch = false },
            onSelect = { branchId = it.id; branchLabel = it.title },
        )
    }
    if (pickKind) {
        PickerDialog(
            title = "نوعُ الخزينة",
            items = listOf(
                PickerItem("safe", "صندوق نقديّ"),
                PickerItem("bank", "حساب بنكيّ"),
            ),
            onDismiss = { pickKind = false },
            onSelect = { kind = it.id; kindLabel = it.title; pickKind = false },
        )
    }
}


/** تعديلُ مستودع — `PATCH /warehouses/{id}` (branchId/name/isDefault/isActive — الرمزُ لا يُعدَّل). */
@Composable
private fun WarehouseEditDialog(
    warehouse: com.erpcloud.bakery.data.api.WarehouseOptionDto,
    branches: List<com.erpcloud.bakery.data.api.BranchDto>,
    onDismiss: () -> Unit,
    onSave: (name: String, branchId: String, isDefault: Boolean, isActive: Boolean) -> Unit,
) {
    var name by remember { mutableStateOf(warehouse.nameAr ?: warehouse.name ?: "") }
    var branchId by remember { mutableStateOf(warehouse.branchId ?: "") }
    var branchLabel by remember {
        mutableStateOf(branches.firstOrNull { it.id == warehouse.branchId }?.nameAr ?: "")
    }
    var isDefault by remember { mutableStateOf(warehouse.isDefault == true) }
    var isActive by remember { mutableStateOf(warehouse.isActive != false) }
    var pickBranch by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("تعديلُ المستودع ${warehouse.code ?: ""}") },
        text = {
            Column {
                OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("الاسم") }, modifier = Modifier.fillMaxWidth())
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
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = isDefault, onCheckedChange = { isDefault = it })
                    Text("افتراضيّ")
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = isActive, onCheckedChange = { isActive = it })
                    Text("نشط")
                }
            }
        },
        confirmButton = {
            TextButton(enabled = name.isNotBlank(), onClick = { onSave(name, branchId, isDefault, isActive) }) { Text("حفظ") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )

    if (pickBranch) {
        PickerDialog(
            title = "اختر الفرع",
            items = branches.map { PickerItem(it.id, it.nameAr) },
            onDismiss = { pickBranch = false },
            onSelect = { branchId = it.id; branchLabel = it.title },
        )
    }
}

/** تعديلُ خزينة — `PATCH /cash-locations/{id}` (name/isDefault/isActive — النوعُ لا يُعدَّل). */
@Composable
private fun CashLocationEditDialog(
    cash: com.erpcloud.bakery.data.api.CashLocationDto,
    onDismiss: () -> Unit,
    onSave: (name: String, isDefault: Boolean, isActive: Boolean) -> Unit,
) {
    var name by remember { mutableStateOf(cash.name) }
    var isDefault by remember { mutableStateOf(cash.isDefault) }
    var isActive by remember { mutableStateOf(cash.isActive) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("تعديلُ الخزينة ${cash.name}") },
        text = {
            Column {
                OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("الاسم") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = if (cash.kind == "bank") "حساب بنكيّ" else "صندوق نقديّ",
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("النوع (لا يُعدَّل)") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = isDefault, onCheckedChange = { isDefault = it })
                    Text("افتراضيّ")
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = isActive, onCheckedChange = { isActive = it })
                    Text("نشط")
                }
            }
        },
        confirmButton = {
            TextButton(enabled = name.isNotBlank(), onClick = { onSave(name, isDefault, isActive) }) { Text("حفظ") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}
