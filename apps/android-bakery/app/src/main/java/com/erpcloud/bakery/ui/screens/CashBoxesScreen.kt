@file:OptIn(ExperimentalMaterial3Api::class)

package com.erpcloud.bakery.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.data.ActionResult
import com.erpcloud.bakery.data.api.AccountDto
import com.erpcloud.bakery.data.api.BranchDto
import com.erpcloud.bakery.data.api.CashLocationBalanceDto
import com.erpcloud.bakery.data.api.CashLocationDto
import com.erpcloud.bakery.data.api.CashMovementStatementDto
import com.erpcloud.bakery.data.api.CashTransferDto
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.ActionButton
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.ConfirmDialog
import com.erpcloud.bakery.ui.components.DatePickerField
import com.erpcloud.bakery.ui.components.EmptyState
import com.erpcloud.bakery.ui.components.InfoCallout
import com.erpcloud.bakery.ui.components.KeyValue
import com.erpcloud.bakery.ui.components.PickerDialog
import com.erpcloud.bakery.ui.components.PickerItem
import com.erpcloud.bakery.ui.components.PickerTrigger
import com.erpcloud.bakery.ui.components.PullRefreshBox
import com.erpcloud.bakery.ui.components.SearchField
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.components.StatTile
import com.erpcloud.bakery.ui.components.StatusChip
import com.erpcloud.bakery.ui.components.rememberPickerInteractionSource
import com.erpcloud.bakery.ui.theme.BakeryColors
import com.erpcloud.bakery.util.Dec
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import java.math.BigDecimal
import java.time.LocalDate

/** ملخّصُ الرصيد المحسوب لصندوقٍ أو حسابٍ بنكيّ من دفتر الأستاذ أو الدفتر المساعد. */
private data class ResolvedBoxBalance(
    val primaryBalance: BigDecimal?,
    val currency: String = "SAR",
    val fromLedger: Boolean = false,
    val movementsCount: Int? = null,
    val subLedgerBalances: List<CashLocationBalanceDto> = emptyList(),
)

/**
 * شاشةُ «الصناديق والأرصدة» — تعرضُ الصندوقَ الرئيسيّ والحسابَ البنكيّ الرئيسيّ وكافّة
 * الصناديق والحسابات البنكيّة المضافة مع أرصدتها الحقيقيّة من دفتر الأستاذ، وكشف حركة
 * كلّ صندوق، والمناقلات النقديّة والبنكيّة بينها، وإضافة/تعديل الصناديق والبنوك.
 */
