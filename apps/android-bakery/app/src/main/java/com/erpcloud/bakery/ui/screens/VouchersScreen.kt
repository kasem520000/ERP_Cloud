package com.erpcloud.bakery.ui.screens

import androidx.compose.foundation.clickable
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
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
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
import com.erpcloud.bakery.ui.components.ConfirmDialog
import com.erpcloud.bakery.ui.components.ConfirmReasonDialog
import com.erpcloud.bakery.ui.components.EmptyState
import com.erpcloud.bakery.ui.components.InlineAction
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
 * شاشةُ السندات المخزنيّة — **بضاعةُ أوّل المدة** وسنداتُ الإدخال/الإخراج
 * (من تطبيق الطاقم): القائمةُ + إنشاءُ سندٍ (فرع/مستودع/نوع + سطورُ صنفٍ
 * وكميّةٍ وتكلفةٍ ودفعة) + **الترحيل** بإذن `inventory.adjust`.
 *
 * هذه هي البوّابةُ النظاميّةُ للواردِ من خارج المنشأة — لا «مخزونٌ من العدم»:
 * كلُّ كيلوغرامٍ يدخل هنا بتكلفةٍ ومصدر.
 *
 * المرحلةُ الثانية: ضغطُ البطاقةِ يفتحُ سطورَها كلَّها (المطويّةُ تُظهرُ أوائلَها)،
 * والإبطالُ بسببٍ إلزاميّ (`POST /inventory/vouchers/{id}/void`) بإذن `inventory.adjust`.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VouchersScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var showCreate by remember { mutableStateOf(false) }
    var postTarget by remember { mutableStateOf<String?>(null) }
    var voidTarget by remember { mutableStateOf<String?>(null) }
    var expandedId by remember { mutableStateOf<String?>(null) }
    var query by rememberSaveable { mutableStateOf("") }

    LaunchedEffect(Unit) { vm.loadVouchers() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("السندات المخزنيّة") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
        floatingActionButton = {
            if (!showCreate && state.can("inventory.adjust")) {
                FloatingActionButton(onClick = { showCreate = true }) {
                    Icon(Icons.Default.Add, contentDescription = "سند جديد")
                }
            }
        },
    ) { padding ->
        // لا يُخفى الزرُّ بصمتًا: إن غاب الإذنُ يُشرَح السببُ بالعربية
        if (!state.can("inventory.adjust")) {
            MissingPermissionHint("إنشاء سند مخزني", "inventory.adjust", Modifier.padding(padding))
        }
        if (showCreate) {
            VoucherForm(vm, onDone = { showCreate = false })
            return@Scaffold
        }
        val loading = state.staff.loadingKey == "vouchers"
        if (loading && state.staff.vouchers.isEmpty()) {
            CenterLoading("جارٍ تحميل السندات…", Modifier.padding(padding))
            return@Scaffold
        }
        // بحثٌ محليّ: رقمُ السند أو السبب أو المستودع أو صنفٌ في السطور
        val q = query.trim()
        val vouchers = state.staff.vouchers.filter { voucher ->
            q.isBlank() ||
                voucher.number.contains(q, ignoreCase = true) ||
                (voucher.reason ?: "").contains(q, ignoreCase = true) ||
                (voucher.warehouseName ?: "").contains(q, ignoreCase = true) ||
                (Labels.voucherKind(voucher.kind)).contains(q, ignoreCase = true) ||
                voucher.lines.any { line ->
                    (line.itemName ?: "").contains(q, ignoreCase = true) ||
                        state.items.firstOrNull { it.id == line.itemId }?.label?.contains(q, ignoreCase = true) == true
                }
        }
        PullRefreshBox(
            refreshing = loading,
            onRefresh = { vm.loadVouchers() },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            Column(Modifier.fillMaxSize()) {
                SearchField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp),
                    placeholder = "ابحث برقم السند أو السبب أو الصنف…",
                )
                if (vouchers.isEmpty()) {
                    EmptyState(
                        state.staff.error
                            ?: if (q.isBlank()) "لا سنداتَ بعد." else "لا نتائجَ تطابقُ البحث.",
                    )
                } else {
                    LazyColumn(
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(vouchers, key = { it.id }) { voucher ->
                            val expanded = expandedId == voucher.id
                            val (statusText, tone) = Labels.docStatus(voucher.status)
                            SectionCard(
                                title = "سند ${voucher.number.ifBlank { "—" }}",
                                subtitle = Labels.dateOrDash(voucher.voucherDate ?: voucher.createdAt),
                                modifier = Modifier.clickable { expandedId = if (expanded) null else voucher.id },
                            ) {
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    StatusChip(Labels.voucherKind(voucher.kind), ChipTone.NEUTRAL)
                                    StatusChip(statusText, tone)
                                }
                                Spacer(Modifier.height(6.dp))
                                state.staff.branches.firstOrNull { it.id == voucher.branchId }?.let { KeyValue("الفرع", it.nameAr) }
                                KeyValue("المستودع", voucher.warehouseName ?: "—")
                                voucher.reason?.let { KeyValue("السبب", it) }
                                // السطورُ مطويّةٌ تُظهرُ الثلاثةَ الأولى، والضغطُ على البطاقةِ يفتحُها كلَّها
                                val shownLines = if (expanded) voucher.lines else voucher.lines.take(3)
                                shownLines.forEach { line ->
                                    val itemLabel = line.itemName
                                        ?: state.items.firstOrNull { it.id == line.itemId }?.label
                                        ?: line.itemId
                                    val batchPart = if (expanded) {
                                        line.batchNo?.takeIf { it.isNotBlank() }?.let { " · دفعة $it" } ?: ""
                                    } else {
                                        ""
                                    }
                                    KeyValue(
                                        itemLabel,
                                        "${Dec.kg(line.qty)}" + (line.unitCost?.let { " · ${Dec.money(it)} ر.س" } ?: "") + batchPart,
                                    )
                                }
                                if (!expanded && voucher.lines.size > 3) {
                                    KeyValue("سطورٌ مطويّة", "${voucher.lines.size - 3} — اضغط البطاقةَ لعرضها كلّها")
                                }
                                if (expanded) {
                                    voucher.notes?.takeIf { it.isNotBlank() }?.let { KeyValue("ملاحظات", it) }
                                    KeyValue("عددُ السطور", "${voucher.lines.size}")
                                }
                                if (voucher.status == "draft" && state.can("inventory.adjust")) {
                                    Spacer(Modifier.height(8.dp))
                                    OutlinedButton(onClick = { postTarget = voucher.id }) { Text("ترحيلُ السند") }
                                }
                                if (voucher.status != "voided" && voucher.status != "void" && state.can("inventory.adjust")) {
                                    InlineAction("إبطال", onClick = { voidTarget = voucher.id }, tone = ChipTone.DANGER)
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
        ConfirmDialog(
            title = "ترحيلُ السند المخزنيّ",
            message = "الترحيلُ يُثبّت حركةَ المخزون وقيودَ التكلفة — والسندُ المسودّةُ وحدها القابلةُ للتعديل. هل تُرحّله الآن؟",
            confirmLabel = "ترحيل",
            onConfirm = {
                postTarget = null
                vm.postStockVoucher(id, buildJsonObject { }) { result ->
                    if (result is ActionResult.Synced) vm.loadVouchers()
                }
            },
            onDismiss = { postTarget = null },
        )
    }

    if (voidTarget != null) {
        val id = voidTarget ?: ""
        ConfirmReasonDialog(
            title = "إبطالُ السند المخزنيّ",
            message = "الإبطالُ لا رجعةَ فيه — يُوسَمُ السندُ ملغىً ويُرجَعُ أثرُه عن المخزون والقيود. اذكرْ سببَ الإبطال.",
            onDismiss = { voidTarget = null },
            onConfirm = { reason ->
                voidTarget = null
                vm.voidStockVoucher(id, buildJsonObject { put("reason", reason) }) { result ->
                    if (result is ActionResult.Synced) vm.loadVouchers(null)
                }
            },
            confirmLabel = "إبطال",
            reasonLabel = "سببُ الإبطال",
        )
    }
}

/**
 * إنشاءُ سندٍ مخزنيّ — النوعُ: بضاعةُ أوّل المدة / إدخال / إخراج.
 *
 * **مفتاحُ النيّة**: يُبنى عند أوّل إرسالٍ ويُحفَظ `rememberSaveable` فيُعاد استعمالُه
 * في كلّ محاولة (فلا يُخلَقُ سندٌ مكرّرٌ إن انقطعت الشبكةُ بعد الإرسال)، ولا يُمسحُ
 * إلا بعد النجاح كي يأخذَ السندُ التالي مفتاحًا جديدًا.
 */
@Composable
private fun VoucherForm(vm: AppViewModel, onDone: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var idemKey by rememberSaveable { mutableStateOf("") }
    var kind by remember { mutableStateOf("opening") }
    var kindLabel by remember { mutableStateOf("بضاعة أول المدة") }
    var branchId by remember { mutableStateOf("") }
    var branchLabel by remember { mutableStateOf("") }
    var warehouseId by remember { mutableStateOf("") }
    var warehouseLabel by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }
    var pickKind by remember { mutableStateOf(false) }
    var pickBranch by remember { mutableStateOf(false) }
    var pickWarehouse by remember { mutableStateOf(false) }
    var pickLineAt by remember { mutableStateOf(-1) }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    data class VoucherLineDraft(
        val itemId: String = "",
        val itemLabel: String = "",
        val qty: String = "",
        val unitCost: String = "",
        val batchNo: String = "",
    )
    val lines = remember { mutableStateListOf(VoucherLineDraft(), VoucherLineDraft()) }

    LaunchedEffect(state.staff.branches) {
        if (branchId.isBlank()) {
            (state.staff.branches.firstOrNull { it.isDefault } ?: state.staff.branches.firstOrNull())
                ?.let { branchId = it.id; branchLabel = it.nameAr }
        }
    }
    LaunchedEffect(state.warehouses, state.dashboard?.mainWarehouseId) {
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
            SectionCard(title = "سندٌ مخزنيٌّ جديد", subtitle = "الواردُ من خارج المنشأة موضعهُ هنا — بإذن inventory.adjust") {
                OutlinedTextField(
                    value = kindLabel,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("نوعُ السند *") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { IconButton(onClick = { pickKind = true }) { Text("اختر") } },
                )
                Spacer(Modifier.height(8.dp))
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
                OutlinedTextField(value = reason, onValueChange = { reason = it }, label = { Text("السبب (اختياريّ)") }, modifier = Modifier.fillMaxWidth())
            }
        }
        item {
            SectionCard(title = "سطورُ السند", subtitle = "الصنفُ والكميّة — والتكلفةُ إلزاميّةٌ لأوّل المدة") {
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
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(
                                value = line.qty,
                                onValueChange = { if (Dec.isValidInput(it)) lines[index] = line.copy(qty = it) },
                                label = { Text("الكميّة *") },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                modifier = Modifier.weight(1f),
                            )
                            OutlinedTextField(
                                value = line.unitCost,
                                onValueChange = { if (Dec.isValidInput(it)) lines[index] = line.copy(unitCost = it) },
                                label = { Text("تكلفةُ الوحدة (ر.س)") },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                modifier = Modifier.weight(1f),
                            )
                        }
                        if (kind == "opening" || kind == "stock_in") {
                            OutlinedTextField(
                                value = line.batchNo,
                                onValueChange = { lines[index] = line.copy(batchNo = it) },
                                label = { Text("رقمُ الدفعة (اختياريّ — يُنشئها إن لم تكن مسجّلة)") },
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }
                }
                OutlinedButton(onClick = { lines.add(VoucherLineDraft()) }, modifier = Modifier.fillMaxWidth()) { Text("+ أضف سطرًا") }
                if (error != null) {
                    Spacer(Modifier.height(8.dp))
                    StatusChip(error ?: "", ChipTone.DANGER)
                }
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ActionButton(
                        label = if (sending) "جارٍ الحفظ…" else "حفظُ السند",
                        onClick = {
                            val validLines = lines.filter { it.itemId.isNotBlank() }
                            error = when {
                                branchId.isBlank() -> "اختر الفرع."
                                warehouseId.isBlank() -> "اختر المستودع."
                                validLines.isEmpty() -> "أضف سطرًا واحدًا على الأقلّ."
                                validLines.any { !Dec.isPositive(it.qty) } -> "كميّةُ كلّ سطرٍ يجب أن تكون رقمًا موجبًا."
                                kind == "opening" && validLines.any { !Dec.isPositive(it.unitCost) } ->
                                    "بضاعةُ أوّل المدة تحتاج تكلفةَ وحدةٍ موجبةً لكلّ صنف — لا مخزونَ بلا قيمة."
                                lines.any { it.itemId.isNotBlank() && Dec.parse(it.qty) == null } ->
                                    "أكمل الكميّةَ لكلّ صنفٍ مُختار."
                                else -> null
                            }
                            if (error != null) return@ActionButton
                            sending = true
                            val body = buildJsonObject {
                                put("branchId", branchId)
                                put("warehouseId", warehouseId)
                                put("kind", kind)
                                if (reason.isNotBlank()) put("reason", reason.trim())
                                put(
                                    "lines",
                                    buildJsonArray {
                                        validLines.forEach { line ->
                                            add(
                                                buildJsonObject {
                                                    put("itemId", line.itemId)
                                                    put("qty", Dec.wire(line.qty))
                                                    if (line.unitCost.isNotBlank()) put("unitCost", Dec.wire(line.unitCost))
                                                    if (line.batchNo.isNotBlank()) put("batchNo", line.batchNo.trim())
                                                }
                                            )
                                        }
                                    },
                                )
                            }
                            // نيّةٌ واحدةٌ مفتاحٌ واحد: يُبنى مرّةً ويُعاد استعمالُه حتى النجاح
                            if (idemKey.isBlank()) {
                                idemKey = "bakery-stock-voucher-" + java.util.UUID.randomUUID().toString()
                            }
                            val withKey = vm.ensureIdempotencyKey("stock-voucher", body, idemKey)
                            vm.createStockVoucher(withKey) { result ->
                                sending = false
                                if (result is ActionResult.Synced) {
                                    idemKey = ""
                                    vm.loadVouchers()
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

    if (pickKind) {
        PickerDialog(
            title = "نوعُ السند",
            items = listOf(
                PickerItem("opening", "بضاعة أول المدة"),
                PickerItem("stock_in", "سند إدخال مخزني"),
                PickerItem("stock_out", "سند إخراج مخزني"),
            ),
            onDismiss = { pickKind = false },
            onSelect = {
                kind = it.id
                kindLabel = it.title
            },
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
    if (pickWarehouse) {
        PickerDialog(
            title = "اختر المستودع",
            items = state.warehouses.map { PickerItem(it.id, it.label, trailing = if (it.isDefault == true) "افتراضيّ" else null) },
            onDismiss = { pickWarehouse = false },
            onSelect = { warehouseId = it.id; warehouseLabel = it.title },
        )
    }
    if (pickLineAt >= 0) {
        val at = pickLineAt
        PickerDialog(
            title = "صنفُ السطر ${at + 1}",
            items = state.items.map { PickerItem(it.id, it.label) },
            onDismiss = { pickLineAt = -1 },
            onSelect = { item ->
                lines[at] = lines[at].copy(itemId = item.id, itemLabel = item.title)
                pickLineAt = -1
            },
        )
    }
}
