@file:OptIn(ExperimentalMaterial3Api::class)

package com.erpcloud.rep.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.erpcloud.rep.data.offline.QueueStatus
import com.erpcloud.rep.ui.AppViewModel
import com.erpcloud.rep.ui.components.ChipTone
import com.erpcloud.rep.ui.components.CenterLoading
import com.erpcloud.rep.ui.components.EmptyState
import com.erpcloud.rep.ui.components.KeyValue
import com.erpcloud.rep.ui.components.SectionCard
import com.erpcloud.rep.ui.components.StatusChip
import com.erpcloud.rep.util.Dec

/** شاشةُ مساحةِ عمل المندوب — كلُّ شيءٍ من `GET /van-sales/me` ولا رقمَ يُحسب محليًّا. */
@Composable
fun WorkspaceScreen(
    vm: AppViewModel,
    onSale: () -> Unit,
    onReturn: () -> Unit,
    onCollection: () -> Unit,
    onClosing: () -> Unit,
    onQueue: () -> Unit,
    onPrinters: () -> Unit,
    onReceipt: (String) -> Unit,
    onPrint: (String) -> Unit,
) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val workspace = state.workspace

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("مساحةُ عمل المندوب")
                        val sub = workspace?.salesmanName ?: state.me?.user?.fullName ?: ""
                        if (sub.isNotBlank()) {
                            Text(sub, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                },
                actions = {
                    IconButton(onClick = { vm.refreshAll() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "تحديث")
                    }
                    IconButton(onClick = { vm.logout() }) {
                        Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = "خروج")
                    }
                },
            )
        },
    ) { padding ->
        when {
            state.loadingWorkspace && workspace == null -> CenterLoading(
                "تُقرأ مساحةُ عملك من الخادم…",
                Modifier.padding(padding),
            )
            workspace == null -> Column(Modifier.padding(padding).padding(16.dp)) {
                Text(
                    state.workspaceError ?: "لا بيانات بعد — اضغط زرَّ التحديث.",
                    color = MaterialTheme.colorScheme.error,
                )
            }
            else -> WorkspaceBody(
                state = state,
                padding = padding,
                onSale = onSale,
                onReturn = onReturn,
                onCollection = onCollection,
                onClosing = onClosing,
                onQueue = onQueue,
                onPrinters = onPrinters,
                onReceipt = onReceipt,
                onPrint = onPrint,
            )
        }
    }
}