@Composable
fun CashBoxesScreen(
    vm: AppViewModel,
    onBack: () -> Unit,
    onOpenVouchers: (() -> Unit)? = null,
) {
    val state by vm.uiState.collectAsState()
    val scope = rememberCoroutineScope()

    val canReadLocations = state.can("organization.cashlocation.view")
    val canManageLocations = state.can("organization.cashlocation.manage")
    val canViewTreasury = state.can("treasury.view")
    val canManageTransfers = state.can("treasury.transfer.manage")

    var activeTab by rememberSaveable { mutableIntStateOf(0) } // 0 = الصناديق والبنوك, 1 = المناقلات
    var kindFilter by rememberSaveable { mutableStateOf("all") } // all | safe | bank
    var query by rememberSaveable { mutableStateOf("") }

    var loading by remember { mutableStateOf(true) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var locations by remember { mutableStateOf<List<CashLocationDto>>(emptyList()) }
    val resolvedBalances = remember { mutableStateMapOf<String, ResolvedBoxBalance>() }
    var transfers by remember { mutableStateOf<List<CashTransferDto>>(emptyList()) }

    // الشاشاتُ الفرعيّة
    var selectedStatementBoxId by rememberSaveable { mutableStateOf<String?>(null) }
    var showCreateBox by rememberSaveable { mutableStateOf(false) }
    var editingBoxId by rememberSaveable { mutableStateOf<String?>(null) }
    var showCreateTransfer by rememberSaveable { mutableStateOf(false) }
    var preselectedFromBoxId by rememberSaveable { mutableStateOf<String?>(null) }

    fun reloadAll() {
        scope.launch {
            loading = true
            loadError = null
            // ضمانُ توفّر الفروع والحسابات للعرض ونماذج الإضافة والتعديل
            vm.loadOrg()
            if (state.staff.accounts.isEmpty()) vm.loadAccounts()

            try {
                val loadedLocations = if (canReadLocations) {
                    vm.cashLocationsList()
                } else {
                    state.staff.cashLocations
                }
                locations = loadedLocations.sortedWith(
                    compareByDescending<CashLocationDto> { it.isActive }
                        .thenByDescending { it.isDefault }
                        .thenBy { if (it.kind == "safe") 0 else 1 }
                        .thenBy { it.displayName },
                )

                // جلبُ أرصدة جميع الصناديق والبنوك بالتوازي (الأستاذ العامّ أوّلًا ثمّ الدفتر الفرعيّ)
                coroutineScope {
                    loadedLocations.map { loc ->
                        async {
                            if (loc.id.isBlank()) return@async
                            val subRows = if (canReadLocations) {
                                runCatching { vm.cashLocationBalances(loc.id) }.getOrDefault(emptyList())
                            } else emptyList()

                            val stmt = if (canViewTreasury && !loc.accountId.isNullOrBlank()) {
                                runCatching { vm.cashLocationMovements(loc.id, all = true) }.getOrNull()
                            } else null

                            val resolved = if (stmt != null) {
                                val parsed = stmt.totalAll.trim().toBigDecimalOrNull()
                                val movCount = stmt.rows.count { !it.isOpening }
                                ResolvedBoxBalance(
                                    primaryBalance = parsed,
                                    currency = stmt.currencyCode.ifBlank { loc.currencyCode ?: "SAR" },
                                    fromLedger = true,
                                    movementsCount = movCount,
                                    subLedgerBalances = subRows,
                                )
                            } else {
                                val targetCur = (loc.currencyCode ?: "SAR").trim().ifBlank { "SAR" }
                                val matchRow = subRows.firstOrNull { it.currencyCode.equals(targetCur, ignoreCase = true) }
                                    ?: subRows.firstOrNull()
                                val hasSyncedRow = matchRow != null && !matchRow.updatedAt.isNullOrBlank() && matchRow.updatedAt != "null"
                                ResolvedBoxBalance(
                                    primaryBalance = if (hasSyncedRow) matchRow?.balance?.trim()?.toBigDecimalOrNull() else null,
                                    currency = matchRow?.currencyCode?.ifBlank { targetCur } ?: targetCur,
                                    fromLedger = false,
                                    movementsCount = null,
                                    subLedgerBalances = subRows,
                                )
                            }
                            resolvedBalances[loc.id] = resolved
                        }
                    }.awaitAll()
                }

                if (canViewTreasury) {
                    runCatching { transfers = vm.cashTransfers() }
                }
            } catch (e: Exception) {
                loadError = vm.friendlyError(e)
            } finally {
                loading = false
            }
        }
    }

    LaunchedEffect(Unit) { reloadAll() }

    val selectedStatementBox = locations.firstOrNull { it.id == selectedStatementBoxId }
    val editingBox = locations.firstOrNull { it.id == editingBoxId }

    val inSubView = selectedStatementBox != null || showCreateBox || editingBox != null || showCreateTransfer
    BackHandler(enabled = inSubView) {
        when {
            selectedStatementBox != null -> selectedStatementBoxId = null
            showCreateBox -> showCreateBox = false
            editingBox != null -> editingBoxId = null
            showCreateTransfer -> {
                showCreateTransfer = false
                preselectedFromBoxId = null
            }
        }
    }

    val topTitle = when {
        selectedStatementBox != null -> "كشف حركة: ${selectedStatementBox.displayName}"
        showCreateBox -> "إضافة صندوق أو حساب بنكي"
        editingBox != null -> "تعديل: ${editingBox.displayName}"
        showCreateTransfer -> "مناقلة بين الصناديق والبنوك"
        else -> "الصناديق والأرصدة"
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(topTitle, fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(
                        onClick = {
                            if (inSubView) {
                                when {
                                    selectedStatementBox != null -> selectedStatementBoxId = null
                                    showCreateBox -> showCreateBox = false
                                    editingBox != null -> editingBoxId = null
                                    showCreateTransfer -> {
                                        showCreateTransfer = false
                                        preselectedFromBoxId = null
                                    }
                                }
                            } else {
                                onBack()
                            }
                        },
                    ) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع")
                    }
                },
                actions = {
                    if (!inSubView) {
                        if (onOpenVouchers != null && canViewTreasury) {
                            TextButton(onClick = onOpenVouchers) {
                                Text("السندات", color = Color.White, fontWeight = FontWeight.Bold)
                            }
                        }
                        IconButton(onClick = { reloadAll() }) {
                            Icon(Icons.Default.Refresh, contentDescription = "تحديث")
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = BakeryColors.Primary,
                    titleContentColor = Color.White,
                    navigationIconContentColor = Color.White,
                    actionIconContentColor = Color.White,
                ),
            )
        },
        floatingActionButton = {
            if (!inSubView) {
                if (activeTab == 0 && canManageLocations) {
                    ExtendedFloatingActionButton(
                        onClick = { showCreateBox = true },
                        icon = { Icon(Icons.Default.Add, contentDescription = null) },
                        text = { Text("صندوق / بنك جديد", fontWeight = FontWeight.Bold) },
                        containerColor = BakeryColors.Primary,
                        contentColor = Color.White,
                    )
                } else if (activeTab == 1 && canManageTransfers) {
                    ExtendedFloatingActionButton(
                        onClick = {
                            preselectedFromBoxId = null
                            showCreateTransfer = true
                        },
                        icon = { Icon(Icons.Default.SwapHoriz, contentDescription = null) },
                        text = { Text("مناقلة جديدة", fontWeight = FontWeight.Bold) },
                        containerColor = BakeryColors.Primary,
                        contentColor = Color.White,
                    )
                }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                selectedStatementBox != null -> {
                    CashBoxStatementSubScreen(
                        vm = vm,
                        box = selectedStatementBox,
                        canManageTransfers = canManageTransfers,
                        onBalanceRecalculated = { reloadAll() },
                    )
                }

                showCreateBox -> {
                    CashBoxCreateOrEditForm(
                        vm = vm,
                        existing = null,
                        branches = state.staff.branches,
                        accounts = state.staff.accounts,
                        onCancel = { showCreateBox = false },
                        onSaved = {
                            showCreateBox = false
                            reloadAll()
                        },
                    )
                }

                editingBox != null -> {
                    CashBoxCreateOrEditForm(
                        vm = vm,
                        existing = editingBox,
                        branches = state.staff.branches,
                        accounts = state.staff.accounts,
                        onCancel = { editingBoxId = null },
                        onSaved = {
                            editingBoxId = null
                            reloadAll()
                        },
                    )
                }

                showCreateTransfer -> {
                    CashTransferCreateForm(
                        vm = vm,
                        locations = locations.filter { it.isActive },
                        branches = state.staff.branches,
                        initialFromId = preselectedFromBoxId,
                        onCancel = {
                            showCreateTransfer = false
                            preselectedFromBoxId = null
                        },
                        onSaved = {
                            showCreateTransfer = false
                            preselectedFromBoxId = null
                            activeTab = 1
                            reloadAll()
                        },
                    )
                }

                else -> {
                    Column(Modifier.fillMaxSize()) {
                        if (canViewTreasury) {
                            SingleChoiceSegmentedButtonRow(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 14.dp, vertical = 10.dp),
                            ) {
                                SegmentedButton(
                                    selected = activeTab == 0,
                                    onClick = { activeTab = 0 },
                                    shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2),
                                    label = { Text("الصناديق والبنوك (${locations.size})") },
                                )
                                SegmentedButton(
                                    selected = activeTab == 1,
                                    onClick = { activeTab = 1 },
                                    shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2),
                                    label = {
                                        val inTransit = transfers.count { it.status == "sent" }
                                        Text(
                                            if (inTransit > 0) "المناقلات ($inTransit في الطريق)"
                                            else "المناقلات (${transfers.size})",
                                        )
                                    },
                                )
                            }
                        }

                        if (activeTab == 0) {
                            CashBoxesMainListTab(
                                loading = loading,
                                loadError = loadError,
                                locations = locations,
                                resolvedBalances = resolvedBalances,
                                branches = state.staff.branches,
                                accounts = state.staff.accounts,
                                kindFilter = kindFilter,
                                onKindFilterChange = { kindFilter = it },
                                query = query,
                                onQueryChange = { query = it },
                                canViewTreasury = canViewTreasury,
                                canManageLocations = canManageLocations,
                                canManageTransfers = canManageTransfers,
                                onRefresh = { reloadAll() },
                                onOpenStatement = { box -> selectedStatementBoxId = box.id },
                                onTransferFrom = { box ->
                                    preselectedFromBoxId = box.id
                                    showCreateTransfer = true
                                },
                                onEdit = { box -> editingBoxId = box.id },
                            )
                        } else {
                            CashTransfersTab(
                                vm = vm,
                                loading = loading,
                                transfers = transfers,
                                locations = locations,
                                canManageTransfers = canManageTransfers,
                                onRefresh = { reloadAll() },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CashBoxesMainListTab(
    loading: Boolean,
    loadError: String?,
    locations: List<CashLocationDto>,
    resolvedBalances: Map<String, ResolvedBoxBalance>,
    branches: List<BranchDto>,
    accounts: List<AccountDto>,
    kindFilter: String,
    onKindFilterChange: (String) -> Unit,
    query: String,
    onQueryChange: (String) -> Unit,
    canViewTreasury: Boolean,
    canManageLocations: Boolean,
    canManageTransfers: Boolean,
    onRefresh: () -> Unit,
    onOpenStatement: (CashLocationDto) -> Unit,
    onTransferFrom: (CashLocationDto) -> Unit,
    onEdit: (CashLocationDto) -> Unit,
) {
    val activeSafes = locations.filter { it.isActive && it.kind != "bank" }
    val activeBanks = locations.filter { it.isActive && it.kind == "bank" }

    var safesTotal = BigDecimal.ZERO
    var safesCounted = 0
    for (box in activeSafes) {
        val b = resolvedBalances[box.id]
        if (b?.primaryBalance != null && b.currency.equals("SAR", ignoreCase = true)) {
            safesTotal = safesTotal.add(b.primaryBalance)
            safesCounted++
        }
    }

    var banksTotal = BigDecimal.ZERO
    var banksCounted = 0
    for (box in activeBanks) {
        val b = resolvedBalances[box.id]
        if (b?.primaryBalance != null && b.currency.equals("SAR", ignoreCase = true)) {
            banksTotal = banksTotal.add(b.primaryBalance)
            banksCounted++
        }
    }

    val combinedTotal = safesTotal.add(banksTotal)
    val hasAnyResolved = safesCounted > 0 || banksCounted > 0

    val filtered = remember(locations, kindFilter, query) {
        val q = query.trim().lowercase()
        locations.filter { loc ->
            val kindOk = when (kindFilter) {
                "safe" -> loc.kind != "bank"
                "bank" -> loc.kind == "bank"
                else -> true
            }
            val textOk = q.isEmpty() ||
                loc.displayName.lowercase().contains(q) ||
                loc.name.lowercase().contains(q) ||
                (loc.bank?.bankName?.lowercase()?.contains(q) == true) ||
                (loc.bank?.iban?.lowercase()?.contains(q) == true)
            kindOk && textOk
        }
    }

    PullRefreshBox(refreshing = loading, onRefresh = onRefresh) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 4.dp, bottom = 92.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // بطاقةُ ملخّص السيولة الكلّيّة (الصناديق + البنوك)
            item {
                Surface(
                    shape = RoundedCornerShape(20.dp),
                    color = Color.Transparent,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(
                            Brush.linearGradient(
                                listOf(BakeryColors.Primary, BakeryColors.PrimaryDark),
                            ),
                            RoundedCornerShape(20.dp),
                        ),
                ) {
                    Column(Modifier.padding(18.dp)) {
                        Text(
                            "إجمالي السيولة المتاحة (الصناديق والبنوك)",
                            style = MaterialTheme.typography.labelLarge,
                            color = Color.White.copy(alpha = 0.88f),
                        )
                        Spacer(Modifier.height(6.dp))
                        Text(
                            if (hasAnyResolved) "${Dec.money(combinedTotal.toPlainString())} ر.س" else "—",
                            style = MaterialTheme.typography.headlineMedium,
                            fontWeight = FontWeight.ExtraBold,
                            color = Color.White,
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "${activeSafes.size} صندوق نقديّ نشط · ${activeBanks.size} حساب بنكيّ نشط",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color(0xFFFEF3C7),
                        )
                    }
                }
            }

            // بلاطتا رصيد الصناديق ورصيد الحسابات البنكيّة
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatTile(
                        label = "الصناديق النقدية",
                        value = if (safesCounted > 0) "${Dec.money(safesTotal.toPlainString())} ر.س" else "—",
                        sub = "${activeSafes.size} صندوق نقديّ",
                        icon = Icons.Default.AccountBalanceWallet,
                        tone = ChipTone.OK,
                        modifier = Modifier.weight(1f),
                    )
                    StatTile(
                        label = "الحسابات البنكية",
                        value = if (banksCounted > 0) "${Dec.money(banksTotal.toPlainString())} ر.س" else "—",
                        sub = "${activeBanks.size} حساب بنكيّ",
                        icon = Icons.Default.AccountBalance,
                        tone = ChipTone.INFO,
                        modifier = Modifier.weight(1f),
                    )
                }
            }

            // شريطُ التصفية والبحث
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        FilterChip(
                            selected = kindFilter == "all",
                            onClick = { onKindFilterChange("all") },
                            label = { Text("الكلّ (${locations.size})") },
                        )
                        FilterChip(
                            selected = kindFilter == "safe",
                            onClick = { onKindFilterChange("safe") },
                            label = { Text("الصناديق النقدية (${locations.count { it.kind != "bank" }})") },
                        )
                        FilterChip(
                            selected = kindFilter == "bank",
                            onClick = { onKindFilterChange("bank") },
                            label = { Text("الحسابات البنكية (${locations.count { it.kind == "bank" }})") },
                        )
                    }
                    SearchField(
                        value = query,
                        onValueChange = onQueryChange,
                        placeholder = "ابحث باسم الصندوق أو البنك أو الآيبان…",
                    )
                }
            }

            if (loadError != null) {
                item {
                    InfoCallout(
                        text = loadError,
                        tone = ChipTone.DANGER,
                    )
                }
            }

            if (loading && locations.isEmpty()) {
                item { CenterLoading() }
            } else if (filtered.isEmpty()) {
                item {
                    EmptyState(
                        if (locations.isEmpty()) {
                            "لا توجد صناديق أو حسابات بنكيّة معرّفة بعد — اضغط «صندوق / بنك جديد» لإضافة الصندوق الرئيسيّ أو الحساب البنكيّ."
                        } else {
                            "لا نتائج تطابق البحث الحاليّ."
                        },
                    )
                }
            } else {
                items(filtered, key = { it.id }) { box ->
                    val bal = resolvedBalances[box.id]
                    val branchName = branches.firstOrNull { it.id == box.branchId }?.nameAr
                    val linkedAccount = accounts.firstOrNull { it.id == box.accountId }
                    CashBoxCard(
                        box = box,
                        balance = bal,
                        branchName = branchName,
                        linkedAccount = linkedAccount,
                        canViewTreasury = canViewTreasury,
                        canManageLocations = canManageLocations,
                        canManageTransfers = canManageTransfers,
                        onOpenStatement = { onOpenStatement(box) },
                        onTransferFrom = { onTransferFrom(box) },
                        onEdit = { onEdit(box) },
                    )
                }
            }
        }
    }
}

