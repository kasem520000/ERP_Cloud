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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.FactCheck
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.erpcloud.rep.data.api.RepLoadOrderRow
import com.erpcloud.rep.ui.AppViewModel
import com.erpcloud.rep.ui.components.CenterLoading
import com.erpcloud.rep.ui.components.ChipTone
import com.erpcloud.rep.ui.components.EmptyState
import com.erpcloud.rep.ui.components.InfoCallout
import com.erpcloud.rep.ui.components.KeyValue
import com.erpcloud.rep.ui.components.ListItemCard
import com.erpcloud.rep.ui.components.SectionCard
import com.erpcloud.rep.ui.components.StatusChip
import com.erpcloud.rep.util.Dec

/**
 * شاشةٌ مخصّصة لاستلام التوريدات وأرصدة السيارة وأوامر التحميل — مفصولةٌ عن لوحة الوردية
 * لتسهيل عمل المندوب بلا ازدحام.
 */
@Composable
fun CustodyOverviewScreen(
    vm: AppViewModel,
    initialTab: String = "receipts",
    onBack: () -> Unit,
    onReceipt: (String) -> Unit,
    onClosing: () -> Unit,
) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val workspace = state.workspace
    var tab by rememberSaveable { mutableStateOf(initialTab) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("التوريدات وعهدة السيارة", fontWeight = FontWeight.ExtraBold)
                        workspace?.custodyKg?.let {
                            Text(
                                "رصيد السيارة الرسمي: ${Dec.kg(it)} كجم",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع")
                    }
                },
                actions = {
                    IconButton(onClick = { vm.refreshAll() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "تحديث")
                    }
                },
            )
        },
    ) { padding ->
        if (state.loadingWorkspace && workspace == null) {
            CenterLoading("جارٍ قراءة العهدة والتوريدات…", Modifier.padding(padding))
            return@Scaffold
        }
        if (workspace == null) {
            Column(Modifier.padding(padding).padding(16.dp)) {
                Text(
                    state.workspaceError ?: "لا بيانات متاحة حالياً — اضغط تحديث.",
                    color = MaterialTheme.colorScheme.error,
                )
            }
            return@Scaffold
        }

        LazyColumn(
            Modifier.fillMaxSize().padding(padding).padding(horizontal = 14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Row(
                    Modifier.fillMaxWidth().padding(top = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    CustodyTabPill(
                        label = "استلام التوريدات (${workspace.pendingReceipts.size})",
                        selected = tab == "receipts",
                        modifier = Modifier.weight(1f),
                        onClick = { tab = "receipts" },
                    )
                    CustodyTabPill(
                        label = "أرصدة الأصناف (${workspace.balances.size})",
                        selected = tab == "balances",
                        modifier = Modifier.weight(1f),
                        onClick = { tab = "balances" },
                    )
                    CustodyTabPill(
                        label = "الأوامر (${workspace.loadOrders.size})",
                        selected = tab == "orders",
                        modifier = Modifier.weight(1f),
                        onClick = { tab = "orders" },
                    )
                }
            }

            if (tab == "receipts") {
                item {
                    SectionCard(
                        title = "توريداتٌ بانتظار تأكيد استلامك (${workspace.pendingReceipts.size})",
                        subtitle = "البضاعةُ لا تدخل عهدتك الرسمية إلا بعد تأكيدِ استلامك.",
                    ) {
                        if (workspace.pendingReceipts.isEmpty()) {
                            EmptyState("لا توريدَ بانتظار الاستلام حالياً.")
                        } else {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                workspace.pendingReceipts.forEach { receipt ->
                                    ListItemCard(highlighted = true, onClick = { onReceipt(receipt.id) }) {
                                        Row(
                                            Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Text(
                                                receipt.number,
                                                style = MaterialTheme.typography.titleMedium,
                                                fontWeight = FontWeight.ExtraBold,
                                            )
                                            StatusChip("بانتظار الاستلام", ChipTone.WARN)
                                        }
                                        KeyValue("الصنف", receipt.itemName)
                                        KeyValue("الكميّة المحمَّلة", "${Dec.kg(receipt.loadedQty)} كجم")
                                        KeyValue("من مستودع", receipt.fromWarehouseName)
                                        KeyValue("دفعة الإنتاج", receipt.productionBatchNo)
                                        FilledTonalButton(
                                            onClick = { onReceipt(receipt.id) },
                                            modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                                            shape = RoundedCornerShape(12.dp),
                                        ) {
                                            Text("مراجعة وتأكيد الاستلام", fontWeight = FontWeight.Bold)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if (tab == "balances") {
                item {
                    SectionCard(
                        title = "أرصدةُ أصناف سيارتك (${workspace.balances.size})",
                        subtitle = "من دفتر المخزون الرسمي — الكمية المتاحة والقيمة الدفترية.",
                    ) {
                        if (workspace.balances.isEmpty()) {
                            EmptyState("لا أصنافَ في عهدتك الآن.")
                        } else {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                workspace.balances.forEach { balance ->
                                    ListItemCard {
                                        Row(
                                            Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Text(
                                                balance.itemName.ifBlank { "صنف" },
                                                style = MaterialTheme.typography.titleMedium,
                                                fontWeight = FontWeight.Bold,
                                                modifier = Modifier.weight(1f),
                                            )
                                            if (balance.sku.isNotBlank()) {
                                                StatusChip(balance.sku, ChipTone.NEUTRAL)
                                            }
                                        }
                                        KeyValue("الكميّة المتاحة", "${Dec.kg(balance.quantity)} كجم")
                                        if (Dec.isPositive(balance.value)) {
                                            KeyValue("القيمة الدفترية", "${Dec.money(balance.value)} ريال")
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if (tab == "orders") {
                item {
                    SectionCard(
                        title = "سجلُّ أوامر التحميل (${workspace.loadOrders.size})",
                        subtitle = custodyWindowNote(
                            workspace.windows?.loadOrders?.returned,
                            workspace.windows?.loadOrders?.total,
                        ),
                    ) {
                        if (workspace.loadOrders.isEmpty()) {
                            EmptyState("لا أوامرَ تحميل.")
                        } else {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                workspace.loadOrders.forEach { order ->
                                    ListItemCard {
                                        Row(
                                            Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Text(
                                                order.number,
                                                style = MaterialTheme.typography.titleMedium,
                                                fontWeight = FontWeight.Bold,
                                            )
                                            StatusChip(loadOrderStatusAr(order.status), loadOrderStatusTone(order.status))
                                        }
                                        KeyValue("الصنف", order.itemName)
                                        KeyValue(
                                            "المحمَّل / المستلَم",
                                            "${Dec.kg(order.loadedQty)} / ${Dec.kg(order.receivedQty)} كجم",
                                        )
                                        KeyValue("المتبقّي المتوقّع", "${Dec.kg(order.expectedRemainingQty)} كجم")
                                        loadOrderReceiptShortfallText(order)?.let { msg ->
                                            InfoCallout(msg, ChipTone.WARN, Modifier.padding(top = 4.dp))
                                        }
                                        loadOrderClosingShortageText(order)?.let { msg ->
                                            InfoCallout(msg, ChipTone.DANGER, Modifier.padding(top = 4.dp))
                                        }
                                        if (
                                            state.can("van_sales.closing.submit") &&
                                            (order.status == "loaded" || order.status == "in_route")
                                        ) {
                                            OutlinedButton(
                                                onClick = onClosing,
                                                modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                                                shape = RoundedCornerShape(12.dp),
                                            ) {
                                                Icon(Icons.Default.FactCheck, contentDescription = null, Modifier.size(16.dp))
                                                Spacer(Modifier.size(6.dp))
                                                Text("الانتقال لتقديم الإقفال", fontWeight = FontWeight.Bold)
                                            }
                                        }
                                    }
                                }
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
private fun CustodyTabPill(
    label: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        modifier = modifier,
        shape = RoundedCornerShape(14.dp),
        color = if (selected) {
            MaterialTheme.colorScheme.primaryContainer
        } else {
            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.65f)
        },
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = if (selected) FontWeight.ExtraBold else FontWeight.Medium,
            color = if (selected) {
                MaterialTheme.colorScheme.onPrimaryContainer
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 10.dp),
        )
    }
}

internal fun custodyWindowNote(returned: Int?, total: Int?): String? {
    if (returned == null || total == null) return null
    return "تُعرض أحدث $returned من $total — القائمةُ نافذةٌ لا الجدولَ كاملًا، والمجاميعُ من جدولك كلّه."
}

internal fun loadOrderReceiptShortfallText(row: RepLoadOrderRow): String? {
    if (!Dec.isPositive(row.discrepancyQty)) return null
    val pending = row.stockSettlementStatus == "pending_transit_decision"
    val suffix = when {
        pending -> " — فرقٌ بانتظار قرار المحاسب، ولا يُشطب تلقائيًّا."
        row.stockSettlementNote.isNotBlank() -> " — قرار المحاسب: ${row.stockSettlementNote}"
        else -> "."
    }
    return "نقصٌ عند الاستلام ${Dec.kg(row.discrepancyQty)} كجم (المحمَّل ${Dec.kg(row.loadedQty)} − المستلَم ${Dec.kg(row.receivedQty)})$suffix"
}

internal fun loadOrderClosingShortageText(row: RepLoadOrderRow): String? {
    if (!Dec.isPositive(row.shortageQty)) return null
    val tail = if (!row.approvedAt.isNullOrBlank()) {
        val note = if (row.stockSettlementNote.isNotBlank()) " — قرار المحاسب: ${row.stockSettlementNote}" else ""
        "اعتُمد$note."
    } else {
        "بانتظار اعتماد المحاسب — لا يُشطب تلقائيًّا."
    }
    return "عجزٌ مُعلن ${Dec.kg(row.shortageQty)} كجم بقيمة ${Dec.money(row.shortageValue)} ريال — $tail"
}

internal fun loadOrderStatusAr(status: String): String = when (status) {
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

internal fun loadOrderStatusTone(status: String): ChipTone = when (status) {
    "loaded", "in_route" -> ChipTone.OK
    "pending_receipt" -> ChipTone.INFO
    "pending_closing", "pending_stock_settlement" -> ChipTone.WARN
    "settled" -> ChipTone.NEUTRAL
    "canceled", "rejected" -> ChipTone.DANGER
    else -> ChipTone.NEUTRAL
}