@Composable
private fun WorkspaceBody(
    state: com.erpcloud.rep.ui.UiState,
    padding: androidx.compose.foundation.layout.PaddingValues,
    onSale: () -> Unit,
    onReturn: () -> Unit,
    onCollection: () -> Unit,
    onClosing: () -> Unit,
    onQueue: () -> Unit,
    onPrinters: () -> Unit,
    onReceipt: (String) -> Unit,
    onPrint: (String) -> Unit,
) {
    val workspace = state.workspace ?: return
    LazyColumn(
        Modifier.fillMaxSize().padding(padding).padding(horizontal = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // لستَ مندوبًا؟ رسالةُ الخادم كما هي — لا تعويضَ ولا تخمين.
        if (!workspace.isRep) {
            item {
                SectionCard(title = "لا بطاقةَ مندوب") {
                    Text(workspace.message ?: "حسابُك غير مرتبطٍ ببطاقة مندوب توزيع.")
                }
            }
        } else {
            // شريطُ الاتصال والطابور
            item { ConnectionStrip(state, onQueue) }

            // البطاقاتُ الأربع في الرأس
            item { HeadlineCards(workspace) }

            // الإجراءاتُ
            item {
                SectionCard(title = "إجراءاتُ الوردية") {
                    ActionGrid(
                        canInvoice = state.can("van_sales.invoice.create"),
                        canCollect = state.can("van_sales.collection.create"),
                        canClose = state.can("van_sales.closing.submit"),
                        onSale = onSale,
                        onReturn = onReturn,
                        onCollection = onCollection,
                        onClosing = onClosing,
                        onPrinters = onPrinters,
                    )
                }
            }

            // توريدٌ بانتظار الاستلام
            item {
                SectionCard(
                    title = "توريدٌ بانتظار تأكيد استلامك (${workspace.pendingReceipts.size})",
                    subtitle = "البضاعةُ في الطريق — عهدتُك تبدأ بتأكيدِ استلامك لا بإرسال المستودع.",
                ) {
                    if (workspace.pendingReceipts.isEmpty()) {
                        EmptyState("لا توريدَ بانتظار الاستلام.")
                    } else {
                        workspace.pendingReceipts.forEach { receipt ->
                            Column(Modifier.padding(vertical = 6.dp)) {
                                KeyValue("الأمر", receipt.number)
                                KeyValue("الصنف", receipt.itemName)
                                KeyValue("المحمَّل", "${Dec.kg(receipt.loadedQty)} كجم")
                                KeyValue("من مستودع", receipt.fromWarehouseName)
                                KeyValue("الدفعة", receipt.productionBatchNo)
                                OutlinedButton(
                                    onClick = { onReceipt(receipt.id) },
                                    modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                                ) { Text("تأكيدُ الاستلام") }
                            }
                        }
                    }
                }
            }

            // أوامرُ التحميل
            item {
                SectionCard(
                    title = "أوامرُ التحميل (${workspace.loadOrders.size})",
                    subtitle = windowNote(workspace.windows?.loadOrders?.returned, workspace.windows?.loadOrders?.total),
                ) {
                    if (workspace.loadOrders.isEmpty()) {
                        EmptyState("لا أوامرَ تحميل.")
                    } else {
                        workspace.loadOrders.forEach { order ->
                            Column(Modifier.padding(vertical = 6.dp)) {
                                Row(
                                    Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                ) {
                                    Text(order.number, fontWeight = FontWeight.SemiBold)
                                    StatusChip(statusAr(order.status), statusTone(order.status))
                                }
                                KeyValue("الصنف", order.itemName)
                                KeyValue("المحمَّل / المستلَم", "${Dec.kg(order.loadedQty)} / ${Dec.kg(order.receivedQty)} كجم")
                                KeyValue("المتبقّي المتوقّع", "${Dec.kg(order.expectedRemainingQty)} كجم")
                                if (Dec.parse(order.discrepancyQty)?.signum() > 0) {
                                    Text(
                                        "نقصٌ عند الاستلام ${Dec.kg(order.discrepancyQty)} كجم — بانتظار قرار المحاسب.",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.error,
                                    )
                                }
                                if (Dec.parse(order.shortageQty)?.signum() > 0) {
                                    Text(
                                        "عجزٌ مُعلن ${Dec.kg(order.shortageQty)} كجم بقيمة ${Dec.money(order.shortageValue)} ريال.",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.error,
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // المستندات
            item {
                SectionCard(
                    title = "مستنداتُك (${workspace.documents.size})",
                    subtitle = windowNote(workspace.windows?.documents?.returned, workspace.windows?.documents?.total),
                ) {
                    if (workspace.documents.isEmpty()) {
                        EmptyState("لا مستندات بعد.")
                    } else {
                        workspace.documents.forEach { doc ->
                            Column(Modifier.padding(vertical = 6.dp)) {
                                Row(
                                    Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                ) {
                                    Text(doc.number, fontWeight = FontWeight.SemiBold)
                                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                        if (doc.isSale) StatusChip("بيع", ChipTone.INFO) else StatusChip("مرتجع", ChipTone.WARN)
                                        if (Dec.parse(doc.outstanding)?.signum() > 0) StatusChip("عليه متبقٍّ", ChipTone.DANGER)
                                    }
                                }
                                KeyValue("التاريخ", doc.docDate)
                                KeyValue("العميل", doc.customerName)
                                KeyValue("الكميّة / السعر", "${Dec.kg(doc.soldQty)} كجم × ${Dec.money(doc.unitPrice)}")
                                KeyValue("الإجماليّ / المتبقّي", "${Dec.money(doc.total)} / ${Dec.money(doc.outstanding)} ريال")
                                Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    TextButton(onClick = { onPrint(doc.id) }) {
                                        Icon(Icons.Default.Print, contentDescription = null, Modifier.height(18.dp))
                                        Spacer(Modifier.padding(start = 4.dp))
                                        Text("طباعة")
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // التحصيلات
            item {
                SectionCard(
                    title = "تحصيلاتُك (${workspace.collections.size})",
                    subtitle = windowNote(workspace.windows?.collections?.returned, workspace.windows?.collections?.total),
                ) {
                    if (workspace.collections.isEmpty()) {
                        EmptyState("لا تحصيلات بعد.")
                    } else {
                        workspace.collections.forEach { collection ->
                            Column(Modifier.padding(vertical = 4.dp)) {
                                KeyValue("التاريخ", collection.collectedAt.take(19).replace('T', ' '))
                                KeyValue("المبلغ", "${Dec.money(collection.amount)} ريال")
                                KeyValue("السند", collection.voucherNumber ?: "—")
                            }
                        }
                    }
                }
            }

            // الإشعارات
            item {
                SectionCard(
                    title = "الإشعارات (${workspace.notifications.size})",
                    subtitle = windowNote(workspace.windows?.notifications?.returned, workspace.windows?.notifications?.total),
                ) {
                    if (workspace.notifications.isEmpty()) {
                        EmptyState("لا إشعارات.")
                    } else {
                        workspace.notifications.forEach { n ->
                            Column(Modifier.padding(vertical = 4.dp)) {
                                Text(
                                    n.payload?.get("title")?.toString()?.trim('"') ?: notificationTypeAr(n.type),
                                    fontWeight = FontWeight.SemiBold,
                                )
                                val body = n.payload?.get("body")?.toString()?.trim('"').orEmpty()
                                if (body.isNotBlank()) {
                                    Text(body, style = MaterialTheme.typography.bodyMedium)
                                }
                                Text(
                                    n.createdAt.take(19).replace('T', ' '),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }

            item { Spacer(Modifier.height(20.dp)) }
        }
    }
}

@Composable
private fun ConnectionStrip(state: com.erpcloud.rep.ui.UiState, onQueue: () -> Unit) {
    val pending = state.queue.count { it.queueStatus == QueueStatus.PENDING }
    val refused = state.queue.count { it.queueStatus == QueueStatus.REFUSED }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (!state.online) {
            StatusChip("لا اتصال — البيعُ والمرتجعُ والتحصيلُ تُحفظ في الطابور", ChipTone.WARN)
        } else {
            StatusChip("متّصل", ChipTone.OK)
        }
        Spacer(Modifier.weight(1f))
        if (pending > 0 || refused > 0) {
            TextButton(onClick = onQueue) {
                Text("الطابور: ${pending} بانتظار · ${refused} مرفوضة")
            }
        }
    }
}

@Composable
private fun HeadlineCards(workspace: com.erpcloud.rep.data.api.RepWorkspace) {
    val totals = workspace.totals
    val custody = workspace.custody
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionCard(title = "رصيدُ سيارتك الرسميّ") {
            Text("${Dec.kg(workspace.custodyKg)} كجم", style = MaterialTheme.typography.headlineSmall)
            Text(
                "قيمته ${Dec.money(workspace.custodyValue)} ريال — من دفتر المخزون الرسميّ (كاملٌ بلا نافذة).",
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        SectionCard(title = "مبيعاتك — صافي المرتجعات") {
            if (totals == null) {
                Text("لم يُرجع الخادمُ مجاميعَ المندوب.")
            } else {
                Text("${Dec.money(totals.revenue)} ريال", style = MaterialTheme.typography.headlineSmall)
                Text(
                    "نقديّ ${Dec.money(totals.cashSales)} · آجل ${Dec.money(totals.creditSales)}" +
                        (if (totals.returnCount > 0)
                            " − مرتجعات ${Dec.money(totals.returns)} وضريبتُها ${Dec.money(totals.returnsVat)}"
                        else ""),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
        SectionCard(title = "المحصَّل / المتبقّي على العملاء") {
            if (totals == null) {
                Text("لم يُرجع الخادمُ مجاميعَ المندوب.")
            } else {
                Text("${Dec.money(totals.collected)} ريال", style = MaterialTheme.typography.headlineSmall)
                Text(
                    "متبقٍّ ${Dec.money(totals.outstanding)}" +
                        (if (totals.returnCount > 0) " — بعد خصم ${totals.returnCount} إشعارٍ دائنٍ لمرتجعاتك" else ""),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
        SectionCard(title = "حالةُ العهدة") {
            if (custody == null) {
                Text("لا عهدةَ مفتوحة.")
            } else {
                Text("${Dec.kg(custody.expectedKg)} كجم", style = MaterialTheme.typography.headlineSmall)
                Text(
                    if (custody.pendingClosings > 0) {
                        "⏳ ${custody.pendingClosings} إغلاقٌ بانتظار المحاسب — والرصيدُ الرسميّ ${Dec.kg(custody.officialKg)} كجم"
                    } else {
                        "✅ لا إغلاقَ معلّق — والرصيدُ الرسميّ ${Dec.kg(custody.officialKg)} كجم"
                    },
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
    }
}

@Composable
private fun ActionGrid(
    canInvoice: Boolean,
    canCollect: Boolean,
    canClose: Boolean,
    onSale: () -> Unit,
    onReturn: () -> Unit,
    onCollection: () -> Unit,
    onClosing: () -> Unit,
    onPrinters: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            OutlinedButton(onClick = onSale, enabled = canInvoice, modifier = Modifier.weight(1f)) { Text("بيعٌ جديد") }
            OutlinedButton(onClick = onReturn, enabled = canInvoice, modifier = Modifier.weight(1f)) { Text("مرتجعُ عميل") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            OutlinedButton(onClick = onCollection, enabled = canCollect, modifier = Modifier.weight(1f)) { Text("تحصيلُ دين") }
            OutlinedButton(onClick = onClosing, enabled = canClose, modifier = Modifier.weight(1f)) { Text("إغلاقُ الوردية") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            OutlinedButton(onClick = onPrinters, modifier = Modifier.weight(1f)) { Text("طابعاتُ البلوتوث") }
        }
    }
}

private fun windowNote(returned: Int?, total: Int?): String? {
    if (returned == null || total == null) return null
    return "تُعرض أحدث $returned من $total — القائمةُ نافذةٌ لا الجدولَ كاملًا، والمجاميعُ من جدولك كلّه."
}

private fun statusAr(status: String): String = when (status) {
    "draft" -> "مسودة"
    "pending_receipt" -> "بانتظار الاستلام"
    "loaded" -> "محمَّلة"
    "in_route" -> "في الطريق"
    "pending_closing" -> "بانتظار اعتماد الإقفال"
    "pending_stock_settlement" -> "بانتظار تسوية المخزون"
    "settled" -> "مُصفّاة"
    "canceled" -> "ملغاة"
    "rejected" -> "مرفوضة"
    else -> status
}

private fun statusTone(status: String): ChipTone = when (status) {
    "loaded", "in_route" -> ChipTone.OK
    "pending_receipt" -> ChipTone.INFO
    "pending_closing", "pending_stock_settlement" -> ChipTone.WARN
    "settled" -> ChipTone.NEUTRAL
    "canceled", "rejected" -> ChipTone.DANGER
    else -> ChipTone.NEUTRAL
}

private fun notificationTypeAr(type: String): String = when (type) {
    "van_sales_closing_request" -> "طلبُ اعتماد إغلاق وردية"
    "van_sales_receipt_confirmed" -> "تأكيدُ استلام توريد"
    "van_sales_receipt_discrepancy" -> "فرقٌ في استلام توريد"
    else -> type
}
