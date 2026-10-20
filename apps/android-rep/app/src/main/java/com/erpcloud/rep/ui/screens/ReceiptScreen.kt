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
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import com.erpcloud.rep.data.api.ReceiptRequest
import com.erpcloud.rep.ui.AppViewModel
import com.erpcloud.rep.ui.components.ActionButton
import com.erpcloud.rep.ui.components.KeyValue
import com.erpcloud.rep.ui.components.SectionCard
import com.erpcloud.rep.util.Dec

/**
 * شاشةُ تأكيدِ استلامِ التوريد — العهدةُ تبدأ هنا. لا مفتاحَ في المسار ولا حفظَ في
 * الطابور: إعادةُ الإرسال تُرفض 409 («تم تأكيد الاستلام مسبقًا»).
 */
@Composable
fun ReceiptScreen(vm: AppViewModel, loadOrderId: String, onDone: () -> Unit) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val receipt = state.workspace?.pendingReceipts?.firstOrNull { it.id == loadOrderId }

    var receivedQty by rememberSaveable {
        mutableStateOf(receipt?.loadedQty ?: "")
    }
    var notes by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var localError by remember { mutableStateOf<String?>(null) }

    // إن فُتحت الشاشةُ قبل اكتمال تحميل المساحة: القيمةُ الافتراضيّة = الحملُ كاملًا.
    LaunchedEffect(receipt?.id) {
        if (receivedQty.isBlank()) receivedQty = receipt?.loadedQty ?: ""
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("تأكيدُ استلام توريد") },
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
            if (receipt == null) {
                SectionCard(title = "الأمرُ غير موجود") {
                    Text("لم يعد هذا الأمرُ في قائمةِ ما بانتظار استلامك — قد يكون مؤكَّدًا بالفعل.")
                }
            } else {
                SectionCard(title = "الأمر ${receipt.number}") {
                    KeyValue("الصنف", receipt.itemName)
                    KeyValue("المحمَّل", "${Dec.kg(receipt.loadedQty)} كجم")
                    KeyValue("من مستودع", receipt.fromWarehouseName)
                    KeyValue("دفعةُ الإنتاج", receipt.productionBatchNo)
                }

                SectionCard(title = "ما استلمتَه فعلًا") {
                    OutlinedTextField(
                        value = receivedQty,
                        onValueChange = { if (Dec.isValidInput(it)) receivedQty = it },
                        label = { Text("الكميّة المستلَمة (كجم)") },
                        supportingText = { Text("اتركها كما هي إن استلمتَ الحملَ كاملًا — أي فرقٍ يُسجَّل نقصَ استلامٍ يقرّره المحاسب") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = notes,
                        onValueChange = { notes = it },
                        label = { Text("ملاحظات (مثل: نقص كرتونين عند التحميل)") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                if (localError != null) {
                    Text(localError ?: "", color = MaterialTheme.colorScheme.error)
                }
                if (!state.online) {
                    Text(
                        "لا اتصال — تأكيدُ الاستلام لا يُحفظ في الطابور: البضاعةُ أمامك، أكِّد استلامَها لحظةَ عودة الشبكة.",
                        color = MaterialTheme.colorScheme.tertiary,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }

                ActionButton(
                    label = "تأكيدُ الاستلام",
                    icon = Icons.Default.Inbox,
                    loading = busy,
                    enabled = receivedQty.isBlank() || Dec.isNonNegative(receivedQty),
                    modifier = Modifier.fillMaxWidth(),
                    onClick = {
                        busy = true
                        localError = null
                        vm.confirmReceipt(
                            loadOrderId = loadOrderId,
                            request = ReceiptRequest(
                                receivedQty = receivedQty.trim().ifBlank { null },
                                notes = notes.trim().ifBlank { null },
                            ),
                        ) { result: ActionResult ->
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
    }
}
