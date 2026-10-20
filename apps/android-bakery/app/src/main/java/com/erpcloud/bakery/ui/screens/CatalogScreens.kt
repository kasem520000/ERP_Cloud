package com.erpcloud.bakery.ui.screens

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.data.ActionResult
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.ActionButton
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.EmptyState
import com.erpcloud.bakery.ui.components.KeyValue
import com.erpcloud.bakery.ui.components.MissingPermissionHint
import com.erpcloud.bakery.ui.components.PickerDialog
import com.erpcloud.bakery.ui.components.PickerItem
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.components.StatusChip
import com.erpcloud.bakery.util.Dec
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

    LaunchedEffect(Unit) { vm.loadCatalog() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("الأصناف") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
        floatingActionButton = {
            if (!showCreate && state.can("catalog.item.manage")) {
                FloatingActionButton(onClick = { showCreate = true }) {
                    Icon(Icons.Default.Add, contentDescription = "صنف جديد")
                }
            }
        },
    ) { padding ->
        if (!state.can("catalog.item.manage")) {
            MissingPermissionHint("إضافة صنف", "catalog.item.manage", Modifier.padding(padding))
        }
        if (showCreate) {
            CreateItemForm(vm, onDone = { showCreate = false })
            return@Scaffold
        }
        if (state.staff.loadingKey == "catalog") {
            CenterLoading("جارٍ تحميل الأصناف…", Modifier.padding(padding))
            return@Scaffold
        }
        val itemsList = state.staff.catalogItems
        if (itemsList.isEmpty()) {
            EmptyState(state.staff.error ?: "لا أصنافَ بعد.", Modifier.padding(padding))
            return@Scaffold
        }
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(14.dp),
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

    LaunchedEffect(Unit) { vm.loadCatalog() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("مجموعاتُ الأصناف") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
        floatingActionButton = {
            if (!showCreate && state.can("catalog.category.manage")) {
                FloatingActionButton(onClick = { showCreate = true }) {
                    Icon(Icons.Default.Add, contentDescription = "مجموعة جديدة")
                }
            }
        },
    ) { padding ->
        if (!state.can("catalog.category.manage")) {
            MissingPermissionHint("إضافة مجموعة", "catalog.category.manage", Modifier.padding(padding))
        }
        if (showCreate) {
            CreateCategoryForm(vm, onDone = { showCreate = false })
            return@Scaffold
        }
        if (state.staff.loadingKey == "catalog") {
            CenterLoading("جارٍ تحميل المجموعات…", Modifier.padding(padding))
            return@Scaffold
        }
        val cats = state.staff.categories
        if (cats.isEmpty()) {
            EmptyState(state.staff.error ?: "لا مجموعاتٍ بعد.", Modifier.padding(padding))
            return@Scaffold
        }
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(cats, key = { it.id }) { cat ->
                SectionCard(title = cat.nameAr, subtitle = "الرمز: ${cat.code}") {
                    state.staff.categories.firstOrNull { it.id == cat.parentId }?.let {
                        KeyValue("المجموعةُ الأب", it.nameAr)
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

    LaunchedEffect(Unit) { vm.loadCatalog() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("وحداتُ القياس") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
        floatingActionButton = {
            if (!showCreate && state.can("catalog.unit.manage")) {
                FloatingActionButton(onClick = { showCreate = true }) {
                    Icon(Icons.Default.Add, contentDescription = "وحدة جديدة")
                }
            }
        },
    ) { padding ->
        if (!state.can("catalog.unit.manage")) {
            MissingPermissionHint("إضافة وحدة", "catalog.unit.manage", Modifier.padding(padding))
        }
        if (showCreate) {
            CreateUnitForm(vm, onDone = { showCreate = false })
            return@Scaffold
        }
        if (state.staff.loadingKey == "catalog") {
            CenterLoading("جارٍ تحميل الوحدات…", Modifier.padding(padding))
            return@Scaffold
        }
        val units = state.staff.units
        if (units.isEmpty()) {
            EmptyState(state.staff.error ?: "لا وحداتَ بعد.", Modifier.padding(padding))
            return@Scaffold
        }
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(units, key = { it.id }) { unit ->
                SectionCard(title = unit.nameAr, subtitle = "الرمز: ${unit.code}") { }
            }
        }
    }
}

/** إنشاءُ صنف — `POST /organization/catalog/items` (sku, nameAr, categoryId, baseUnitId إلزاميّة). */
@Composable
private fun CreateItemForm(vm: AppViewModel, onDone: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var sku by remember { mutableStateOf("") }
    var nameAr by remember { mutableStateOf("") }
    var barcode by remember { mutableStateOf("") }
    var salePrice by remember { mutableStateOf("") }
    var purchasePrice by remember { mutableStateOf("") }
    var minQty by remember { mutableStateOf("") }
    var categoryId by remember { mutableStateOf("") }
    var categoryLabel by remember { mutableStateOf("") }
    var baseUnitId by remember { mutableStateOf("") }
    var unitLabel by remember { mutableStateOf("") }
    var trackLot by remember { mutableStateOf(false) }
    var pickCategory by remember { mutableStateOf(false) }
    var pickUnit by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    LazyColumn(
        Modifier.fillMaxSize().padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            SectionCard(title = "صنفٌ جديد", subtitle = "الحقولُ المعلَّمةُ بنجمةٍ إلزاميّةٌ عند الخادم") {
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
                    label = { Text("المجموعة *") },
                    placeholder = { Text("اختر المجموعة") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { IconButton(onClick = { pickCategory = true }) { Text("اختر") } },
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = unitLabel,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("الوحدةُ الأساسيّة *") },
                    placeholder = { Text("اختر الوحدة") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { IconButton(onClick = { pickUnit = true }) { Text("اختر") } },
                )
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
                        label = if (sending) "جارٍ الحفظ…" else "حفظُ الصنف",
                        onClick = {
                            error = when {
                                sku.isBlank() -> "رمزُ الصنف (SKU) إلزاميّ."
                                nameAr.isBlank() -> "اسمُ الصنف إلزاميّ."
                                categoryId.isBlank() -> "اختر المجموعة."
                                baseUnitId.isBlank() -> "اختر الوحدةَ الأساسيّة."
                                (Dec.parse(salePrice)?.signum() ?: 0) < 0 -> "الأسعارُ موجبةٌ فقط."
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
                                if (salePrice.isNotBlank()) put("salePrice", Dec.wire(salePrice))
                                if (purchasePrice.isNotBlank()) put("purchasePrice", Dec.wire(purchasePrice))
                                if (minQty.isNotBlank()) put("minQty", Dec.wire(minQty))
                                put("trackLot", trackLot)
                            }
                            vm.createCatalogItem(body) { result ->
                                sending = false
                                if (result is ActionResult.Synced) {
                                    vm.loadCatalog()
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

    if (pickCategory) {
        PickerDialog(
            title = "اختر المجموعة",
            items = state.staff.categories.map { PickerItem(it.id, it.nameAr, trailing = it.code) },
            onDismiss = { pickCategory = false },
            onSelect = { categoryId = it.id; categoryLabel = it.title },
        )
    }
    if (pickUnit) {
        PickerDialog(
            title = "اختر الوحدة",
            items = state.staff.units.map { PickerItem(it.id, it.nameAr, trailing = it.code) },
            onDismiss = { pickUnit = false },
            onSelect = { baseUnitId = it.id; unitLabel = it.title },
        )
    }
}

/** إنشاءُ مجموعة — `POST /organization/catalog/categories` (code, nameAr). */
@Composable
private fun CreateCategoryForm(vm: AppViewModel, onDone: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var code by remember { mutableStateOf("") }
    var nameAr by remember { mutableStateOf("") }
    var parentId by remember { mutableStateOf("") }
    var parentLabel by remember { mutableStateOf("") }
    var pickParent by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    SectionCard(title = "مجموعةٌ جديدة", modifier = Modifier.padding(14.dp)) {
        OutlinedTextField(value = code, onValueChange = { code = it }, label = { Text("الرمز *") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = nameAr, onValueChange = { nameAr = it }, label = { Text("الاسمُ بالعربيّة *") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = parentLabel,
            onValueChange = {},
            readOnly = true,
            label = { Text("المجموعةُ الأب (اختياريّ)") },
            modifier = Modifier.fillMaxWidth(),
            trailingIcon = { IconButton(onClick = { pickParent = true }) { Text("اختر") } },
        )
        if (error != null) {
            Spacer(Modifier.height(8.dp))
            StatusChip(error ?: "", ChipTone.DANGER)
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ActionButton(
                label = if (sending) "جارٍ الحفظ…" else "حفظُ المجموعة",
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
                    }
                    vm.createCategory(body) { result ->
                        sending = false
                        if (result is ActionResult.Synced) {
                            vm.loadCatalog()
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

    if (pickParent) {
        PickerDialog(
            title = "المجموعةُ الأب",
            items = state.staff.categories.map { PickerItem(it.id, it.nameAr, trailing = it.code) },
            onDismiss = { pickParent = false },
            onSelect = { parentId = it.id; parentLabel = it.title },
        )
    }
}

/** إنشاءُ وحدة — `POST /organization/catalog/units` (code, nameAr). */
@Composable
private fun CreateUnitForm(vm: AppViewModel, onDone: () -> Unit) {
    var code by remember { mutableStateOf("") }
    var nameAr by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    SectionCard(title = "وحدةُ قياسٍ جديدة", modifier = Modifier.padding(14.dp)) {
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
                label = if (sending) "جارٍ الحفظ…" else "حفظُ الوحدة",
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
                    vm.createUnit(body) { result ->
                        sending = false
                        if (result is ActionResult.Synced) {
                            vm.loadCatalog()
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