@Composable
private fun CashBoxCard(
    box: CashLocationDto,
    balance: ResolvedBoxBalance?,
    branchName: String?,
    linkedAccount: AccountDto?,
    canViewTreasury: Boolean,
    canManageLocations: Boolean,
    canManageTransfers: Boolean,
    onOpenStatement: () -> Unit,
    onTransferFrom: () -> Unit,
    onEdit: () -> Unit,
) {
    val isBank = box.kind == "bank"
    val curLabel = when (val c = (balance?.currency ?: box.currencyCode ?: "SAR").uppercase()) {
        "SAR" -> "ر.س"
        else -> c
    }
    val primaryAmt = balance?.primaryBalance
    val isNegative = primaryAmt != null && primaryAmt < BigDecimal.ZERO

    Surface(
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(
            width = if (box.isDefault) 1.5.dp else 1.dp,
            color = if (box.isDefault) BakeryColors.Primary.copy(alpha = 0.45f) else BakeryColors.Hairline,
        ),
        shadowElevation = 2.dp,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = canViewTreasury && !box.accountId.isNullOrBlank()) { onOpenStatement() },
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top,
            ) {
                Row(
                    modifier = Modifier.weight(1f),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Surface(
                        shape = CircleShape,
                        color = if (isBank) Color(0xFFDBEAFE) else MaterialTheme.colorScheme.primaryContainer,
                        modifier = Modifier.size(44.dp),
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                imageVector = if (isBank) Icons.Default.AccountBalance else Icons.Default.AccountBalanceWallet,
                                contentDescription = null,
                                tint = if (isBank) Color(0xFF1D4ED8) else BakeryColors.Primary,
                                modifier = Modifier.size(24.dp),
                            )
                        }
                    }
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text(
                            box.displayName,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.ExtraBold,
                        )
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            modifier = Modifier.padding(top = 4.dp),
                        ) {
                            StatusChip(
                                if (isBank) "حساب بنكي" else "صندوق نقدي",
                                if (isBank) ChipTone.INFO else ChipTone.OK,
                            )
                            if (box.isDefault) {
                                StatusChip("الرئيسي (افتراضي)", ChipTone.OK)
                            }
                            if (!box.isActive) {
                                StatusChip("موقوف", ChipTone.DANGER)
                            }
                            if (box.changeInPos) {
                                StatusChip("فكّة الكاشير", ChipTone.NEUTRAL)
                            }
                        }
                    }
                }

                // شارةُ الرصيد البارزة
                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        "الرصيد الحالي",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        text = if (primaryAmt != null) {
                            "${Dec.money(primaryAmt.toPlainString())} $curLabel"
                        } else {
                            "—"
                        },
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.ExtraBold,
                        color = when {
                            primaryAmt == null -> MaterialTheme.colorScheme.onSurfaceVariant
                            isNegative -> BakeryColors.Danger
                            else -> BakeryColors.Ok
                        },
                    )
                    if (balance?.movementsCount != null) {
                        Text(
                            "${balance.movementsCount} حركة مرحّلة",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            if (box.accountId.isNullOrBlank()) {
                StatusChip(
                    "غير مربوط بحسابٍ في دليل الحسابات — اربطه من «تعديل» ليُقرأ رصيدُه وحركتُه من القيود",
                    ChipTone.WARN,
                )
            }

            HorizontalDivider(color = BakeryColors.Hairline)

            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (!branchName.isNullOrBlank()) {
                    KeyValue("الفرع", branchName)
                }
                if (linkedAccount != null) {
                    KeyValue("حساب الدليل", "${linkedAccount.code} — ${linkedAccount.label}")
                }
                if (isBank && box.bank != null) {
                    if (!box.bank.bankName.isNullOrBlank()) {
                        KeyValue("اسم البنك", box.bank.bankName)
                    }
                    if (!box.bank.iban.isNullOrBlank()) {
                        KeyValue("الآيبان (IBAN)", box.bank.iban)
                    }
                    if (!box.bank.accountNo.isNullOrBlank()) {
                        KeyValue("رقم الحساب", box.bank.accountNo)
                    }
                }
                // أرصدةُ عملاتٍ إضافيّة إن وُجدت في الدفتر المساعد
                val extraCurrencies = balance?.subLedgerBalances
                    ?.filter {
                        !it.currencyCode.equals(balance.currency, ignoreCase = true) &&
                            !it.updatedAt.isNullOrBlank()
                    }
                    .orEmpty()
                extraCurrencies.forEach { extra ->
                    KeyValue("رصيد (${extra.currencyCode})", "${Dec.money(extra.balance)} ${extra.currencyCode}")
                }
                if (!box.notes.isNullOrBlank()) {
                    KeyValue("ملاحظات", box.notes)
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (canViewTreasury && !box.accountId.isNullOrBlank()) {
                    OutlinedButton(
                        onClick = onOpenStatement,
                        modifier = Modifier.weight(1f),
                    ) {
                        Icon(Icons.Default.ReceiptLong, contentDescription = null, modifier = Modifier.size(17.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("كشف الحركة")
                    }
                }
                if (canManageTransfers && box.isActive) {
                    OutlinedButton(
                        onClick = onTransferFrom,
                        modifier = Modifier.weight(1f),
                    ) {
                        Icon(Icons.Default.SwapHoriz, contentDescription = null, modifier = Modifier.size(17.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("تحويل")
                    }
                }
                if (canManageLocations) {
                    OutlinedButton(onClick = onEdit) {
                        Icon(Icons.Default.Edit, contentDescription = null, modifier = Modifier.size(17.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("تعديل")
                    }
                }
            }
        }
    }
}

/**
 * شاشةٌ فرعيّة: كشفُ حركة الصندوق / البنك من دفتر الأستاذ (`GET /cash-locations/{id}/movements`).
 */
@Composable
private fun CashBoxStatementSubScreen(
    vm: AppViewModel,
    box: CashLocationDto,
    canManageTransfers: Boolean,
    onBalanceRecalculated: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var allPeriod by rememberSaveable { mutableStateOf(true) }
    var fromDate by rememberSaveable { mutableStateOf(LocalDate.now().withDayOfMonth(1).toString()) }
    var toDate by rememberSaveable { mutableStateOf(LocalDate.now().toString()) }
    var loading by remember { mutableStateOf(true) }
    var recalcBusy by remember { mutableStateOf(false) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var statement by remember { mutableStateOf<CashMovementStatementDto?>(null) }

    fun loadStatement() {
        scope.launch {
            loading = true
            errorMsg = null
            try {
                statement = vm.cashLocationMovements(
                    id = box.id,
                    all = allPeriod,
                    from = fromDate,
                    to = toDate,
                )
            } catch (e: Exception) {
                errorMsg = vm.friendlyError(e)
            } finally {
                loading = false
            }
        }
    }

    LaunchedEffect(box.id, allPeriod, fromDate, toDate) {
        loadStatement()
    }

    val rows = statement?.rows.orEmpty()
    val nonOpening = rows.filter { !it.isOpening }
    val totalIncome = remember(nonOpening) {
        nonOpening.fold(BigDecimal.ZERO) { acc, r -> acc.add(r.income.trim().toBigDecimalOrNull() ?: BigDecimal.ZERO) }
    }
    val totalOutcome = remember(nonOpening) {
        nonOpening.fold(BigDecimal.ZERO) { acc, r -> acc.add(r.outcome.trim().toBigDecimalOrNull() ?: BigDecimal.ZERO) }
    }
    val cur = when (val c = (statement?.currencyCode ?: box.currencyCode ?: "SAR").uppercase()) {
        "SAR" -> "ر.س"
        else -> c
    }

    PullRefreshBox(refreshing = loading, onRefresh = { loadStatement() }) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                SectionCard(
                    title = box.displayName,
                    subtitle = "كشف حساب تفصيلي من دفتر الأستاذ العامّ برصيدٍ متحرّك",
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = allPeriod, onCheckedChange = { allPeriod = it })
                            Text("كلّ الفترة")
                        }
                        if (canManageTransfers) {
                            OutlinedButton(
                                enabled = !recalcBusy,
                                onClick = {
                                    recalcBusy = true
                                    scope.launch {
                                        when (val res = vm.recalcCashLocationBalance(box.id)) {
                                            is ActionResult.Synced -> {
                                                vm.showNoticeOk("تمّت مطابقة الرصيد الفرعي مع دفتر الأستاذ.")
                                                loadStatement()
                                                onBalanceRecalculated()
                                            }
                                            is ActionResult.Refused -> vm.showNoticeDanger(res.messageAr)
                                            is ActionResult.Offline -> vm.showNoticeWarn(res.messageAr)
                                        }
                                        recalcBusy = false
                                    }
                                },
                            ) {
                                Icon(Icons.Default.Sync, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(4.dp))
                                Text(if (recalcBusy) "جارٍ المطابقة…" else "مطابقة الرصيد")
                            }
                        }
                    }

                    if (!allPeriod) {
                        Spacer(Modifier.height(6.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            DatePickerField(
                                label = "من تاريخ",
                                value = fromDate,
                                onValueChange = { fromDate = it },
                                modifier = Modifier.weight(1f),
                            )
                            DatePickerField(
                                label = "إلى تاريخ",
                                value = toDate,
                                onValueChange = { toDate = it },
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }
                }
            }

            if (statement != null) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            StatTile(
                                label = "الرصيد الإجمالي",
                                value = "${Dec.money(statement?.totalAll)} $cur",
                                tone = if ((statement?.totalAll?.toBigDecimalOrNull() ?: BigDecimal.ZERO) < BigDecimal.ZERO) {
                                    ChipTone.DANGER
                                } else {
                                    ChipTone.OK
                                },
                                modifier = Modifier.weight(1f),
                            )
                            StatTile(
                                label = "صافي حركة الفترة",
                                value = "${Dec.money(statement?.totalPeriod)} $cur",
                                tone = ChipTone.INFO,
                                modifier = Modifier.weight(1f),
                            )
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            StatTile(
                                label = "إجمالي الوارد (+)",
                                value = "${Dec.money(totalIncome.toPlainString())} $cur",
                                tone = ChipTone.OK,
                                modifier = Modifier.weight(1f),
                            )
                            StatTile(
                                label = "إجمالي الصادر (-)",
                                value = "${Dec.money(totalOutcome.toPlainString())} $cur",
                                tone = ChipTone.DANGER,
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }
                }
            }

            if (errorMsg != null) {
                item { InfoCallout(text = errorMsg ?: "", tone = ChipTone.DANGER) }
            }

            if (loading && statement == null) {
                item { CenterLoading() }
            } else if (rows.isEmpty()) {
                item { EmptyState("لا حركات مرحّلة على هذا الصندوق/البنك في الفترة المحدّدة.") }
            } else {
                items(rows, key = { "${it.seq}-${it.number}-${it.date}" }) { row ->
                    val inc = row.income.trim().toBigDecimalOrNull() ?: BigDecimal.ZERO
                    val out = row.outcome.trim().toBigDecimalOrNull() ?: BigDecimal.ZERO
                    SectionCard(
                        title = if (row.isOpening) "رصيد سابق" else "${row.processType} — #${row.number}",
                        subtitle = row.date,
                    ) {
                        if (!row.isOpening) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                if (inc > BigDecimal.ZERO) {
                                    StatusChip("وارد: +${Dec.money(row.income)} $cur", ChipTone.OK)
                                }
                                if (out > BigDecimal.ZERO) {
                                    StatusChip("صادر: -${Dec.money(row.outcome)} $cur", ChipTone.DANGER)
                                }
                            }
                            Spacer(Modifier.height(4.dp))
                        }
                        KeyValue("الرصيد بعد الحركة", "${Dec.money(row.balance)} $cur")
                        if (row.note.isNotBlank()) {
                            KeyValue("البيان", row.note)
                        }
                    }
                }
            }
        }
    }
}

