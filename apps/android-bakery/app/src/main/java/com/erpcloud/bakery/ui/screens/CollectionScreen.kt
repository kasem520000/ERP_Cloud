package com.erpcloud.bakery.ui.screens

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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.data.ActionResult
import com.erpcloud.bakery.data.api.DocumentDto
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.EmptyState
import com.erpcloud.bakery.ui.components.KeyValue
import com.erpcloud.bakery.ui.components.MissingPermissionHint
import com.erpcloud.bakery.ui.components.PullRefreshBox
import com.erpcloud.bakery.ui.components.SearchField
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.components.StatusChip
import com.erpcloud.bakery.util.Dec
import com.erpcloud.bakery.printing.saleInvoice
import com.erpcloud.bakery.printing.EscPos
import com.erpcloud.bakery.printing.PrintKit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.put

/**
 * شاشةُ التحصيل والمستندات — فواتيرُ البيع والمرتجعات من لوحة الخطّ، والتحصيلُ
 * على الفاتورة الآجلة (إذنُ van_sales.collection.create). الذممُ **صافيةٌ من
 * المرتجعات** كما يقول الخادم، والفائضُ عن الرصيد يرفضه الخادم حرفيًّا:
 * «مبلغ التحصيل (X ريال) يتجاوز الرصيد المتبقي على الفاتورة (Y ريال)».
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CollectionScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    val dash = state.dashboard
    var tab by rememberSaveable { mutableIntStateOf(0) }
    // بحثٌ محليٌّ في نافذةِ اللوحة (اسمُ العميل/المنديب/الصنف أو رقمُ المستند).
    var search by rememberSaveable { mutableStateOf("") }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("التحصيل والمستندات") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
    ) { padding ->
        PullRefreshBox(
            refreshing = state.loadingDashboard,
            onRefresh = { vm.refreshDashboard() },
            modifier = Modifier.fillMaxSize(),
        ) {
            Column(Modifier.fillMaxSize().padding(padding)) {
                if (state.loadingDashboard && dash == null) {
                    CenterLoading("جارٍ التحميل…")
                    return@Column
                }
                val summary = dash?.summary
                if (summary != null) {
                    SectionCard(
                        title = "الصورةُ الماليّة",
                        subtitle = "ذممُ المنشأة صافيةٌ من المرتجعات — كما يحسبها الخادم",
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                    ) {
                        KeyValue("إجماليُّ البيع (ر.س)", Dec.money(summary.totalSalesGrossSar))
                        KeyValue("المرتجعات", Dec.money(summary.totalReturnsSar))
                        KeyValue("ضريبةُ المرتجعات", Dec.money(summary.totalReturnsVatSar))
                        KeyValue("الصافي المُحصَّل نقدًا", Dec.money(summary.totalCollectedCashSar))
                        KeyValue("الذممُ الآجلة القائمة", Dec.money(summary.totalCreditReceivablesSar))
                    }
                }
                TabRow(selectedTabIndex = tab) {
                    Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("فواتيرٌ آجلة") })
                    Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("كلُّ المستندات") })
                }
                SearchField(
                    value = search,
                    onValueChange = { search = it },
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                )
                val documents = dash?.documents.orEmpty()
                val creditDocs = documents.filter { it.paymentMethod == "credit" }
                val shown = if (tab == 0) creditDocs else documents
                val query = search.trim()
                val visible = if (query.isBlank()) shown else shown.filter { doc ->
                    doc.customerName.contains(query, ignoreCase = true) ||
                        doc.number.contains(query, ignoreCase = true) ||
                        doc.salesmanName.contains(query, ignoreCase = true) ||
                        doc.itemName.contains(query, ignoreCase = true) ||
                        (doc.invoiceNumber?.contains(query, ignoreCase = true) == true)
                }
                if (visible.isEmpty()) {
                    EmptyState(
                        if (query.isNotBlank()) "لا مستنداتٍ تطابقُ «$query»."
                        else if (tab == 0) "لا فواتيرَ آجلةً في نافذة اللوحة."
                        else "لا مستنداتٍ في نافذة اللوحة."
                    )
                    return@Column
                }
                LazyColumn(
                    contentPadding = PaddingValues(14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(visible, key = { it.id }) { doc ->
                        DocumentCard(vm = vm, doc = doc)
                    }
                }
            }
        }
    }
}

/** مستندٌ واحد — عرضُه، وتحصيلٌ إن كان آجلًا وبقيت فيه ذمّة، وطباعةُ فاتورته. */
@Composable
private fun DocumentCard(vm: AppViewModel, doc: DocumentDto) {
    val state by vm.uiState.collectAsState()
    var showCollect by remember { mutableStateOf(false) }
    var printing by remember { mutableStateOf(false) }
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val context = androidx.compose.ui.platform.LocalContext.current

    val (kindText, kindTone) = Labels.documentKind(doc.documentKind)
    val outstanding = outstandingAmount(doc)
    SectionCard(
        title = "${doc.number.ifBlank { "مستند" }} — ${doc.customerName.ifBlank { "عميل" }}",
        subtitle = "${doc.itemName.ifBlank { "صنف" }} · ${Labels.dateOrDash(doc.docDate)} · ${doc.salesmanName}",
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            StatusChip(kindText, kindTone)
            StatusChip(Labels.paymentMethod(doc.paymentMethod), ChipTone.NEUTRAL)
            StatusChip(Labels.invoiceMode(doc.invoiceMode), ChipTone.INFO)
        }
        Spacer(Modifier.height(6.dp))
        KeyValue("المُباع (كجم)", Dec.kg(doc.soldQty))
        if (Dec.isPositive(doc.bonusQty)) KeyValue("مجاني", Dec.kg(doc.bonusQty))
        KeyValue("سعرُ الوحدة", Dec.money(doc.unitPrice) + " ر.س")
        KeyValue("الإجماليّ", Dec.money(doc.total) + " ر.س")
        KeyValue("المدفوع", Dec.money(doc.paidAmount) + " ر.س")
        if (outstanding != null && outstanding.signum() > 0) {
            KeyValue("المتبقّي على الفاتورة", Dec.money(outstanding.toPlainString()) + " ر.س")
        }
        if (doc.invoiceNumber != null) KeyValue("رقمُ الفاتورة الرسميّة", doc.invoiceNumber)
        if (doc.bonusAnomaly) StatusChip("حادثةُ بونص: ${doc.anomalyReason}", ChipTone.DANGER)

        if (doc.paymentMethod == "credit" && outstanding != null && outstanding.signum() > 0 &&
            state.can("van_sales.collection.create")
        ) {
            Spacer(Modifier.height(8.dp))
            OutlinedButton(onClick = { showCollect = true }) { Text("تحصيلٌ على الفاتورة") }
        } else if (doc.paymentMethod == "credit" && outstanding != null && outstanding.signum() > 0) {
            // B12: زرُّ التحصيلِ يُخفيه غيابُ الإذن — اللافتةُ تُسمّي الصلاحيةَ بدلَ الصمت.
            MissingPermissionHint("تحصيلٌ على الفاتورة", "van_sales.collection.create")
        }

        Spacer(Modifier.height(8.dp))
        androidx.compose.foundation.layout.Row(horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(8.dp)) {
            androidx.compose.material3.OutlinedButton(
                onClick = {
                    if (printing) return@OutlinedButton
                    printing = true
                    vm.fetchInvoiceForPrint(doc.id) { view ->
                        if (view == null) {
                            printing = false
                            return@fetchInvoiceForPrint
                        }
                        scope.launch {
                            try {
                                val bitmap = withContext(Dispatchers.IO) { saleInvoice(view) }
                                val mac = state.session.printerMac
                                val width = state.session.printerWidthDots
                                if (mac.isNotBlank()) {
                                    withContext(Dispatchers.IO) { EscPos.printBitmap(context, mac, width, bitmap) }
                                } else {
                                    PrintKit.printViaSystem(context, bitmap, "فاتورة ${doc.number}")
                                }
                            } catch (error: Exception) {
                                vm.showPrintError(error.message ?: "تعذّرت الطباعة")
                            } finally {
                                printing = false
                            }
                        }
                    }
                },
                enabled = !printing,
                modifier = Modifier.weight(1f),
            ) { Text(if (printing) "جارٍ الطباعة…" else "طباعةُ الفاتورة") }
            androidx.compose.material3.OutlinedButton(
                onClick = {
                    if (printing) return@OutlinedButton
                    printing = true
                    vm.fetchInvoiceForPrint(doc.id) { view ->
                        if (view == null) {
                            printing = false
                            return@fetchInvoiceForPrint
                        }
                        scope.launch {
                            try {
                                val bitmap = withContext(Dispatchers.IO) { saleInvoice(view) }
                                val shared = withContext(Dispatchers.IO) {
                                    PrintKit.shareImage(context, bitmap, "فاتورة-${doc.number.ifBlank { doc.id.takeLast(6) }}.png")
                                }
                                if (!shared) vm.showPrintError("تعذّرت المشاركة — لا تطبيقُ مشاركةٍ متاح.")
                            } catch (error: Exception) {
                                vm.showPrintError(error.message ?: "تعذّرت المشاركة")
                            } finally {
                                printing = false
                            }
                        }
                    }
                },
                enabled = !printing,
                modifier = Modifier.weight(1f),
            ) { Text("مشاركة") }
        }
    }

    if (showCollect) {
        CollectDialog(
            vm = vm,
            doc = doc,
            outstandingText = outstanding?.toPlainString() ?: "",
            onDismiss = { showCollect = false },
        )
    }
}

