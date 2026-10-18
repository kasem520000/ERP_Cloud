@file:OptIn(ExperimentalMaterial3Api::class)

package com.erpcloud.rep.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.FactCheck
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.erpcloud.rep.data.ActionResult
import com.erpcloud.rep.data.api.ClosingRequest
import com.erpcloud.rep.ui.AppViewModel
import com.erpcloud.rep.ui.components.ActionButton
import com.erpcloud.rep.ui.components.KeyValue
import com.erpcloud.rep.ui.components.PickerDialog
import com.erpcloud.rep.ui.components.PickerItem
import com.erpcloud.rep.ui.components.SectionCard
import com.erpcloud.rep.util.Dec

/**
 * شاشةُ إغلاقِ الوردية — إعلانُ جردٍ يترتّب عليه اعتمادُ المحاسب ومديونيةُ العجز.
 * لا مفتاحَ في المسار ولا حفظَ في الطابور، والمركبةُ تُعدُّ كلُّها أو الأمرُ وحدَه —
 * لا الاثنان معًا (0129).
 */
@Composable
fun ClosingScreen(vm: AppViewModel, onDone: () -> Unit) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val workspace = state.workspace

    var loadOrderId by rememberSaveable { mutableStateOf("") }
    var returnedQty by rememberSaveable { mutableStateOf("") }
    var damagedQty by rememberSaveable { mutableStateOf("") }
    var damageReason by rememberSaveable { mutableStateOf("") }
    var collectedCash by rememberSaveable { mutableStateOf("") }
    var countMode by rememberSaveable { mutableStateOf("vehicle") } // vehicle | per-order
    var vehicleCountQty by rememberSaveable { mutableStateOf("") }
    var actualRemainingQty by rememberSaveable { mutableStateOf("") }
    var closingNotes by rememberSaveable { mutableStateOf("") }

    var showOrderPicker by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var localError by remember { mutableStateOf<String?>(null) }

    // الأوامرُ القابلة للإقفال: المفتوحةُ وما بانتظار الاعتماد (يُعاد إعلانه)، لا المصفّاة.
    val closeable = (workspace?.loadOrders ?: emptyList()).filter {
        it.status in setOf("loaded", "in_route", "pending_closing")
    }
    val order = closeable.firstOrNull { it.id == loadOrderId }

    fun buildRequest(): ClosingRequest? {
        if (loadOrderId.isBlank()) return null
        if (Dec.parse(damagedQty)?.signum() > 0 && damageReason.isBlank()) return null
        return ClosingRequest(
            returnedQty = returnedQty.trim().ifBlank { null },
            damagedQty = damagedQty.trim().ifBlank { null },
            damageReason = damageReason.trim().ifBlank { null },
            collectedCash = collectedCash.trim().ifBlank { null },
            actualRemainingQty = if (countMode == "per-order") actualRemainingQty.trim().ifBlank { null } else null,
            vehicleCountQty = if (countMode == "vehicle") vehicleCountQty.trim().ifBlank { null } else null,
            closingNotes = closingNotes.trim().ifBlank { null },
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("إغلاقُ الوردية") },
                navigationIcon = {
                    IconButton(onClick = onDone) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SectionCard(title = "١) أمرُ التحميل") {
                OutlinedButton(onClick = { showOrderPicker = true }, modifier = Modifier.fillMaxWidth()) {
                    Text(order?.let { "${it.number} — ${it.itemName}" } ?: "اختر أمرَ التحميل")
                }
                if (order != null) {
                    KeyValue("العهدةُ (المستلَم)", "${Dec.kg(order.receivedQty.ifBlank { order.loadedQty })} كجم")
                    KeyValue("المباع + البونص", "${Dec.kg(order.soldQty)} + ${Dec.kg(order.bonusQty)} كجم")
                    KeyValue("المتوقّعُ متبقّيًا", "${Dec.kg(order.expectedRemainingQty)} كجم")
                    KeyValue("النقديُّ المتوقّع", "${Dec.money(order.expectedCash)} ريال")
                    if (order.isPendingClosing) {
                        Text(
                            "هذا الأمرُ بانتظار اعتماد المحاسب — إرسالُ إعلانٍ جديدٍ يعيد كتابةَ الإعلان السابق.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.tertiary,
                        )
                    }
                }
            }

            SectionCard(title = "٢) الكميّات المُرجَعة والتالفة") {
                OutlinedTextField(
                    value = returnedQty,
                    onValueChange = { if (Dec.isValidInput(it)) returnedQty = it },
                    label = { Text("المرتجعُ السليم (كجم)") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = damagedQty,
                    onValueChange = { if (Dec.isValidInput(it)) damagedQty = it },
                    label = { Text("التالف للفحص (كجم)") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (Dec.parse(damagedQty)?.signum() > 0) {
                    OutlinedTextField(
                        value = damageReason,
                        onValueChange = { damageReason = it },
                        label = { Text("سببُ التلف *") },
                        supportingText = { Text("إلزاميّ مع أي كميةٍ تالفة — يُحال للفحص الفعليّ") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            SectionCard(title = "٣) النقد والجرد") {
                OutlinedTextField(
                    value = collectedCash,
                    onValueChange = { if (Dec.isValidInput(it)) collectedCash = it },
                    label = { Text("النقدُ المُسلَّم (ريال)") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = countMode == "vehicle",
                        onClick = { countMode = "vehicle" },
                        label = { Text("عددُ المركبة كلّها") },
                    )
                    FilterChip(
                        selected = countMode == "per-order",
                        onClick = { countMode = "per-order" },
                        label = { Text("عددٌ لهذا الأمر") },
                    )
                }
                if (countMode == "vehicle") {
                    OutlinedTextField(
                        value = vehicleCountQty,
                        onValueChange = { if (Dec.isValidInput(it)) vehicleCountQty = it },
                        label = { Text("ما في المركبةِ كلِّها بالجرد (كجم)") },
                        supportingText = { Text("يشتقّ الخادمُ نصيبَ هذا الأمر بعد طرح عهدة الأوامر الأخرى في السيارة نفسها") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        modifier = Modifier.fillMaxWidth(),
                    )
                } else {
                    OutlinedTextField(
                        value = actualRemainingQty,
                        onValueChange = { if (Dec.isValidInput(it)) actualRemainingQty = it },
                        label = { Text("المتبقّي الفعليّ لهذا الأمر بالجرد (كجم)") },
                        supportingText = { Text("ما لا تُعلنه عجزٌ عليك حتى يقول المحاسبُ غير ذلك") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                OutlinedTextField(
                    value = closingNotes,
                    onValueChange = { closingNotes = it },
                    label = { Text("ملاحظات الإقفال") },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            if (localError != null) {
                Text(localError ?: "", color = MaterialTheme.colorScheme.error)
            }
            if (!state.online) {
                Text(
                    "لا اتصال — إغلاقُ الوردية لا يُحفظ في الطابور: أرسله لحظةَ عودة الشبكة وأنت تنظر إلى السيارة.",
                    color = MaterialTheme.colorScheme.tertiary,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }

            ActionButton(
                label = "تقديمُ إغلاق الوردية",
                icon = Icons.Default.FactCheck,
                loading = busy,
                enabled = buildRequest() != null,
                modifier = Modifier.fillMaxWidth(),
                onClick = {
                    val request = buildRequest() ?: return@ActionButton
                    busy = true
                    localError = null
                    vm.submitClosing(loadOrderId = loadOrderId, request = request) { result: ActionResult ->
                        busy = false
                        when (result) {
                            is ActionResult.Synced -> onDone()
                            is ActionResult.Refused -> localError = result.messageAr
                            is ActionResult.Blocked -> localError = result.reasonsAr.joinToString(" · ")
                            is ActionResult.StoredOffline -> localError = result.messageAr
                        }
                    }
                },
            )
        }
    }

    if (showOrderPicker) {
        PickerDialog(
            title = "اختر أمرَ التحميل",
            items = closeable.map {
                PickerItem(
                    id = it.id,
                    title = "${it.number} — ${it.itemName}",
                    subtitle = statusText(it.status),
                    trailing = "متبقٍّ متوقّع ${Dec.kg(it.expectedRemainingQty)}",
                )
            },
            onDismiss = { showOrderPicker = false },
            onSelect = { loadOrderId = it.id },
        )
    }
}

private fun statusText(status: String): String = when (status) {
    "loaded" -> "محمَّلة"
    "in_route" -> "في الطريق"
    "pending_closing" -> "بانتظار اعتماد الإقفال"
    else -> status
}
