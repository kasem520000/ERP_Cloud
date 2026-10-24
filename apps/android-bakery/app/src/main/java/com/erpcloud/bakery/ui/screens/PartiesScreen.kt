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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.data.ActionResult
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.ActionButton
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.MissingPermissionHint
import com.erpcloud.bakery.ui.components.ChipTone
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
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * شاشةُ الأطراف — العملاءُ والمورّدون (من وحدة الأطراف عند الخادم):
 * القائمةُ بمرشّحِ النوع، وبطاقةُ كلِّ طرفٍ يُرى منها **رصيدُه وقيودُه المفتوحة**
 * (`GET /parties/{id}/balance` — عند الطلب لا مسبقًا)، مع إنشاءِ طرفٍ جديد
 * (`POST /parties` بإذن `parties.manage`).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PartiesScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var kind by remember { mutableIntStateOf(0) } // 0 = عملاء، 1 = موردون
    var showCreate by remember { mutableStateOf(false) }
    var balanceTarget by remember { mutableStateOf<String?>(null) }
    var editTarget by remember { mutableStateOf<String?>(null) }
    var query by remember { mutableStateOf("") }

    val currentKind = if (kind == 0) "customer" else "supplier"
    LaunchedEffect(kind) { vm.loadParties(currentKind) }

    Scaffold(
        topBar = {
            TopAppBar(
                // شريطٌ فاتحٌ يمتزجُ بخلفيّةِ الشاشة (كما في الموك-أب) وعنوانٌ عريضٌ جدًّا.
                title = { Text("العملاء والموردون", fontWeight = FontWeight.ExtraBold) },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
        floatingActionButton = {
            if (!showCreate && editTarget == null && state.can("parties.manage")) {
                // FAB كهرمانيٌّ أساسيٌّ بأيقونةٍ بيضاء، أسفلُ اليسار في RTL.
                FloatingActionButton(
                    onClick = { showCreate = true },
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = Color.White,
                    shape = RoundedCornerShape(18.dp),
                ) {
                    Icon(Icons.Default.Add, contentDescription = "طرف جديد")
                }
            }
        },
    ) { padding ->
        // لا يُخفى الزرُّ بصمتًا: إن غاب الإذنُ يُشرَح السببُ بالعربية
        if (!state.can("parties.manage")) {
            MissingPermissionHint("إضافة طرف", "parties.manage", Modifier.padding(padding))
        }
        if (showCreate) {
            PartyForm(vm, kind = currentKind, onDone = { showCreate = false })
            return@Scaffold
        }
        val editing = editTarget?.let { id -> state.staff.parties.firstOrNull { it.id == id } }
        if (editing != null) {
            PartyEditDialog(vm, party = editing, currentKind = currentKind, onDismiss = { editTarget = null })
        }
        Column(Modifier.fillMaxSize().padding(padding)) {
            SecondaryTabRow(selectedTabIndex = kind) {
                Tab(selected = kind == 0, onClick = { if (kind != 0) { kind = 0; query = "" } }, text = { Text("العملاء") })
                Tab(selected = kind == 1, onClick = { if (kind != 1) { kind = 1; query = "" } }, text = { Text("الموردون") })
            }
            PullRefreshBox(
                refreshing = state.staff.loadingKey == "parties",
                onRefresh = { vm.loadParties(currentKind) },
            ) {
                Column(Modifier.fillMaxSize()) {
                    SearchField(
                        value = query,
                        onValueChange = { query = it },
                        modifier = Modifier.padding(start = 14.dp, end = 14.dp, top = 6.dp),
                        placeholder = "ابحثُ بالاسم أو الهاتف",
                    )
                    if (state.staff.loadingKey == "parties") {
                        CenterLoading("جارٍ تحميل القائمة…")
                    } else {
                        val parties = if (query.isBlank()) {
                            state.staff.parties
                        } else {
                            val needle = query.trim()
                            state.staff.parties.filter { row ->
                                row.displayName.contains(needle, ignoreCase = true) ||
                                    (row.phone?.contains(needle, ignoreCase = true) ?: false)
                            }
                        }
                        if (parties.isEmpty()) {
                            EmptyState(if (query.isBlank()) state.staff.error ?: "لا أطرافَ بعد." else "لا طرفَ يطابقُ البحث.")
                        } else {
                            LazyColumn(
                                contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 14.dp, end = 14.dp, bottom = 20.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                items(parties, key = { it.id }) { party ->
                                    SectionCard(
                                        title = party.displayName,
                                        subtitle = listOfNotNull(party.phone, party.taxNo?.let { "ض: $it" }).joinToString(" · ").ifBlank { null },
                                    ) {
                                        if ((Dec.parse(party.creditLimit)?.signum() ?: 0) > 0) {
                                            KeyValue("حدُّ الائتمان", Dec.money(party.creditLimit) + " ر.س")
                                        }
                                        Spacer(Modifier.height(8.dp))
                                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                            OutlinedButton(
                                                onClick = { balanceTarget = party.id },
                                                shape = RoundedCornerShape(26.dp),
                                            ) { Text("الرصيدُ والقيودُ المفتوحة") }
                                            if (state.can("parties.manage")) {
                                                InlineAction(label = "تعديل", onClick = { editTarget = party.id })
                                            }
                                        }
                                        if (!state.can("parties.manage")) {
                                            MissingPermissionHint("تعديل طرف", "parties.manage")
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (balanceTarget != null) {
        val id = balanceTarget ?: ""
        BalanceDialog(vm, partyId = id, onDismiss = { balanceTarget = null })
    }
}

/** حوارُ رصيدِ طرف — يُجلبُ عند الطلب: المدينُ والقيودُ المفتوحة وتخصيصاتُها. */
@Composable
private fun BalanceDialog(vm: AppViewModel, partyId: String, onDismiss: () -> Unit) {
    val state by vm.uiState.collectAsState()
    LaunchedEffect(partyId) { vm.loadPartyBalance(partyId) }

    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("رصيدُ الطرف") },
        text = {
            Column {
                if (state.staff.loadingKey == "party-balance") {
                    CenterLoading("جارٍ حساب الرصيد…")
                } else {
                    val balance = state.staff.partyBalance
                    if (balance == null) {
                        Text(state.staff.error ?: "تعذّر جلبُ الرصيد.")
                    } else {
                        val receivable = Dec.orZero(balance.receivable)
                        StatusChip(
                            if (receivable.signum() > 0) "له (مدين): ${Dec.money(balance.receivable)} ر.س" else "لا رصيدَ قائمًا",
                            if (receivable.signum() > 0) ChipTone.WARN else ChipTone.OK,
                        )
                        Spacer(Modifier.height(8.dp))
                        if (balance.open.isEmpty()) {
                            Text("لا قيودَ مفتوحة.", style = MaterialTheme.typography.bodySmall)
                        } else {
                            balance.open.take(12).forEach { row ->
                                KeyValue(
                                    Labels.dateOrDash(row.date),
                                    "مدين ${Dec.money(row.debit)} · مخصَّص ${Dec.money(row.allocated)}",
                                )
                            }
                            if (balance.open.size > 12) {
                                Text("… (+${balance.open.size - 12} قيدًا)", style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            androidx.compose.material3.TextButton(onClick = onDismiss) { Text("إغلاق") }
        },
    )
}

/** إنشاءُ طرف — عميلٌ أو مورد (kind حسب التبويب المفتوح). */
@Composable
private fun PartyForm(vm: AppViewModel, kind: String, onDone: () -> Unit) {
    var name by remember { mutableStateOf("") }
    var taxNo by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var creditLimit by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    SectionCard(
        title = if (kind == "supplier") "مورّدٌ جديد" else "عميلٌ جديد",
        subtitle = "طرفٌ من دليل الأطراف — يدخل الفواتير والسندات",
        modifier = Modifier.padding(14.dp),
    ) {
        OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("الاسم *") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = phone, onValueChange = { phone = it }, label = { Text("الهاتف") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = taxNo, onValueChange = { taxNo = it }, label = { Text("الرقمُ الضريبيّ") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = creditLimit,
            onValueChange = { if (Dec.isValidInput(it)) creditLimit = it },
            label = { Text("حدُّ الائتمان (ر.س)") },
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
                label = if (sending) "جارٍ الحفظ…" else "حفظُ الطرف",
                onClick = {
                    error = if (name.isBlank()) "الاسمُ إلزاميّ." else null
                    if (error != null) return@ActionButton
                    sending = true
                    val body = buildJsonObject {
                        put("kind", kind)
                        put("name", name.trim())
                        if (phone.isNotBlank()) put("phone", phone.trim())
                        if (taxNo.isNotBlank()) put("taxNo", taxNo.trim())
                        if (creditLimit.isNotBlank()) put("creditLimit", Dec.wire(creditLimit))
                    }
                    vm.createParty(body) { result ->
                        sending = false
                        if (result is ActionResult.Synced) {
                            vm.loadParties(kind)
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


/** تعديلُ طرف (عميل/مورّد) — `PUT /parties/{id}` (Partial) بإذن `parties.manage`:
 * الحقولُ نفسُها التي في نموذجِ الإنشاء — الاسمُ والهاتفُ والرقمُ الضريبيُّ
 * وحدُّ الائتمان؛ يُعادُ تحميلُ القائمةِ بعد الحفظ. */
@Composable
private fun PartyEditDialog(
    vm: AppViewModel,
    party: com.erpcloud.bakery.data.api.PartyDto,
    currentKind: String,
    onDismiss: () -> Unit,
) {
    var name by remember { mutableStateOf(party.name) }
    var phone by remember { mutableStateOf(party.phone ?: "") }
    var taxNo by remember { mutableStateOf(party.taxNo ?: "") }
    var creditLimit by remember { mutableStateOf(party.creditLimit ?: "") }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    androidx.compose.material3.AlertDialog(
        onDismissRequest = { if (!sending) onDismiss() },
        title = { Text("تعديلُ الطرف") },
        text = {
            Column {
                Text(party.displayName, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("الاسم *") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = phone, onValueChange = { phone = it }, label = { Text("الهاتف") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = taxNo, onValueChange = { taxNo = it }, label = { Text("الرقمُ الضريبيّ") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = creditLimit,
                    onValueChange = { if (Dec.isValidInput(it)) creditLimit = it },
                    label = { Text("حدُّ الائتمان (ر.س)") },
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (error != null) {
                    Spacer(Modifier.height(8.dp))
                    StatusChip(error ?: "", ChipTone.DANGER)
                }
            }
        },
        confirmButton = {
            androidx.compose.material3.TextButton(
                onClick = {
                    error = when {
                        name.isBlank() -> "الاسمُ إلزاميّ."
                        (Dec.parse(creditLimit)?.signum() ?: 0) < 0 -> "حدُّ الائتمان موجبٌ فقط."
                        else -> null
                    }
                    if (error != null) return@TextButton
                    sending = true
                    val body = buildJsonObject {
                        put("kind", currentKind)
                        put("name", name.trim())
                        if (phone.isNotBlank()) put("phone", phone.trim())
                        if (taxNo.isNotBlank()) put("taxNo", taxNo.trim())
                        if (creditLimit.isNotBlank()) put("creditLimit", Dec.wire(creditLimit))
                    }
                    vm.updateParty(party.id, body) { result ->
                        sending = false
                        if (result is ActionResult.Synced) {
                            vm.loadParties(currentKind)
                            onDismiss()
                        }
                    }
                },
                enabled = !sending,
            ) { Text(if (sending) "جارٍ الحفظ…" else "حفظ") }
        },
        dismissButton = {
            androidx.compose.material3.TextButton(onClick = onDismiss, enabled = !sending) { Text("إلغاء") }
        },
    )
}