/** المتبقّي على الفاتورة = الإجماليّ − المدفوع (من رقمين رسميّين، لا تقدير). */
private fun outstandingAmount(doc: DocumentDto): java.math.BigDecimal? {
    val total = Dec.parse(doc.total) ?: return null
    return total.subtract(Dec.orZero(doc.paidAmount))
}

/** حوارُ التحصيل — نيّةٌ واحدةٌ مفتاحٌ واحد (مفتاحُ عدم التكرار في الجسم). */
@Composable
private fun CollectDialog(
    vm: AppViewModel,
    doc: DocumentDto,
    outstandingText: String,
    onDismiss: () -> Unit,
) {
    var amount by rememberSaveable(doc.id) { mutableStateOf(outstandingText) }
    var notes by rememberSaveable(doc.id) { mutableStateOf("") }
    var intentKey by rememberSaveable(doc.id) { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(
                onClick = {
                    val value = Dec.parse(amount)
                    error = when {
                        value == null || value.signum() <= 0 -> "أدخل مبلغًا موجبًا."
                        else -> null
                    }
                    if (error != null) return@TextButton
                    busy = true
                    val body = kotlinx.serialization.json.buildJsonObject {
                        put("documentId", doc.id)
                        put("collectedAmount", Dec.wire(amount))
                        if (notes.isNotBlank()) put("notes", notes.trim())
                    }
                    val withKey = vm.ensureIdempotencyKey("bakery-collection", body, intentKey)
                    intentKey = (withKey["idempotencyKey"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: intentKey
                    vm.collectCustomerDebt(withKey) { result ->
                        busy = false
                        if (result is ActionResult.Synced) onDismiss() else error = resultMessage(result)
                    }
                },
                enabled = !busy,
            ) { Text(if (busy) "جارٍ…" else "تسجيلُ التحصيل") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("رجوع") } },
        title = { Text("تحصيل على ${doc.number}") },
        text = {
            Column {
                KeyValue("العميل", doc.customerName)
                KeyValue("المتبقّي على الفاتورة", Dec.money(outstandingText) + " ر.س")
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = amount,
                    onValueChange = { if (Dec.isValidInput(it)) amount = it },
                    label = { Text("مبلغُ التحصيل (ر.س)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = notes,
                    onValueChange = { notes = it },
                    label = { Text("ملاحظات") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    "التجاوزُ عن الرصيد يرفضه الخادم حرفيًّا، والتحصيلُ يُرحَّل سندَ قبضٍ رسميًّا على الخزينة.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (error != null) {
                    Spacer(Modifier.height(8.dp))
                    StatusChip(error ?: "", ChipTone.DANGER)
                }
            }
        },
    )
}

private fun resultMessage(result: ActionResult): String = when (result) {
    is ActionResult.Refused -> result.messageAr
    is ActionResult.Offline -> result.messageAr
    is ActionResult.Synced -> result.messageAr
}