/**
 * تبويبُ المناقلات والتحويلات النقديّة والبنكيّة (`/cash-transfers`).
 */
@Composable
private fun CashTransfersTab(
    vm: AppViewModel,
    loading: Boolean,
    transfers: List<CashTransferDto>,
    locations: List<CashLocationDto>,
    canManageTransfers: Boolean,
    onRefresh: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var actionBusyId by remember { mutableStateOf<String?>(null) }

    fun displayLocName(id: String, rawName: String?): String {
        val found = locations.firstOrNull { it.id == id }
        if (found != null) return found.displayName
        return when (rawName?.trim()?.lowercase()) {
            "main safe" -> "الصندوق الرئيسي"
            "main bank" -> "الحساب البنكي الرئيسي"
            else -> rawName?.ifBlank { "—" } ?: "—"
        }
    }

    PullRefreshBox(refreshing = loading, onRefresh = onRefresh) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 4.dp, bottom = 92.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (loading && transfers.isEmpty()) {
                item { CenterLoading() }
            } else if (transfers.isEmpty()) {
                item {
                    EmptyState("لا توجد مناقلات بين الصناديق والبنوك بعد — اضغط «مناقلة جديدة» لتحويل مبلغ بين الصندوق والبنك.")
                }
            } else {
                items(transfers, key = { it.id }) { tr ->
                    val statusInfo = when (tr.status) {
                        "draft" -> "مسودّة (بانتظار الإرسال)" to ChipTone.WARN
                        "sent" -> "مُرسَلة (في الطريق للاستلام)" to ChipTone.INFO
                        "received" -> "مُستلَمة ومقيّدة" to ChipTone.OK
                        "voided", "cancelled" -> "مُلغاة" to ChipTone.DANGER
                        else -> tr.status to ChipTone.NEUTRAL
                    }
                    SectionCard(
                        title = "مناقلة ${tr.number?.let { "#$it" } ?: ""}".trim(),
                        subtitle = tr.createdAt?.replace('T', ' ')?.take(16),
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            StatusChip(statusInfo.first, statusInfo.second)
                            Text(
                                "${Dec.money(tr.amount)} ${if (tr.currency.equals("SAR", true)) "ر.س" else tr.currency}",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.ExtraBold,
                                color = BakeryColors.Primary,
                            )
                        }
                        Spacer(Modifier.height(6.dp))
                        KeyValue("من صندوق / بنك", displayLocName(tr.fromCashLocationId, tr.fromName))
                        KeyValue("إلى صندوق / بنك", displayLocName(tr.toCashLocationId, tr.toName))

                        if (canManageTransfers && (tr.status == "draft" || tr.status == "sent")) {
                            Spacer(Modifier.height(8.dp))
                            val isBusy = actionBusyId == tr.id
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                if (tr.status == "draft") {
                                    Button(
                                        enabled = !isBusy,
                                        onClick = {
                                            actionBusyId = tr.id
                                            scope.launch {
                                                when (val res = vm.sendCashTransfer(tr.id)) {
                                                    is ActionResult.Synced -> {
                                                        vm.showNoticeOk("تم اعتماد إرسال المبلغ من الصندوق المصدر.")
                                                        onRefresh()
                                                    }
                                                    is ActionResult.Refused -> vm.showNoticeDanger(res.messageAr)
                                                    is ActionResult.Offline -> vm.showNoticeWarn(res.messageAr)
                                                }
                                                actionBusyId = null
                                            }
                                        },
                                        modifier = Modifier.weight(1f),
                                    ) {
                                        Text("اعتماد الإرسال")
                                    }
                                }
                                if (tr.status == "sent") {
                                    Button(
                                        enabled = !isBusy,
                                        onClick = {
                                            actionBusyId = tr.id
                                            scope.launch {
                                                when (val res = vm.receiveCashTransfer(tr.id)) {
                                                    is ActionResult.Synced -> {
                                                        vm.showNoticeOk("تم تأكيد استلام المبلغ في الصندوق المستلم.")
                                                        onRefresh()
                                                    }
                                                    is ActionResult.Refused -> vm.showNoticeDanger(res.messageAr)
                                                    is ActionResult.Offline -> vm.showNoticeWarn(res.messageAr)
                                                }
                                                actionBusyId = null
                                            }
                                        },
                                        modifier = Modifier.weight(1f),
                                    ) {
                                        Text("تأكيد الاستلام")
                                    }
                                }
                                OutlinedButton(
                                    enabled = !isBusy,
                                    onClick = {
                                        actionBusyId = tr.id
                                        scope.launch {
                                            when (val res = vm.cancelCashTransfer(tr.id)) {
                                                is ActionResult.Synced -> {
                                                    vm.showNoticeOk("أُلغيت المناقلة.")
                                                    onRefresh()
                                                }
                                                is ActionResult.Refused -> vm.showNoticeDanger(res.messageAr)
                                                is ActionResult.Offline -> vm.showNoticeWarn(res.messageAr)
                                            }
                                            actionBusyId = null
                                        }
                                    },
                                ) {
                                    Text("إلغاء", color = MaterialTheme.colorScheme.error)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * نموذجُ إنشاء أو تعديل صندوق نقديّ أو حساب بنكيّ (`POST /cash-locations` · `PATCH /cash-locations/{id}`).
 */
@Composable
private fun CashBoxCreateOrEditForm(
    vm: AppViewModel,
    existing: CashLocationDto?,
    branches: List<BranchDto>,
    accounts: List<AccountDto>,
    onCancel: () -> Unit,
    onSaved: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val isEdit = existing != null
    val defaultBranch = branches.firstOrNull { it.isDefault } ?: branches.firstOrNull()

    var fullDetail by remember { mutableStateOf(existing) }
    var name by rememberSaveable(existing?.id) { mutableStateOf(existing?.displayName ?: "") }
    var kind by rememberSaveable(existing?.id) { mutableStateOf(existing?.kind ?: "safe") }
    var branchId by rememberSaveable(existing?.id) {
        mutableStateOf(existing?.branchId ?: defaultBranch?.id ?: "")
    }
    var accountId by rememberSaveable(existing?.id) { mutableStateOf(existing?.accountId ?: "") }
    var currencyCode by rememberSaveable(existing?.id) {
        mutableStateOf(existing?.currencyCode ?: "SAR")
    }
    var bankName by rememberSaveable(existing?.id) { mutableStateOf(existing?.bank?.bankName ?: "") }
    var iban by rememberSaveable(existing?.id) { mutableStateOf(existing?.bank?.iban ?: "") }
    var accountNo by rememberSaveable(existing?.id) { mutableStateOf(existing?.bank?.accountNo ?: "") }
    var notes by rememberSaveable(existing?.id) { mutableStateOf(existing?.notes ?: "") }
    var isDefault by rememberSaveable(existing?.id) { mutableStateOf(existing?.isDefault ?: false) }
    var isActive by rememberSaveable(existing?.id) { mutableStateOf(existing?.isActive ?: true) }
    var changeInPos by rememberSaveable(existing?.id) { mutableStateOf(existing?.changeInPos ?: false) }

    var pickBranch by remember { mutableStateOf(false) }
    var pickAccount by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }

    // عند التعديل لحساب بنكيّ، اجلب السجلّ الكامل لقراءة الآيبان غير المقنّع ورقم النسخة version
    LaunchedEffect(existing?.id) {
        val id = existing?.id ?: return@LaunchedEffect
        runCatching {
            val detail = vm.cashLocationDetail(id)
            fullDetail = detail
            detail.bank?.let { b ->
                if (!b.bankName.isNullOrBlank()) bankName = b.bankName
                if (!b.iban.isNullOrBlank() && !b.iban.contains('*')) iban = b.iban
                if (!b.accountNo.isNullOrBlank()) accountNo = b.accountNo
            }
        }
    }

    val postableAccounts = remember(accounts) { accounts.filter { it.postable } }
    val selectedBranchName = branches.firstOrNull { it.id == branchId }?.nameAr ?: ""
    val selectedAccountLabel = accounts.firstOrNull { it.id == accountId }?.let { "${it.code} — ${it.label}" } ?: ""

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SectionCard(
            title = if (isEdit) "بيانات ${existing?.displayName}" else "تعريف صندوق نقدي أو حساب بنكي",
            subtitle = "اربط الصندوق أو البنك بحسابه في دليل الحسابات ليُقرأ رصيدُه تلقائيًّا من القيود المرحّلة",
        ) {
            if (!isEdit) {
                SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                    SegmentedButton(
                        selected = kind == "safe",
                        onClick = { kind = "safe" },
                        shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2),
                        label = { Text("صندوق نقدي") },
                    )
                    SegmentedButton(
                        selected = kind == "bank",
                        onClick = { kind = "bank" },
                        shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2),
                        label = { Text("حساب بنكي") },
                    )
                }
                Spacer(Modifier.height(10.dp))
            }

            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = {
                    Text(
                        if (kind == "bank") "اسم الحساب البنكي * (مثال: الحساب البنكي الرئيسي)"
                        else "اسم الصندوق * (مثال: الصندوق الرئيسي)",
                    )
                },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))

            OutlinedTextField(
                value = selectedBranchName,
                onValueChange = {},
                readOnly = true,
                interactionSource = rememberPickerInteractionSource { pickBranch = true },
                label = { Text("الفرع *") },
                trailingIcon = { PickerTrigger(onClick = { pickBranch = true }) },
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))

            OutlinedTextField(
                value = selectedAccountLabel.ifBlank { "اختر الحساب في دليل الحسابات (مستحسن)" },
                onValueChange = {},
                readOnly = true,
                interactionSource = rememberPickerInteractionSource { pickAccount = true },
                label = { Text("الحساب في دليل الحسابات") },
                trailingIcon = { PickerTrigger(onClick = { pickAccount = true }) },
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))

            OutlinedTextField(
                value = currencyCode,
                onValueChange = { currencyCode = it.uppercase().take(3) },
                label = { Text("العملة (مثال: SAR)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )

            if (kind == "bank") {
                Spacer(Modifier.height(10.dp))
                HorizontalDivider(color = BakeryColors.Hairline)
                Spacer(Modifier.height(10.dp))
                Text(
                    "تفاصيل البنك",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(6.dp))
                OutlinedTextField(
                    value = bankName,
                    onValueChange = { bankName = it },
                    label = { Text("اسم البنك * (مثال: مصرف الراجحي / البنك الأهلي)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = accountNo,
                    onValueChange = { accountNo = it },
                    label = { Text("رقم الحساب البنكي (اختياري)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = iban,
                    onValueChange = { iban = it.uppercase().replace(" ", "") },
                    label = { Text("رقم الآيبان IBAN (اختياري — صيغة قياسية ISO 13616)") },
                    textStyle = MaterialTheme.typography.bodyMedium.copy(textDirection = TextDirection.Ltr),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = notes,
                onValueChange = { notes = it },
                label = { Text("ملاحظات (اختياري)") },
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = isDefault, onCheckedChange = { isDefault = it })
                Text(if (kind == "bank") "تعيين كحساب بنكي رئيسيّ (افتراضي)" else "تعيين كصندوق رئيسيّ (افتراضي)")
            }
            if (kind != "bank") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = changeInPos, onCheckedChange = { changeInPos = it })
                    Text("يُستخدم كصندوق فكّة في نقطة البيع")
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = isActive, onCheckedChange = { isActive = it })
                Text("نشط ومتاح للعمليات")
            }

            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ActionButton(
                    label = if (saving) "جارٍ الحفظ…" else if (isEdit) "حفظ التعديلات" else "إضافة",
                    loading = saving,
                    enabled = !saving,
                    modifier = Modifier.weight(1.2f),
                    onClick = {
                        if (name.trim().isBlank()) {
                            vm.showNoticeDanger("يرجى إدخال الاسم.")
                            return@ActionButton
                        }
                        if (branchId.isBlank()) {
                            vm.showNoticeDanger("يرجى اختيار الفرع.")
                            return@ActionButton
                        }
                        if (kind == "bank" && bankName.trim().isBlank()) {
                            vm.showNoticeDanger("اسم البنك إلزاميّ عند تعريف حساب بنكيّ.")
                            return@ActionButton
                        }
                        saving = true
                        scope.launch {
                            val payload = buildJsonObject {
                                put("branchId", branchId)
                                if (!isEdit) put("kind", kind)
                                put("name", name.trim())
                                if (accountId.isNotBlank()) put("accountId", accountId)
                                else if (isEdit) put("accountId", JsonNull)
                                val cleanCur = currencyCode.trim().uppercase()
                                if (cleanCur.isNotBlank()) put("currencyCode", cleanCur)
                                if (kind == "bank") {
                                    putJsonObject("bank") {
                                        put("bankName", bankName.trim())
                                        val cleanIban = iban.trim().uppercase()
                                        if (cleanIban.isNotBlank() && !cleanIban.contains('*')) {
                                            put("iban", cleanIban)
                                        }
                                        if (accountNo.trim().isNotBlank()) {
                                            put("accountNo", accountNo.trim())
                                        }
                                    }
                                }
                                put("isDefault", isDefault)
                                put("changeInPos", if (kind == "bank") false else changeInPos)
                                put("isActive", isActive)
                                if (notes.trim().isNotBlank()) put("notes", notes.trim())
                                else if (isEdit) put("notes", JsonNull)
                                if (isEdit) {
                                    fullDetail?.version?.let { put("version", it) }
                                }
                            }

                            val res = if (isEdit && existing != null) {
                                vm.updateCashLocationSuspend(existing.id, payload)
                            } else {
                                vm.createCashLocationSuspend(payload)
                            }
                            saving = false
                            when (res) {
                                is ActionResult.Synced -> {
                                    vm.showNoticeOk(if (isEdit) "تم تحديث البيانات بنجاح." else "تمت الإضافة بنجاح.")
                                    onSaved()
                                }
                                is ActionResult.Refused -> vm.showNoticeDanger(res.messageAr)
                                is ActionResult.Offline -> vm.showNoticeWarn(res.messageAr)
                            }
                        }
                    },
                )
                OutlinedButton(
                    onClick = onCancel,
                    enabled = !saving,
                    modifier = Modifier.weight(0.8f).height(48.dp),
                ) {
                    Text("إلغاء")
                }
            }

            if (isEdit && existing != null && !existing.isDefault) {
                Spacer(Modifier.height(10.dp))
                OutlinedButton(
                    onClick = { confirmDelete = true },
                    enabled = !saving,
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.Default.DeleteOutline, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("حذف هذا ${if (kind == "bank") "الحساب البنكي" else "الصندوق"}")
                }
            }
        }
    }

    if (pickBranch) {
        PickerDialog(
            title = "اختر الفرع",
            items = branches.map { PickerItem(it.id, it.nameAr, it.code) },
            onDismiss = { pickBranch = false },
            onSelect = {
                branchId = it.id
                pickBranch = false
            },
        )
    }

    if (pickAccount) {
        PickerDialog(
            title = "اختر الحساب في دليل الحسابات",
            items = postableAccounts.map { PickerItem(it.id, "${it.code} — ${it.label}", it.type ?: it.accountType) },
            onDismiss = { pickAccount = false },
            onSelect = {
                accountId = it.id
                pickAccount = false
            },
        )
    }

    if (confirmDelete && existing != null) {
        ConfirmDialog(
            title = "تأكيد الحذف",
            message = "هل تريد حذف «${existing.displayName}»؟ لا يمكن حذف الصندوق الافتراضيّ أو المربوط بحركاتٍ تمنع الحذف.",
            confirmLabel = "حذف",
            onDismiss = { confirmDelete = false },
            onConfirm = {
                confirmDelete = false
                saving = true
                scope.launch {
                    when (val res = vm.deleteCashLocationSuspend(existing.id)) {
                        is ActionResult.Synced -> {
                            vm.showNoticeOk("تم الحذف بنجاح.")
                            onSaved()
                        }
                        is ActionResult.Refused -> vm.showNoticeDanger(res.messageAr)
                        is ActionResult.Offline -> vm.showNoticeWarn(res.messageAr)
                    }
                    saving = false
                }
            },
        )
    }
}

