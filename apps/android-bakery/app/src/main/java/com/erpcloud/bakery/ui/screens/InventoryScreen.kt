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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.PickerTrigger
import com.erpcloud.bakery.ui.components.rememberPickerInteractionSource
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.DatePickerField
import com.erpcloud.bakery.ui.components.EmptyState
import com.erpcloud.bakery.ui.components.KeyValue
import com.erpcloud.bakery.ui.components.PickerDialog
import com.erpcloud.bakery.ui.components.PickerItem
import com.erpcloud.bakery.ui.components.PullRefreshBox
import com.erpcloud.bakery.ui.components.SearchField
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.components.StatusChip
import com.erpcloud.bakery.util.Dec

/**
 * شاشةُ المخزون — الأرصدةُ والحركةُ وبطاقةُ الصنف (من وحدة المخزون عند الخادم):
 *
 * 1. **الأرصدة**: `GET /inventory/levels` — كم في كلّ مستودعٍ وبأيّ قيمةٍ ومتوسطِ تكلفة.
 * 2. **الحركة**: `GET /inventory/movements` — كلُّ واردٍ وصادرٍ بفترةٍ وصنفٍ ومستودع.
 * 3. **بطاقةُ صنف**: `GET /inventory/item-card` — دفترُ الصنف برصيدٍ جارٍ وكميّةٍ وقيمة.
 *
 * الأسماءُ تُجلبُ محليًّا من كتالوج التطبيق (الردُّ خامٌ بلا أسماء في levels).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InventoryScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var tab by remember { mutableIntStateOf(0) }

    LaunchedEffect(Unit) { vm.loadStockLevels() }

    Scaffold(
        topBar = {
            TopAppBar(
                // شريطٌ فاتحٌ يمتزجُ بخلفيّةِ الشاشة (كما في الموك-أب) وعنوانٌ عريضٌ جدًّا.
                title = { Text("المخزون", fontWeight = FontWeight.ExtraBold) },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            SecondaryTabRow(selectedTabIndex = tab) {
                Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("الأرصدة") })
                Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("الحركة") })
                Tab(selected = tab == 2, onClick = { tab = 2 }, text = { Text("بطاقةُ صنف") })
            }
            when (tab) {
                0 -> LevelsTab(vm)
                1 -> MovementsTab(vm)
                else -> ItemCardTab(vm)
            }
        }
    }
}

/** تبويبُ الأرصدة — رصيدُ كلّ صنفٍ في كلّ مستودع مع القيمة ومتوسطِ التكلفة. */
@Composable
private fun LevelsTab(vm: AppViewModel) {
    val state by vm.uiState.collectAsState()
    var warehouseId by remember { mutableStateOf("") }
    var warehouseLabel by remember { mutableStateOf("") }
    var pickWarehouse by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }

    PullRefreshBox(
        refreshing = state.staff.loadingKey == "levels",
        onRefresh = { vm.loadStockLevels(warehouseId.ifBlank { null }) },
        modifier = Modifier.fillMaxSize(),
    ) {
        Column(Modifier.fillMaxSize().padding(top = 12.dp).padding(horizontal = 14.dp)) {
            OutlinedTextField(
                value = warehouseLabel,
                onValueChange = {},
                readOnly = true,
                interactionSource = rememberPickerInteractionSource { pickWarehouse = true },
                label = { Text("المستودع (كلُّ المستودعات إن تُرك)") },
                modifier = Modifier.fillMaxWidth(),
                trailingIcon = { PickerTrigger(onClick = { pickWarehouse = true }) },
            )
            Spacer(Modifier.height(10.dp))
            SearchField(value = query, onValueChange = { query = it }, placeholder = "ابحث باسم الصنف…")
            Spacer(Modifier.height(10.dp))
            if (state.staff.loadingKey == "levels") {
                CenterLoading("جارٍ تحميل الأرصدة…")
            } else {
                val levels = state.staff.stockLevels
                val queryText = query.trim()
                val visibleLevels = if (queryText.isEmpty()) levels else levels.filter { level ->
                    val itemName = state.effectiveItems.firstOrNull { it.id == level.itemId }?.label ?: level.itemId
                    itemName.contains(queryText, ignoreCase = true) || level.itemId.contains(queryText, ignoreCase = true)
                }
                if (visibleLevels.isEmpty() && levels.isNotEmpty()) {
                    EmptyState("لا نتائجَ تطابقُ بحثك.")
                } else if (levels.isEmpty()) {
                    EmptyState(state.staff.error ?: "لا أرصدةَ بعد.")
                } else {
                    LazyColumn(
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 20.dp),
                    ) {
                        items(visibleLevels.size) { index ->
                            val level = visibleLevels[index]
                            val itemLabel = state.effectiveItems.firstOrNull { it.id == level.itemId }?.label ?: level.itemId
                            val warehouseName = state.effectiveWarehouses.firstOrNull { it.id == level.warehouseId }?.label
                                ?: level.warehouseId
                            SectionCard(title = itemLabel, subtitle = warehouseName) {
                                KeyValue("الكميّة", Dec.kg(level.quantity))
                                KeyValue("القيمة", Dec.money(level.value) + " ر.س")
                                if (Dec.isPositive(level.averageCost)) {
                                    KeyValue("متوسطُ التكلفة", Dec.money(level.averageCost) + " ر.س")
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (pickWarehouse) {
        PickerDialog(
            title = "اختر المستودع",
            items = listOf(PickerItem("", "كلُّ المستودعات")) +
                state.effectiveWarehouses.map { PickerItem(it.id, it.label) },
            loading = state.loadingLookups,
            onRefresh = { vm.ensureLookups(force = true) },
            onDismiss = { pickWarehouse = false },
            onSelect = {
                warehouseId = it.id
                warehouseLabel = it.title
                pickWarehouse = false
                vm.loadStockLevels(warehouseId.ifBlank { null })
            },
        )
    }
}

/** تبويبُ الحركة — فترةٌ وصنفٌ ومستودع، وكلُّ حركةٍ بكميّتِها وتكلفتِها ومستندِها. */
@Composable
private fun MovementsTab(vm: AppViewModel) {
    val state by vm.uiState.collectAsState()
    var from by remember { mutableStateOf(firstDayOfPreviousMonth()) }
    var to by remember { mutableStateOf(todayIso()) }
    var itemId by remember { mutableStateOf("") }
    var itemLabel by remember { mutableStateOf("") }
    var warehouseId by remember { mutableStateOf("") }
    var warehouseLabel by remember { mutableStateOf("") }
    var pickItem by remember { mutableStateOf(false) }
    var pickWarehouse by remember { mutableStateOf(false) }

    PullRefreshBox(
        refreshing = state.staff.loadingKey == "movements",
        onRefresh = { vm.loadStockMovements(itemId.ifBlank { null }, warehouseId.ifBlank { null }, from.trim(), to.trim()) },
        modifier = Modifier.fillMaxSize(),
    ) {
        Column(Modifier.fillMaxSize().padding(horizontal = 14.dp)) {
            SectionCard(title = "مرشّحاتُ الحركة") {
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
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = itemLabel,
                        onValueChange = {},
                        readOnly = true,
                        interactionSource = rememberPickerInteractionSource { pickItem = true },
                        label = { Text("الصنف (الكلّ)") },
                        modifier = Modifier.weight(1f),
                        trailingIcon = { PickerTrigger(onClick = { pickItem = true }) },
                    )
                    OutlinedTextField(
                        value = warehouseLabel,
                        onValueChange = {},
                        readOnly = true,
                        interactionSource = rememberPickerInteractionSource { pickWarehouse = true },
                        label = { Text("المستودع (الكلّ)") },
                        modifier = Modifier.weight(1f),
                        trailingIcon = { PickerTrigger(onClick = { pickWarehouse = true }) },
                    )
                }
                Spacer(Modifier.height(8.dp))
                OutlinedButton(
                    onClick = { vm.loadStockMovements(itemId.ifBlank { null }, warehouseId.ifBlank { null }, from.trim(), to.trim()) },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(26.dp),
                ) { Text("عرضُ الحركة") }
            }
            Spacer(Modifier.height(10.dp))
            if (state.staff.loadingKey == "movements") {
                CenterLoading("جارٍ تحميل الحركة…")
            } else {
                val movements = state.staff.stockMovements
                if (movements.isEmpty()) {
                    EmptyState(state.staff.error ?: "لا حركةً في هذه الفترة — اضغط «عرضُ الحركة».")
                } else {
                    LazyColumn(
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 20.dp),
                    ) {
                        items(movements, key = { it.id }) { movement ->
                            SectionCard(
                                title = movement.itemNameAr ?: movement.itemId,
                                subtitle = "${Labels.dateOrDash(movement.occurredAt?.take(10))} · ${movement.warehouseNameAr ?: "—"}",
                            ) {
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    if (movement.direction == "in") StatusChip("وارد " + Dec.kg(movement.qty), ChipTone.OK)
                                    else StatusChip("صادر " + Dec.kg(movement.qty), ChipTone.WARN)
                                    StatusChip(Labels.movementDoc(movement.docType), ChipTone.NEUTRAL)
                                }
                                movement.unitNameAr?.let { KeyValue("الوحدة", it) }
                                movement.unitCost?.takeIf { Dec.isPositive(it) }?.let { KeyValue("تكلفةُ الوحدة", Dec.money(it) + " ر.س") }
                                movement.totalCost?.takeIf { Dec.isPositive(it) }?.let { KeyValue("إجماليُّ التكلفة", Dec.money(it) + " ر.س") }
                            }
                        }
                    }
                }
            }
        }
    }

    if (pickItem) {
        PickerDialog(
            title = "اختر الصنف",
            items = listOf(PickerItem("", "كلُّ الأصناف")) +
                state.effectiveItems.map { PickerItem(it.id, it.label, subtitle = it.subtitle) },
            loading = state.loadingLookups,
            errorMessage = state.lookupsError,
            onRefresh = { vm.ensureLookups(force = true) },
            onQueryChange = { vm.searchItemsRemotely(it) },
            alwaysShowSearch = true,
            onDismiss = { pickItem = false },
            onSelect = { itemId = it.id; itemLabel = if (it.id.isBlank()) "" else it.title; pickItem = false },
        )
    }
    if (pickWarehouse) {
        PickerDialog(
            title = "اختر المستودع",
            items = listOf(PickerItem("", "كلُّ المستودعات")) +
                state.effectiveWarehouses.map { PickerItem(it.id, it.label) },
            loading = state.loadingLookups,
            onRefresh = { vm.ensureLookups(force = true) },
            onDismiss = { pickWarehouse = false },
            onSelect = { warehouseId = it.id; warehouseLabel = if (it.id.isBlank()) "" else it.title; pickWarehouse = false },
        )
    }
}

/** تبويبُ بطاقة الصنف — دفترُ الصنف برصيدٍ جارٍ (كميّةً وقيمةً) كما يحسبه الخادم. */
@Composable
private fun ItemCardTab(vm: AppViewModel) {
    val state by vm.uiState.collectAsState()
    var itemId by remember { mutableStateOf("") }
    var itemLabel by remember { mutableStateOf("") }
    var from by remember { mutableStateOf("") }
    var to by remember { mutableStateOf("") }
    var pickItem by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().padding(horizontal = 14.dp)) {
        SectionCard(title = "بطاقةُ صنف", subtitle = "الرصيدُ الجاري كميّةً وقيمةً — بفترةٍ أو منذ البداية") {
            OutlinedTextField(
                value = itemLabel,
                onValueChange = {},
                readOnly = true,
                interactionSource = rememberPickerInteractionSource { pickItem = true },
                label = { Text("الصنف *") },
                placeholder = { Text("اضغط لاختيار الصنف…") },
                modifier = Modifier.fillMaxWidth(),
                trailingIcon = { PickerTrigger(onClick = { pickItem = true }) },
            )
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                DatePickerField(
                    label = "من (اختياريّ)",
                    value = from,
                    onValueChange = { from = it },
                    modifier = Modifier.weight(1f),
                )
                DatePickerField(
                    label = "إلى (اختياريّ)",
                    value = to,
                    onValueChange = { to = it },
                    modifier = Modifier.weight(1f),
                )
            }
            Spacer(Modifier.height(8.dp))
            OutlinedButton(
                onClick = { if (itemId.isNotBlank()) vm.loadItemCard(itemId, null, from.trim().ifBlank { null }, to.trim().ifBlank { null }) },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(26.dp),
            ) { Text("عرضُ البطاقة") }
        }
        Spacer(Modifier.height(10.dp))
        if (state.staff.loadingKey == "item-card") {
            CenterLoading("جارٍ حساب البطاقة…")
        } else {
            val card = state.staff.itemCard
            if (card == null) {
                EmptyState(state.staff.error ?: "اختر صنفًا واضغط «عرضُ البطاقة».")
            } else {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 20.dp),
                ) {
                    item {
                        SectionCard(
                            title = card.nameAr ?: card.itemId,
                            subtitle = "SKU: ${card.sku ?: "—"}",
                        ) {
                            KeyValue("افتتاحيُّ الفترة (كميّة)", Dec.kg(card.opening.quantity))
                            KeyValue("افتتاحيُّ الفترة (قيمة)", Dec.money(card.opening.value) + " ر.س")
                            KeyValue("واردُ الفترة", Dec.kg(card.totals.inQty) + " · " + Dec.money(card.totals.inValue) + " ر.س")
                            KeyValue("صادرُ الفترة", Dec.kg(card.totals.outQty) + " · " + Dec.money(card.totals.outValue) + " ر.س")
                            KeyValue("الرصيدُ الختاميّ (كميّة)", Dec.kg(card.closing.quantity))
                            KeyValue("الرصيدُ الختاميّ (قيمة)", Dec.money(card.closing.value) + " ر.س")
                        }
                    }
                    if (card.rows.isEmpty()) {
                        item { EmptyState("لا حركةً في هذه الفترة.") }
                    } else {
                        items(card.rows, key = { it.id }) { row ->
                            SectionCard(
                                title = Labels.dateOrDash(row.occurredAt?.take(10)),
                                subtitle = Labels.movementDoc(row.docType),
                            ) {
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    if (row.direction == "in") StatusChip("وارد " + Dec.kg(row.qty), ChipTone.OK)
                                    else StatusChip("صادر " + Dec.kg(row.qty), ChipTone.WARN)
                                    row.warehouseNameAr?.let { StatusChip(it, ChipTone.NEUTRAL) }
                                }
                                row.balanceQty?.let { KeyValue("الرصيدُ بعد الحركة (كميّة)", Dec.kg(it)) }
                                row.balanceValue?.let { KeyValue("الرصيدُ بعد الحركة (قيمة)", Dec.money(it) + " ر.س") }
                            }
                        }
                    }
                }
            }
        }
    }

    if (pickItem) {
        PickerDialog(
            title = "اختر الصنف",
            items = state.effectiveItems.map { PickerItem(it.id, it.label, subtitle = it.subtitle) },
            loading = state.loadingLookups,
            errorMessage = state.lookupsError,
            onRefresh = { vm.ensureLookups(force = true) },
            onQueryChange = { vm.searchItemsRemotely(it) },
            alwaysShowSearch = true,
            onDismiss = { pickItem = false },
            onSelect = { itemId = it.id; itemLabel = it.title; pickItem = false },
        )
    }
}

/** أوّلُ اليومِ الأوّلِ من الشهرِ الماضي (SimpleDateFormat: minSdk 24). */
private fun firstDayOfPreviousMonth(): String {
    val cal = java.util.Calendar.getInstance()
    cal.add(Calendar.MONTH, -1)
    cal.set(Calendar.DAY_OF_MONTH, 1)
    return SimpleDateFormat("yyyy-MM-01", Locale.US).format(cal.time)
}
