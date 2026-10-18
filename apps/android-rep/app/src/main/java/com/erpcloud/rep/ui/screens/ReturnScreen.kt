@file:OptIn(ExperimentalMaterial3Api::class)

package com.erpcloud.rep.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material3.ExperimentalMaterial3Api
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
import com.erpcloud.rep.data.api.ReturnRequest
import com.erpcloud.rep.data.offline.QueueOperation
import com.erpcloud.rep.ui.AppViewModel
import com.erpcloud.rep.ui.SubmitOutcome
import com.erpcloud.rep.ui.components.ActionButton
import com.erpcloud.rep.ui.components.PickerDialog
import com.erpcloud.rep.ui.components.PickerItem
import com.erpcloud.rep.ui.components.SectionCard
import com.erpcloud.rep.util.Dec

/** شاشةُ مرتجعِ العميل — مرتجعٌ مرجعيٌّ على مستندِ البيع الأصليّ (لا مرتجعَ مرتجع). */
@Composable
fun ReturnScreen(vm: AppViewModel, onDone: () -> Unit) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val workspace = state.workspace

    var documentId by rememberSaveable { mutableStateOf("") }
    var returnedQty by rememberSaveable { mutableStateOf("") }
    var reason by rememberSaveable { mutableStateOf("") }
    var notes by rememberSaveable { mutableStateOf("") }

    var showDocPicker by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var localError by remember { mutableStateOf<String?>(null) }
    var intentKey by rememberSaveable { mutableStateOf("") }
    var intentFingerprint by rememberSaveable { mutableStateOf("") }
    val currentIntent: Pair<String, String>?
        get() = intentKey.takeIf { it.isNotBlank() }?.let { it to intentFingerprint }

    val returnable = workspace?.returnableDocuments ?: emptyList()
    val document = returnable.firstOrNull { it.id == documentId }

    fun buildRequest(): ReturnRequest? {
        if (documentId.isBlank()) return null
        val qty = Dec.parse(returnedQty)
        if (qty == null || qty.signum() <= 0) return null
        return ReturnRequest(
            returnedQty = returnedQty.trim(),
            reason = reason.trim().ifBlank { null },
            notes = notes.trim().ifBlank { null },
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("مرتجعُ عميل") },
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
            SectionCard(
                title = "١) مستندُ البيع الأصليّ",
                subtitle = "المرتجعُ يكون على صفوف البيع وحدها — والخادمُ يجمع كلَّ مرتجعات المستند.",
            ) {
                OutlinedButton(onClick = { showDocPicker = true }, modifier = Modifier.fillMaxWidth()) {
                    Text(
                        document?.let { "${it.number} — ${it.customerName} (${Dec.kg(it.soldQty)} كجم)" }
                            ?: "اختر مستندَ البيع"
                    )
                }
                if (document != null) {
                    val ceiling = (Dec.parse(document.soldQty) ?: java.math.BigDecimal.ZERO)
                        .add(Dec.parse(document.bonusQty) ?: java.math.BigDecimal.ZERO)
                    Text(
                        "سقفُ المرتجع ${Dec.kg(ceiling.toPlainString())} كجم حدًّا أعلى (المبيع + المجانيّ) — " +
                            "ويخصم الخادمُ ما أُرجع على هذا المستند سابقًا.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            SectionCard(title = "٢) الكميّة والسبب") {
                OutlinedTextField(
                    value = returnedQty,
                    onValueChange = { if (Dec.isValidInput(it)) returnedQty = it },
                    label = { Text("الكميّة المرجَعة (كجم) *") },
                    isError = returnedQty.isNotBlank() && Dec.parse(returnedQty)?.signum() != 1,
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = reason,
                    onValueChange = { reason = it },
                    label = { Text("سببُ المرتجع") },
                    supportingText = { Text("يُقبل فارغًا عند الخادم لكنّ مرتجعًا بلا سببٍ لا يُراجَع") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = notes,
                    onValueChange = { notes = it },
                    label = { Text("ملاحظات") },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            if (localError != null) {
                Text(localError ?: "", color = MaterialTheme.colorScheme.error)
            }
            if (!state.online) {
                Text(
                    "لا اتصال — سيُحفظ المرتجعُ في الطابور ويُرسل بمفتاح عدم تكرارٍ واحد عند عودة الشبكة.",
                    color = MaterialTheme.colorScheme.tertiary,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }

            ActionButton(
                label = "تسجيلُ المرتجع",
                icon = Icons.AutoMirrored.Filled.Reply,
                loading = busy,
                enabled = buildRequest() != null,
                modifier = Modifier.fillMaxWidth(),
                onClick = {
                    val request = buildRequest() ?: return@ActionButton
                    busy = true
                    localError = null
                    vm.submitIntent(
                        operation = QueueOperation.RETURN,
                        targetId = documentId,
                        request = request,
                        currentIntent = currentIntent,
                    ) { outcome: SubmitOutcome ->
                        busy = false
                        when (val result = outcome.result) {
                            is ActionResult.Synced -> { intentKey = ""; intentFingerprint = ""; onDone() }
                            is ActionResult.StoredOffline -> { intentKey = ""; intentFingerprint = ""; onDone() }
                            is ActionResult.Refused -> {
                                intentKey = outcome.intent?.first ?: ""
                                intentFingerprint = outcome.intent?.second ?: ""
                                localError = result.messageAr
                            }
                            is ActionResult.Blocked -> localError = result.reasonsAr.joinToString(" · ")
                        }
                    }
                },
            )
        }
    }

    if (showDocPicker) {
        PickerDialog(
            title = "اختر مستندَ البيع",
            items = returnable.map {
                PickerItem(
                    id = it.id,
                    title = "${it.number} — ${it.customerName}",
                    subtitle = "${it.docDate} · ${it.itemName}",
                    trailing = "${Dec.kg(it.soldQty)} كجم",
                )
            },
            onDismiss = { showDocPicker = false },
            onSelect = { documentId = it.id },
        )
    }
}
