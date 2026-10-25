package com.erpcloud.bakery.ui.screens

import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import com.erpcloud.bakery.ui.components.PickerTrigger
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.EmptyState
import com.erpcloud.bakery.ui.components.InlineAction
import com.erpcloud.bakery.ui.components.KeyValue
import com.erpcloud.bakery.ui.components.MissingPermissionHint
import com.erpcloud.bakery.ui.components.PickerDialog
import com.erpcloud.bakery.ui.components.PickerItem
import com.erpcloud.bakery.ui.components.PullRefreshBox
import com.erpcloud.bakery.ui.components.SearchField
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.components.StatusChip
import com.erpcloud.bakery.util.Dec
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * شاشاتُ الكتالوج الثلاث المستقلّة — قرارُ المالك: **كلُّ شاشةٍ وظيفةٌ واحدة**.
 * الأصناف (`catalog.item.*`) والمجموعات (`catalog.category.*`) والوحدات
 * (`catalog.unit.*`) — كلٌّ منها قائمةٌ + إنشاءٌ بإذنه الرسميّ، لا تبويباتٍ
 * تجمعُ المتشابهَ والمختلف.
 */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ItemsScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var showCreate by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var editTarget by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { vm.loadCatalog() }

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
                            showCreate -> "إضافة صنف جديد"
                            editTarget != null -> "تعديل الصنف"
                            else -> "الأصناف"
                        },
                    )
                },
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
            if (!showCreate && editTarget == null && state.can("catalog.item.manage")) {
                FloatingActionButton(onClick = { showCreate = true }) {
                    Icon(Icons.Default.Add, contentDescription = "صنف جديد")
                }
            }
        },
    ) { padding ->
        if (showCreate) {
            androidx.compose.foundation.layout.Box(Modifier.fillMaxSize().padding(padding)) {
                ItemForm(vm, onDone = { showCreate = false })
            }
            return@Scaffold
        }
        val editing = editTarget?.let { id -> state.staff.catalogItems.firstOrNull { it.id == id } }
        if (editing != null) {
            androidx.compose.foundation.layout.Box(Modifier.fillMaxSize().padding(padding)) {
                ItemForm(vm, initial = editing, onDone = { editTarget = null })
            }
            return@Scaffold
        }
        PullRefreshBox(
            refreshing = state.staff.loadingKey == "catalog",
            onRefresh = { vm.loadCatalog() },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            Column(Modifier.fillMaxSize()) {
                if (!state.can("catalog.item.manage")) {
                    MissingPermissionHint(
                        "إضافة صنف",
                        "catalog.item.manage",
                        Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                    )
                }
                SearchField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.padding(start = 14.dp, end = 14.dp, top = 6.dp),
                    placeholder = "ابحثُ بالاسم أو SKU أو الباركود",
                )
                val itemsList = if (query.isBlank()) {
                    state.staff.catalogItems
                } else {
                    val needle = query.trim()
                    state.staff.catalogItems.filter { row ->
                        row.nameAr.contains(needle, ignoreCase = true) ||
                            row.sku.contains(needle, ignoreCase = true) ||
                            (row.barcode?.contains(needle, ignoreCase = true) ?: false)
                    }
                }
                if (state.staff.loadingKey == "catalog") {
                    CenterLoading("جارٍ تحميل الأصناف…")
                } else if (itemsList.isEmpty()) {
                    EmptyState(if (query.isBlank()) state.staff.error ?: "لا أصنافَ بعد." else "لا صنفَ يطابقُ البحث.")
                } else {
                    LazyColumn(
                        Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(start = 14.dp, end = 14.dp, bottom = 20.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(itemsList, key = { it.id }) { item ->
                            SectionCard(
                                title = item.nameAr,
                                subtitle = "SKU: ${item.sku.ifBlank { "—" }}" + (item.barcode?.let { " · باركود: $it" } ?: ""),
                            ) {
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    StatusChip(
                                        when (item.kind) {
                                            "service" -> "خدمة"
                                            "composite" -> "مركّب"
                                            else -> "مخزنيّ"
                                        },
                                        ChipTone.NEUTRAL,
                                    )
                                    if (item.trackLot) StatusChip("يتتبّع الدفعات", ChipTone.INFO)
                                    if (item.showInPos) StatusChip("في نقطة البيع", ChipTone.OK)
                                }
                                Spacer(Modifier.height(6.dp))
                                item.salePrice?.let { KeyValue("سعرُ البيع", Dec.money(it) + " ر.س") }
                                item.purchasePrice?.let { KeyValue("سعرُ الشراء", Dec.money(it) + " ر.س") }
                                item.minQty?.let { KeyValue("الحدُّ الأدنى", Dec.kg(it)) }
                                state.staff.categories.firstOrNull { it.id == item.categoryId }?.let { KeyValue("المجموعة", it.nameAr) }
                                state.staff.units.firstOrNull { it.id == item.baseUnitId }?.let { KeyValue("الوحدةُ الأساسيّة", it.nameAr) }
                                Spacer(Modifier.height(8.dp))
                                if (state.can("catalog.item.manage")) {
                                    InlineAction(label = "تعديل", onClick = { editTarget = item.id })
                                } else {
                                    MissingPermissionHint("تعديل صنف", "catalog.item.manage")
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CategoriesScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var showCreate by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var editTarget by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { vm.loadCatalog() }

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
                            showCreate -> "إضافة مجموعة جديدة"
                            editTarget != null -> "تعديل المجموعة"
                            else -> "مجموعاتُ الأصناف"
                        },
                    )
                },
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
            if (!showCreate && editTarget == null && state.can("catalog.category.manage")) {
                FloatingActionButton(onClick = { showCreate = true }) {
                    Icon(Icons.Default.Add, contentDescription = "مجموعة جديدة")
                }
            }
        },
    ) { padding ->
        if (showCreate) {
            androidx.compose.foundation.layout.Box(Modifier.fillMaxSize().padding(padding)) {
                CategoryForm(vm, onDone = { showCreate = false })
            }
            return@Scaffold
        }
        val editing = editTarget?.let { id -> state.staff.categories.firstOrNull { it.id == id } }
        if (editing != null) {
            androidx.compose.foundation.layout.Box(Modifier.fillMaxSize().padding(padding)) {
                CategoryForm(vm, initial = editing, onDone = { editTarget = null })
            }
            return@Scaffold
        }
        PullRefreshBox(
            refreshing = state.staff.loadingKey == "catalog",
            onRefresh = { vm.loadCatalog() },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            Column(Modifier.fillMaxSize()) {
                if (!state.can("catalog.category.manage")) {
                    MissingPermissionHint(
                        "إضافة مجموعة",
                        "catalog.category.manage",
                        Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                    )
                }
                SearchField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.padding(start = 14.dp, end = 14.dp, top = 6.dp),
                    placeholder = "ابحثُ بالاسم أو الرمز",
                )
                val cats = if (query.isBlank()) {
                    state.staff.categories
                } else {
                    val needle = query.trim()
                    state.staff.categories.filter { row ->
                        row.nameAr.contains(needle, ignoreCase = true) || row.code.contains(needle, ignoreCase = true)
                    }
                }
                if (state.staff.loadingKey == "catalog") {
                    CenterLoading("جارٍ تحميل المجموعات…")
                } else if (cats.isEmpty()) {
                    EmptyState(if (query.isBlank()) state.staff.error ?: "لا مجموعاتٍ بعد." else "لا مجموعةَ تطابقُ البحث.")
                } else {
                    LazyColumn(
                        Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(start = 14.dp, end = 14.dp, bottom = 20.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(cats, key = { it.id }) { cat ->
                            SectionCard(title = cat.nameAr, subtitle = "الرمز: ${cat.code}") {
                                state.staff.categories.firstOrNull { it.id == cat.parentId }?.let {
                                    KeyValue("المجموعةُ الأب", it.nameAr)
                                }
                                Spacer(Modifier.height(8.dp))
                                if (state.can("catalog.category.manage")) {
                                    InlineAction(label = "تعديل", onClick = { editTarget = cat.id })
                                } else {
                                    MissingPermissionHint("تعديل مجموعة", "catalog.category.manage")
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UnitsScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var showCreate by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var editTarget by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { vm.loadCatalog() }

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
                            showCreate -> "إضافة وحدة قياس"
                            editTarget != null -> "تعديل وحدة القياس"
                            else -> "وحداتُ القياس"
                        },
                    )
                },
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
            if (!showCreate && editTarget == null && state.can("catalog.unit.manage")) {
                FloatingActionButton(onClick = { showCreate = true }) {
                    Icon(Icons.Default.Add, contentDescription = "وحدة جديدة")
                }
            }
        },
    ) { padding ->
        if (showCreate) {
            androidx.compose.foundation.layout.Box(Modifier.fillMaxSize().padding(padding)) {
                UnitForm(vm, onDone = { showCreate = false })
            }
            return@Scaffold
        }
        val editing = editTarget?.let { id -> state.staff.units.firstOrNull { it.id == id } }
        if (editing != null) {
            androidx.compose.foundation.layout.Box(Modifier.fillMaxSize().padding(padding)) {
                UnitForm(vm, initial = editing, onDone = { editTarget = null })
            }
            return@Scaffold
        }
        PullRefreshBox(
            refreshing = state.staff.loadingKey == "catalog",
            onRefresh = { vm.loadCatalog() },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            Column(Modifier.fillMaxSize()) {
                if (!state.can("catalog.unit.manage")) {
                    MissingPermissionHint(
                        "إضافة وحدة",
                        "catalog.unit.manage",
                        Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                    )
                }
                SearchField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.padding(start = 14.dp, end = 14.dp, top = 6.dp),
                    placeholder = "ابحثُ بالاسم أو الرمز",
                )
                val units = if (query.isBlank()) {
                    state.staff.units
                } else {
                    val needle = query.trim()
                    state.staff.units.filter { row ->
                        row.nameAr.contains(needle, ignoreCase = true) || row.code.contains(needle, ignoreCase = true)
                    }
                }
                if (state.staff.loadingKey == "catalog") {
                    CenterLoading("جارٍ تحميل الوحدات…")
                } else if (units.isEmpty()) {
                    EmptyState(if (query.isBlank()) state.staff.error ?: "لا وحداتَ بعد." else "لا وحدةَ تطابقُ البحث.")
                } else {
                    LazyColumn(
                        Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(start = 14.dp, end = 14.dp, bottom = 20.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(units, key = { it.id }) { unit ->
                            SectionCard(title = unit.nameAr, subtitle = "الرمز: ${unit.code}") {
                                if (state.can("catalog.unit.manage")) {
                                    InlineAction(label = "تعديل", onClick = { editTarget = unit.id })
                                } else {
                                    MissingPermissionHint("تعديل وحدة", "catalog.unit.manage")
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** إنشاءُ/تعديلُ صنف — `POST /organization/catalog/items` للإنشاء، و
 * `PATCH /organization/catalog/items/{id}` للتعديل (sku, nameAr, categoryId,
 * baseUnitId إلزاميّة في النموذج؛ والنوعُ مخزنيّ/خدمة/مركّب والظهورُ في نقطة
 * البيع من مدخلاتِ المرحلة الثانية). */
@Composable
private fun ItemForm(
    vm: AppViewModel,
    onDone: () -> Unit,
    initial: com.erpcloud.bakery.data.api.CatalogItemDto? = null,
) {
    val state by vm.uiState.collectAsState()
    var sku by remember { mutableStateOf(initial?.sku ?: "") }
    var nameAr by remember { mutableStateOf(initial?.nameAr ?: "") }
    var barcode by remember { mutableStateOf(initial?.barcode ?: "") }
    var salePrice by remember { mutableStateOf(initial?.salePrice ?: "") }
    var purchasePrice by remember { mutableStateOf(initial?.purchasePrice ?: "") }
    var minQty by remember { mutableStateOf(initial?.minQty ?: "") }
    var categoryId by remember { mutableStateOf(initial?.categoryId ?: "") }
    var categoryLabel by remember {
        mutableStateOf(initial?.categoryId?.let { id -> state.staff.categories.firstOrNull { it.id == id }?.nameAr } ?: "")
    }
    var baseUnitId by remember { mutableStateOf(initial?.baseUnitId ?: "") }
    var unitLabel by remember {
        mutableStateOf(initial?.baseUnitId?.let { id -> state.staff.units.firstOrNull { it.id == id }?.nameAr } ?: "")
    }
    var taxGroupId by remember {
        mutableStateOf(
            initial?.taxGroupId
                ?: if (initial == null) state.staff.taxGroups.firstOrNull { it.isDefault }?.id ?: "" else ""
        )
    }
    var taxGroupLabel by remember {
        mutableStateOf(
            (initial?.taxGroupId ?: if (initial == null) state.staff.taxGroups.firstOrNull { it.isDefault }?.id else null)
                ?.let { id -> state.staff.taxGroups.firstOrNull { it.id == id }?.let { "${it.nameAr} (${Dec.fmt(it.rate, 2, 0)}%)" } }
                ?: ""
        )
    }
    var kind by remember { mutableStateOf(initial?.kind?.takeIf { it.isNotBlank() } ?: "stock") }
    var showInPos by remember { mutableStateOf(initial?.showInPos ?: true) }
    var trackLot by remember { mutableStateOf(initial?.trackLot ?: false) }
    var pickCategory by remember { mutableStateOf(false) }
    var pickUnit by remember { mutableStateOf(false) }
    var pickTaxGroup by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    LaunchedEffect(state.staff.taxGroups) {
        if (initial == null && taxGroupId.isBlank()) {
            state.staff.taxGroups.firstOrNull { it.isDefault }?.let {
                taxGroupId = it.id
                taxGroupLabel = "${it.nameAr} (${Dec.fmt(it.rate, 2, 0)}%)"
            }
        } else if (taxGroupId.isNotBlank() && taxGroupLabel.isBlank()) {
            state.staff.taxGroups.firstOrNull { it.id == taxGroupId }?.let {
                taxGroupLabel = "${it.nameAr} (${Dec.fmt(it.rate, 2, 0)}%)"
            }
        }
    }

    LazyColumn(
        Modifier.fillMaxSize().padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            SectionCard(
                title = if (initial == null) "صنفٌ جديد" else "تعديلُ الصنف",
                subtitle = if (initial == null) "الحقولُ المعلَّمةُ بنجمةٍ إلزاميّةٌ عند الخادم" else "تعديلٌ جزئيّ بإذن catalog.item.manage — تُعادُ القائمةُ بعد الحفظ",
            ) {
                OutlinedTextField(value = sku, onValueChange = { sku = it }, label = { Text("رمزُ الصنف (SKU) *") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = nameAr, onValueChange = { nameAr = it }, label = { Text("الاسمُ بالعربيّة *") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = barcode, onValueChange = { barcode = it }, label = { Text("الباركود") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = categoryLabel,
                    onValueChange = {},
                    readOnly = true,
                    interactionSource = rememberPickerInteractionSource { pickCategory = true },
                    label = { Text("المجموعة *") },
                    placeholder = { Text("اختر المجموعة") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { PickerTrigger(onClick = { pickCategory = true }) },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = unitLabel,
                    onValueChange = {},
                    readOnly = true,
                    enabled = initial == null,
                    interactionSource = rememberPickerInteractionSource { if (initial == null) pickUnit = true },
                    label = { Text(if (initial == null) "الوحدةُ الأساسيّة *" else "الوحدةُ الأساسيّة (تُحدَّد عند الإنشاء)") },
                    placeholder = { Text("اختر الوحدة") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = {
                        if (initial == null) {
                            PickerTrigger(onClick = { pickUnit = true })
                        }
                    },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = taxGroupLabel.ifBlank { "بدون مجموعة ضريبيّة" },
                    onValueChange = {},
                    readOnly = true,
                    interactionSource = rememberPickerInteractionSource { pickTaxGroup = true },
                    label = { Text("المجموعةُ الضريبيّة") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { PickerTrigger(onClick = { pickTaxGroup = true }) },
                )
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(
                        "stock" to "مخزنيّ",
                        "service" to "خدمة",
                        "composite" to "مركّب",
                    ).forEach { (value, labelAr) ->
                        FilterChip(
                            selected = kind == value,
                            onClick = { kind = value },
                            label = { Text(labelAr) },
                        )
                    }
                }
                Spacer(Modifier.height(8.dp))
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("الظهور في نقطة البيع", style = MaterialTheme.typography.bodyMedium)
                        Text(
                            "يُدرَج الصنفُ في شاشةِ البيع السريع",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Switch(checked = showInPos, onCheckedChange = { showInPos = it })
                }
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = salePrice,
                    onValueChange = { if (Dec.isValidInput(it)) salePrice = it },
                    label = { Text("سعرُ البيع (ر.س)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = purchasePrice,
                    onValueChange = { if (Dec.isValidInput(it)) purchasePrice = it },
                    label = { Text("سعرُ الشراء (ر.س)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = minQty,
                    onValueChange = { if (Dec.isValidInput(it)) minQty = it },
                    label = { Text("الحدُّ الأدنى للمخزون") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = trackLot, onCheckedChange = { trackLot = it })
                    Text("يتتبّع الدفعات (lot)")
                }
                if (error != null) {
                    Spacer(Modifier.height(8.dp))
                    StatusChip(error ?: "", ChipTone.DANGER)
                }
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ActionButton(
                        label = when {
                            sending -> "جارٍ الحفظ…"
                            initial == null -> "حفظُ الصنف"
                            else -> "حفظُ التعديل"
                        },
                        onClick = {
                            error = when {
                                sku.isBlank() -> "رمزُ الصنف (SKU) إلزاميّ."
                                nameAr.isBlank() -> "اسمُ الصنف إلزاميّ."
                                categoryId.isBlank() -> "اختر المجموعة."
                                baseUnitId.isBlank() -> "اختر الوحدةَ الأساسيّة."
                                (Dec.parse(salePrice)?.signum() ?: 0) < 0 -> "الأسعارُ موجبةٌ فقط."
                                (Dec.parse(purchasePrice)?.signum() ?: 0) < 0 -> "الأسعارُ موجبةٌ فقط."
                                (Dec.parse(minQty)?.signum() ?: 0) < 0 -> "الكمّياتُ موجبةٌ فقط."
                                else -> null
                            }
                            if (error != null) return@ActionButton
                            sending = true
                            val body = buildJsonObject {
                                put("sku", sku.trim())
                                if (barcode.isNotBlank()) put("barcode", barcode.trim())
                                put("nameAr", nameAr.trim())
                                put("categoryId", categoryId)
                                put("baseUnitId", baseUnitId)
                                put("kind", kind)
                                if (taxGroupId.isNotBlank()) put("taxGroupId", taxGroupId)
                                else if (initial?.taxGroupId != null) put("taxGroupId", JsonNull)
                                if (salePrice.isNotBlank()) put("salePrice", Dec.wire(salePrice))
                                if (purchasePrice.isNotBlank()) put("purchasePrice", Dec.wire(purchasePrice))
                                if (minQty.isNotBlank()) put("minQty", Dec.wire(minQty))
                                put("trackLot", trackLot)
                                // showInPos لا يعرفُها مخططُ الإنشاءِ عند الخادمِ —
                                // تُرسَلُ بعد الإنشاءِ بتعديلٍ لاحقٍ (createCatalogItemWithPos).
                            }
                            if (initial == null) {
                                vm.createCatalogItemWithPos(body, showInPos) { result ->
                                    sending = false
                                    if (result is ActionResult.Synced) {
                                        vm.loadCatalog()
                                        onDone()
                                    }
                                }
                            } else {
                                // الوحدةُ الأساسيّةُ تُحدَّدُ عند الإنشاءِ فقط —
                                // مخططُ التعديلِ لا يقبلُها فلا تُرسَل.
                                val patchBody = kotlinx.serialization.json.buildJsonObject {
                                    body.forEach { (key, value) ->
                                        if (key != "baseUnitId") put(key, value)
                                    }
                                    put("showInPos", showInPos)
                                }
                                vm.updateCatalogItem(initial.id, patchBody) { result ->
                                    sending = false
                                    if (result is ActionResult.Synced) {
                                        vm.loadCatalog()
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

    if (pickCategory) {
        PickerDialog(
            title = "اختر المجموعة",
            items = state.staff.categories.map { PickerItem(it.id, it.nameAr, trailing = it.code) },
            onDismiss = { pickCategory = false },
            onSelect = { categoryId = it.id; categoryLabel = it.title; pickCategory = false },
        )
    }
    if (pickUnit) {
        PickerDialog(
            title = "اختر الوحدة",
            items = state.staff.units.map { PickerItem(it.id, it.nameAr, trailing = it.code) },
            onDismiss = { pickUnit = false },
            onSelect = { baseUnitId = it.id; unitLabel = it.title; pickUnit = false },
        )
    }
    if (pickTaxGroup) {
        val taxOptions = buildList {
            add(PickerItem("", "بدون مجموعة ضريبيّة"))
            state.staff.taxGroups.forEach { tg ->
                add(
                    PickerItem(
                        tg.id,
                        "${tg.nameAr} (${Dec.fmt(tg.rate, 2, 0)}%)",
                        trailing = if (tg.isDefault) "افتراضيّة" else tg.code,
                    )
                )
            }
        }
        PickerDialog(
            title = "المجموعةُ الضريبيّة",
            items = taxOptions,
            onDismiss = { pickTaxGroup = false },
            onSelect = {
                taxGroupId = it.id
                taxGroupLabel = if (it.id.isBlank()) "" else it.title
                pickTaxGroup = false
            },
        )
    }
}

/** إنشاءُ/تعديلُ مجموعة — `POST /organization/catalog/categories` للإنشاء،
 * و`PATCH /organization/catalog/categories/{id}` للتعديل (code, nameAr, parentId). */
@Composable
private fun CategoryForm(
    vm: AppViewModel,
    onDone: () -> Unit,
    initial: com.erpcloud.bakery.data.api.CategoryDto? = null,
) {
    val state by vm.uiState.collectAsState()
    var code by remember { mutableStateOf(initial?.code ?: "") }
    var nameAr by remember { mutableStateOf(initial?.nameAr ?: "") }
    var parentId by remember { mutableStateOf(initial?.parentId ?: "") }
    var parentLabel by remember {
        mutableStateOf(initial?.parentId?.let { id -> state.staff.categories.firstOrNull { it.id == id }?.nameAr } ?: "")
    }
    var pickParent by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    SectionCard(
        title = if (initial == null) "مجموعةٌ جديدة" else "تعديلُ المجموعة",
        modifier = Modifier.padding(14.dp),
    ) {
        OutlinedTextField(value = code, onValueChange = { code = it }, label = { Text("الرمز *") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = nameAr, onValueChange = { nameAr = it }, label = { Text("الاسمُ بالعربيّة *") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = parentLabel.ifBlank { "مجموعةٌ رئيسيّة (بلا أب)" },
            onValueChange = {},
            readOnly = true,
            interactionSource = rememberPickerInteractionSource { pickParent = true },
            label = { Text("المجموعةُ الأب (اختياريّ)") },
            modifier = Modifier.fillMaxWidth(),
            trailingIcon = { PickerTrigger(onClick = { pickParent = true }) },
        )
        if (error != null) {
            Spacer(Modifier.height(8.dp))
            StatusChip(error ?: "", ChipTone.DANGER)
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ActionButton(
                label = when {
                    sending -> "جارٍ الحفظ…"
                    initial == null -> "حفظُ المجموعة"
                    else -> "حفظُ التعديل"
                },
                onClick = {
                    error = when {
                        code.isBlank() -> "رمزُ المجموعة إلزاميّ."
                        nameAr.isBlank() -> "اسمُ المجموعة إلزاميّ."
                        else -> null
                    }
                    if (error != null) return@ActionButton
                    sending = true
                    val body = buildJsonObject {
                        put("code", code.trim())
                        put("nameAr", nameAr.trim())
                        if (parentId.isNotBlank()) put("parentId", parentId)
                        else if (initial?.parentId != null) put("parentId", JsonNull)
                    }
                    if (initial == null) {
                        vm.createCategory(body) { result ->
                            sending = false
                            if (result is ActionResult.Synced) {
                                vm.loadCatalog()
                                onDone()
                            }
                        }
                    } else {
                        vm.updateCategory(initial.id, body) { result ->
                            sending = false
                            if (result is ActionResult.Synced) {
                                vm.loadCatalog()
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

    if (pickParent) {
        // استبعادُ المجموعةِ نفسِها وأبنائها لمنعِ حلقةِ آباءٍ (CATEGORY_CYCLE).
        val forbiddenIds = remember(initial?.id, state.staff.categories) {
            if (initial == null) emptySet()
            else {
                val blocked = mutableSetOf(initial.id)
                var added = true
                while (added) {
                    added = false
                    for (cat in state.staff.categories) {
                        if (cat.parentId != null && cat.parentId in blocked && blocked.add(cat.id)) {
                            added = true
                        }
                    }
                }
                blocked
            }
        }
        val parentOptions = buildList {
            add(PickerItem("", "مجموعةٌ رئيسيّة (بلا أب)"))
            state.staff.categories
                .filter { it.id !in forbiddenIds }
                .forEach { add(PickerItem(it.id, it.nameAr, trailing = it.code)) }
        }
        PickerDialog(
            title = "المجموعةُ الأب",
            items = parentOptions,
            onDismiss = { pickParent = false },
            onSelect = {
                parentId = it.id
                parentLabel = if (it.id.isBlank()) "" else it.title
                pickParent = false
            },
        )
    }
}

/** إنشاءُ/تعديلُ وحدة — `POST /organization/catalog/units` للإنشاء،
 * و`PATCH /organization/catalog/units/{id}` للتعديل (code, nameAr). */
@Composable
private fun UnitForm(
    vm: AppViewModel,
    onDone: () -> Unit,
    initial: com.erpcloud.bakery.data.api.UnitDto? = null,
) {
    var code by remember { mutableStateOf(initial?.code ?: "") }
    var nameAr by remember { mutableStateOf(initial?.nameAr ?: "") }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    SectionCard(
        title = if (initial == null) "وحدةُ قياسٍ جديدة" else "تعديلُ الوحدة",
        modifier = Modifier.padding(14.dp),
    ) {
        OutlinedTextField(value = code, onValueChange = { code = it }, label = { Text("الرمز *") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = nameAr, onValueChange = { nameAr = it }, label = { Text("الاسمُ بالعربيّة *") }, modifier = Modifier.fillMaxWidth())
        if (error != null) {
            Spacer(Modifier.height(8.dp))
            StatusChip(error ?: "", ChipTone.DANGER)
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ActionButton(
                label = when {
                    sending -> "جارٍ الحفظ…"
                    initial == null -> "حفظُ الوحدة"
                    else -> "حفظُ التعديل"
                },
                onClick = {
                    error = when {
                        code.isBlank() -> "رمزُ الوحدة إلزاميّ."
                        nameAr.isBlank() -> "اسمُ الوحدة إلزاميّ."
                        else -> null
                    }
                    if (error != null) return@ActionButton
                    sending = true
                    val body = buildJsonObject {
                        put("code", code.trim())
                        put("nameAr", nameAr.trim())
                    }
                    if (initial == null) {
                        vm.createUnit(body) { result ->
                            sending = false
                            if (result is ActionResult.Synced) {
                                vm.loadCatalog()
                                onDone()
                            }
                        }
                    } else {
                        vm.updateUnit(initial.id, body) { result ->
                            sending = false
                            if (result is ActionResult.Synced) {
                                vm.loadCatalog()
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