/**
 * نموذجُ إنشاء مناقلة نقديّة/بنكيّة بين صندوقين أو بين الصندوق والبنك (`POST /cash-transfers`).
 */
@Composable
private fun CashTransferCreateForm(
    vm: AppViewModel,
    locations: List<CashLocationDto>,
    branches: List<BranchDto>,
    initialFromId: String?,
    onCancel: () -> Unit,
    onSaved: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val defaultBranch = branches.firstOrNull { it.isDefault } ?: branches.firstOrNull()

    var branchId by rememberSaveable { mutableStateOf(defaultBranch?.id ?: "") }
    var fromId by rememberSaveable {
        mutableStateOf(
            initialFromId ?: locations.firstOrNull { it.isDefault && it.kind != "bank" }?.id
                ?: locations.firstOrNull()?.id ?: "",
        )
    }
    var toId by rememberSaveable {
        mutableStateOf(
            locations.firstOrNull { it.id != fromId && it.kind == "bank" }?.id
                ?: locations.firstOrNull { it.id != fromId }?.id ?: "",
        )
    }
    var amount by rememberSaveable { mutableStateOf("") }
    var sendImmediately by rememberSaveable { mutableStateOf(true) }
    var pickFrom by remember { mutableStateOf(false) }
    var pickTo by remember { mutableStateOf(false) }
    var pickBranch by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }

    val fromBox = locations.firstOrNull { it.id == fromId }
    val toBox = locations.firstOrNull { it.id == toId }
    val branchName = branches.firstOrNull { it.id == branchId }?.nameAr ?: ""

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SectionCard(
            title = "تحويل مبلغ بين الصناديق والبنوك",
            subtitle = "مثال: إيداع نقديّة من الصندوق الرئيسيّ إلى الحساب البنكيّ الرئيسيّ أو العكس",
        ) {
            OutlinedTextField(
                value = branchName,
                onValueChange = {},
                readOnly = true,
                interactionSource = rememberPickerInteractionSource { pickBranch = true },
                label = { Text("الفرع *") },
                trailingIcon = { PickerTrigger(onClick = { pickBranch = true }) },
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))

            OutlinedTextField(
                value = fromBox?.let { "${it.displayName} (${if (it.kind == "bank") "بنك" else "صندوق"})" } ?: "",
                onValueChange = {},
                readOnly = true,
                interactionSource = rememberPickerInteractionSource { pickFrom = true },
                label = { Text("من صندوق / بنك (المصدر) *") },
                trailingIcon = { PickerTrigger(onClick = { pickFrom = true }) },
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))

            OutlinedTextField(
                value = toBox?.let { "${it.displayName} (${if (it.kind == "bank") "بنك" else "صندوق"})" } ?: "",
                onValueChange = {},
                readOnly = true,
                interactionSource = rememberPickerInteractionSource { pickTo = true },
                label = { Text("إلى صندوق / بنك (المستلم) *") },
                trailingIcon = { PickerTrigger(onClick = { pickTo = true }) },
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))

            OutlinedTextField(
                value = amount,
                onValueChange = { amount = it.filter { ch -> ch.isDigit() || ch == '.' } },
                label = { Text("المبلغ المحوّل *") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = sendImmediately, onCheckedChange = { sendImmediately = it })
                Text("اعتماد إرسال المبلغ فور الحفظ")
            }

            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ActionButton(
                    label = if (saving) "جارٍ التنفيذ…" else "حفظ المناقلة",
                    loading = saving,
                    enabled = !saving,
                    modifier = Modifier.weight(1.2f),
                    onClick = {
                        val parsed = amount.trim().toBigDecimalOrNull()
                        when {
                            branchId.isBlank() -> {
                                vm.showNoticeDanger("اختر الفرع.")
                                return@ActionButton
                            }
                            fromId.isBlank() || toId.isBlank() -> {
                                vm.showNoticeDanger("اختر الصندوق/البنك المصدر والمستلم.")
                                return@ActionButton
                            }
                            fromId == toId -> {
                                vm.showNoticeDanger("يجب أن يختلف المصدر عن المستلم.")
                                return@ActionButton
                            }
                            parsed == null || parsed <= BigDecimal.ZERO -> {
                                vm.showNoticeDanger("أدخل مبلغًا صحيحًا أكبر من صفر.")
                                return@ActionButton
                            }
                        }
                        saving = true
                        scope.launch {
                            try {
                                val created = vm.createCashTransfer(
                                    buildJsonObject {
                                        put("branchId", branchId)
                                        put("fromCashLocationId", fromId)
                                        put("toCashLocationId", toId)
                                        put("amount", parsed.toPlainString())
                                    },
                                )
                                if (sendImmediately && created.id.isNotBlank()) {
                                    vm.sendCashTransfer(created.id)
                                    vm.showNoticeOk("تم إنشاء المناقلة واعتماد إرسالها — أكّد استلامها عند وصول المبلغ.")
                                } else {
                                    vm.showNoticeOk("حُفظت المناقلة كمسودّة.")
                                }
                                onSaved()
                            } catch (e: Exception) {
                                vm.showNoticeDanger(vm.friendlyError(e))
                            } finally {
                                saving = false
                            }
                        }
                    },
                )
                OutlinedButton(
                    onClick = onCancel,
                    enabled = !saving,
                    modifier = Modifier.weight(0.8f).height(48.dp),
                ) {
                    Text("إلغاء")
                }
            }
        }
    }

    if (pickBranch) {
        PickerDialog(
            title = "اختر الفرع",
            items = branches.map { PickerItem(it.id, it.nameAr, it.code) },
            onDismiss = { pickBranch = false },
            onSelect = {
                branchId = it.id
                pickBranch = false
            },
        )
    }

    if (pickFrom) {
        PickerDialog(
            title = "اختر الصندوق أو البنك المصدر",
            items = locations.map {
                PickerItem(
                    id = it.id,
                    title = it.displayName,
                    subtitle = if (it.kind == "bank") "حساب بنكي" else "صندوق نقدي",
                )
            },
            onDismiss = { pickFrom = false },
            onSelect = {
                fromId = it.id
                pickFrom = false
            },
        )
    }

    if (pickTo) {
        PickerDialog(
            title = "اختر الصندوق أو البنك المستلم",
            items = locations.filter { it.id != fromId }.map {
                PickerItem(
                    id = it.id,
                    title = it.displayName,
                    subtitle = if (it.kind == "bank") "حساب بنكي" else "صندوق نقدي",
                )
            },
            onDismiss = { pickTo = false },
            onSelect = {
                toId = it.id
                pickTo = false
            },
        )
    }
}
