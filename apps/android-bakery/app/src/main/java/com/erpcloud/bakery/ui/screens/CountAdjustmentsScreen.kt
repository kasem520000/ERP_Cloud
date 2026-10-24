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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
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
import com.erpcloud.bakery.ui.components.PullRefreshBox
import com.erpcloud.bakery.ui.components.SearchField
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.components.StatusChip
import com.erpcloud.bakery.util.Dec
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * شاشةُ تسوية الجرد — الجردُ الفعليّ مقابل الدفتر (من وحدة المخزون):
 * تُنشأ تسويةٌ (سببٌ إلزاميّ + سطورُ صنفٍ وكميّةٍ معدودةٍ مطلقةٍ) ثمّ **الترحيل**
 * يُقيم الفرقَ (عجزٌ أو فائض) ويُقيّده على حساب الفرق — قيدٌ واحدٌ متوازنٌ
 * للتسوية كلِّها.
 *
 * `countedQty` الكميّةُ **المعدودة الفعليّة** لا الفرق — الخادمُ يحسبُ التباين
 * من رصيد الدفتر (`expectedQty`).
 *
 * الترحيلُ **يعتمدُ التسويةَ فورًا** (`approved: true` — الخادمُ يشترطها)، لذا
 * يُطلب تأكيدٌ صريحٌ قبل إرساله. لا إبطالَ للتسوياتِ بعد الترحيل (لا نقطةَ
 * `/void` لها) — الدقّةُ قبل الترحيل هي الأمان.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CountAdjustmentsScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var showCreate by remember { mutableStateOf(false) }
    var postTarget by remember { mutableStateOf<String?>(null) }
    var query by rememberSaveable { mutableStateOf("") }

    LaunchedEffect(Unit) { vm.loadCountAdjustments() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("تسوية الجرد") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
        floatingActionButton = {
            if (!showCreate && state.can("inventory.adjust")) {
                FloatingActionButton(onClick = { showCreate = true }) {
                    Icon(Icons.Default.Add, contentDescription = "تسوية جديدة")
                }
            }
        },
    ) { padding ->
        // لا يُخفى الزرُّ بصمتًا: إن غاب الإذنُ يُشرَح السببُ بالعربية
        if (!state.can("inventory.adjust")) {
            MissingPermissionHint("إنشاء تسوية جرد", "inventory.adjust", Modifier.padding(padding))
        }
        if (showCreate) {
            CountForm(vm, onDone = { showCreate = false })
            return@Scaffold
        }
        val loading = state.staff.loadingKey == "counts"
        if (loading && state.staff.countAdjustments.isEmpty()) {
            CenterLoading("جارٍ تحميل التسويات…", Modifier.padding(padding))
            return@Scaffold
        }
        // بحثٌ محليّ: رقمُ التسوية أو السبب أو المستودع أو صنفٌ في السطور
        val q = query.trim()
        val counts = state.staff.countAdjustments.filter { count ->
            q.isBlank() ||
                count.number.contains(q, ignoreCase = true) ||
                count.reason.contains(q, ignoreCase = true) ||
                state.warehouses.firstOrNull { it.id == count.warehouseId }?.label?.contains(q, ignoreCase = true) == true ||
                count.lines.any { line ->
                    (state.items.firstOrNull { it.id == line.itemId }?.label ?: line.itemId).contains(q, ignoreCase = true)
                }
        }
        PullRefreshBox(
            refreshing = loading,
            onRefresh = { vm.loadCountAdjustments() },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            Column(Modifier.fillMaxSize()) {
                SearchField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp),
                    placeholder = "ابحث برقم التسوية أو السبب أو الصنف…",
                )
                if (counts.isEmpty()) {
                    EmptyState(
                        state.staff.error
                            ?: if (q.isBlank()) "لا تسوياتِ جردٍ بعد." else "لا نتائجَ تطابقُ البحث.",
                    )
                } else {
                    LazyColumn(
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(counts, key = { it.id }) { count ->
                            val (statusText, tone) = Labels.docStatus(count.status)
                            SectionCard(
                                title = "تسوية ${count.number.ifBlank { "—" }}",
                                subtitle = Labels.dateOrDash(count.createdAt?.take(10)),
                            ) {
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    StatusChip(statusText, tone)
                                }
                                Spacer(Modifier.height(6.dp))
                                KeyValue("السبب", count.reason)
                                state.warehouses.firstOrNull { it.id == count.warehouseId }?.let { KeyValue("المستودع", it.label) }
                                count.lines.forEach { line ->
                                    val itemLabel = state.items.firstOrNull { it.id == line.itemId }?.label ?: line.itemId
                                    val variance = Dec.orZero(line.varianceQty)
                                    KeyValue(
                                        itemLabel,
                                        "عدد ${Dec.kg(line.countedQty)} · دفتر ${Dec.kg(line.expectedQty)}" +
                                            " · ${if (variance.signum() >= 0) "فائض" else "عجز"} ${Dec.kg(variance.abs().toPlainString())}",
                                    )
                                }
                                if (count.status == "draft" && state.can("inventory.adjust")) {
                                    Spacer(Modifier.height(8.dp))
                                    OutlinedButton(onClick = { postTarget = count.id }) { Text("ترحيلُ التسوية") }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (postTarget != null) {
        val id = postTarget ?: ""
        // الترحيلُ يعتمدُ فورًا — تأكيدٌ صريحٌ لا يمرُّ بلا انتباه (الخادمُ يشترط approved=true)
        AlertDialog(
            onDismissRequest = { postTarget = null },
            title = { Text("ترحيلُ تسوية الجرد") },
            text = {
                Text("ترحيلُ التسوية يعتمدها فورًا (approved: true) ويقيّد فرقَ الجرد على حساب الفرق — هل تريد المتابعة؟")
            },
            confirmButton = {
                TextButton(onClick = {
                    postTarget = null
                    vm.postStockAdjustment(id, buildJsonObject { put("approved", true) }) { result ->
                        if (result is ActionResult.Synced) vm.loadCountAdjustments()
                    }
                }) { Text("ترحيل") }
            },
            dismissButton = { TextButton(onClick = { postTarget = null }) { Text("رجوع") } },
        )
    }
}

/**
 * إنشاءُ تسوية — سببٌ إلزاميّ + سطورُ صنفٍ وكميّةٍ معدودةٍ (مطلقةٍ لا فرقًا).
 *
 * **مفتاحُ النيّة**: يُبنى عند أوّل إرسالٍ ويُحفَظ `rememberSaveable` فيُعاد استعمالُه
 * في كلّ محاولة (فلا تُخلَقُ تسويةٌ مكرّرةٌ إن انقطعت الشبكةُ بعد الإرسال)، ولا
 * يُمسحُ إلا بعد النجاح كي تأخذَ التسويةُ التالية مفتاحًا جديدًا.
 */
@Composable
private fun CountForm(vm: AppViewModel, onDone: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var idemKey by rememberSaveable { mutableStateOf("") }
    var branchId by remember { mutableStateOf("") }
    var branchLabel by remember { mutableStateOf("") }
    var warehouseId by remember { mutableStateOf("") }
    var warehouseLabel by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }
    var pickBranch by remember { mutableStateOf(false) }
    var pickWarehouse by remember { mutableStateOf(false) }
    var pickLineAt by remember { mutableStateOf(-1) }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    data class CountLine(val itemId: String = "", val itemLabel: String = "", val countedQty: String = "")
    val lines = remember { mutableStateListOf(CountLine(), CountLine()) }

    LaunchedEffect(state.staff.branches, state.warehouses) {
        if (branchId.isBlank()) {
            (state.staff.branches.firstOrNull { it.isDefault } ?: state.staff.branches.firstOrNull())
                ?.let { branchId = it.id; branchLabel = it.nameAr }
        }
        if (warehouseId.isBlank()) {
            (state.warehouses.firstOrNull { it.id == state.dashboard?.mainWarehouseId }
                ?: state.warehouses.firstOrNull { it.isDefault == true })
                ?.let { warehouseId = it.id; warehouseLabel = it.label }
        }
    }

    LazyColumn(
        Modifier.fillMaxSize().padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            SectionCard(
                title = "تسويةُ جردٍ جديدة",
                subtitle = "الكميّةُ المعدودةُ **الفعليّةُ المطلقة** — والخادمُ يحسبُ الفرقَ من الدفتر",
            ) {
                OutlinedTextField(
                    value = branchLabel,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("الفرع *") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { IconButton(onClick = { pickBranch = true }) { Text("اختر") } },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = warehouseLabel,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("المستودع *") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { IconButton(onClick = { pickWarehouse = true }) { Text("اختر") } },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = reason,
                    onValueChange = { reason = it },
                    label = { Text("سببُ الجرد * (جردٌ شهريّ/مفاجئ…)") },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        item {
            SectionCard(title = "سطورُ الجرد", subtitle = "الصنفُ والكميّةُ المعدودةُ على الرفّ") {
                lines.forEachIndexed { index, line ->
                    Column(Modifier.padding(vertical = 4.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                            OutlinedTextField(
                                value = line.itemLabel,
                                onValueChange = {},
                                readOnly = true,
                                label = { Text("الصنف ${index + 1} *") },
                                modifier = Modifier.weight(1.4f),
                                trailingIcon = { IconButton(onClick = { pickLineAt = index }) { Text("اختر") } },
                            )
                            IconButton(onClick = { lines.removeAt(index) }, enabled = lines.size > 1) { Text("✕") }
                        }
                        OutlinedTextField(
                            value = line.countedQty,
                            onValueChange = { if (Dec.isValidInput(it)) lines[index] = line.copy(countedQty = it) },
                            label = { Text("الكميّةُ المعدودة الفعليّة *") },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
                OutlinedButton(onClick = { lines.add(CountLine()) }, modifier = Modifier.fillMaxWidth()) { Text("+ أضف صنفًا") }
                if (error != null) {
                    Spacer(Modifier.height(8.dp))
                    StatusChip(error ?: "", ChipTone.DANGER)
                }
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ActionButton(
                        label = if (sending) "جارٍ الحفظ…" else "حفظُ التسوية",
                        onClick = {
                            val validLines = lines.filter { it.itemId.isNotBlank() }
                            error = when {
                                branchId.isBlank() -> "اختر الفرع."
                                warehouseId.isBlank() -> "اختر المستودع."
                                reason.isBlank() -> "سببُ الجرد إلزاميّ."
                                validLines.isEmpty() -> "أضف صنفًا واحدًا على الأقلّ."
                                validLines.any { !Dec.isNonNegative(it.countedQty) } ->
                                    "الكميّةُ المعدودةُ صفرٌ أو أكثر (رقمٌ دقيق) — الفرقَ يحسبُه الخادم."
                                lines.any { it.itemId.isNotBlank() && Dec.parse(it.countedQty) == null } ->
                                    "أكمل الكميّةَ المعدودةَ لكلّ صنفٍ مُختار."
                                else -> null
                            }
                            if (error != null) return@ActionButton
                            sending = true
                            val body = buildJsonObject {
                                put("branchId", branchId)
                                put("warehouseId", warehouseId)
                                put("reason", reason.trim())
                                put(
                                    "lines",
                                    buildJsonArray {
                                        validLines.forEach { line ->
                                            add(
                                                buildJsonObject {
                                                    put("itemId", line.itemId)
                                                    put("countedQty", Dec.wire(line.countedQty))
                                                }
                                            )
                                        }
                                    },
                                )
                            }
                            // نيّةٌ واحدةٌ مفتاحٌ واحد: يُبنى مرّةً ويُعاد استعمالُه حتى النجاح
                            if (idemKey.isBlank()) {
                                idemKey = "bakery-count-" + java.util.UUID.randomUUID().toString()
                            }
                            vm.createStockAdjustment(vm.ensureIdempotencyKey("stock-adjustment", body, idemKey)) { result ->
                                sending = false
                                if (result is ActionResult.Synced) {
                                    idemKey = ""
                                    vm.loadCountAdjustments()
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

    if (pickBranch) {
        PickerDialog(
            title = "اختر الفرع",
            items = state.staff.branches.map { PickerItem(it.id, it.nameAr, trailing = if (it.isDefault) "افتراضيّ" else null) },
            onDismiss = { pickBranch = false },
            onSelect = { branchId = it.id; branchLabel = it.title; pickBranch = false },
        )
    }
    if (pickWarehouse) {
        PickerDialog(
            title = "اختر المستودع",
            items = state.warehouses.map { PickerItem(it.id, it.label, trailing = if (it.isDefault == true) "افتراضيّ" else null) },
            onDismiss = { pickWarehouse = false },
            onSelect = { warehouseId = it.id; warehouseLabel = it.title; pickWarehouse = false },
        )
    }
    if (pickLineAt >= 0) {
        val at = pickLineAt
        PickerDialog(
            title = "صنفُ الجرد ${at + 1}",
            items = state.items.map { PickerItem(it.id, it.label) },
            onDismiss = { pickLineAt = -1 },
            onSelect = { item ->
                lines[at] = lines[at].copy(itemId = item.id, itemLabel = item.title)
                pickLineAt = -1
            },
        )
    }
}
