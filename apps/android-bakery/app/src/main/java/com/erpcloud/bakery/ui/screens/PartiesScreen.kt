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
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.data.ActionResult
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.ActionButton
import com.erpcloud.bakery.ui.components.CenterLoading
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

    LaunchedEffect(kind) { vm.loadParties(if (kind == 0) "customer" else "supplier") }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("العملاء والموردون") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
        floatingActionButton = {
            if (!showCreate && state.can("parties.manage")) {
                FloatingActionButton(onClick = { showCreate = true }) {
                    Icon(Icons.Default.Add, contentDescription = "طرف جديد")
                }
            }
        },
    ) { padding ->
        if (showCreate) {
            PartyForm(vm, kind = if (kind == 0) "customer" else "supplier", onDone = { showCreate = false })
            return@Scaffold
        }
        Column(Modifier.fillMaxSize().padding(padding)) {
            Row(Modifier.padding(horizontal = 14.dp)) {
                OutlinedButton(
                    onClick = { kind = 0 },
                    modifier = Modifier.weight(1f).padding(end = 4.dp),
                ) { Text(if (kind == 0) "● العملاء" else "العملاء") }
                OutlinedButton(
                    onClick = { kind = 1 },
                    modifier = Modifier.weight(1f).padding(start = 4.dp),
                ) { Text(if (kind == 1) "● الموردون" else "الموردون") }
            }
            Spacer(Modifier.height(10.dp))
            if (state.staff.loadingKey == "parties") {
                CenterLoading("جارٍ تحميل القائمة…")
            } else {
                val parties = state.staff.parties
                if (parties.isEmpty()) {
                    EmptyState(state.staff.error ?: "لا أطرافَ بعد.")
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
                                OutlinedButton(onClick = { balanceTarget = party.id }) { Text("الرصيدُ والقيودُ المفتوحة") }
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
