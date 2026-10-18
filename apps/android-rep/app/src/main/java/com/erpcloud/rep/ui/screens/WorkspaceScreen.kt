@file:OptIn(ExperimentalMaterial3Api::class)

package com.erpcloud.rep.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.FactCheck
import androidx.compose.material.icons.filled.LocalShipping
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Password
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.PointOfSale
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.erpcloud.rep.data.offline.QueueStatus
import com.erpcloud.rep.platform.AppNotifier
import com.erpcloud.rep.ui.AppViewModel
import com.erpcloud.rep.ui.components.BadgeCount
import com.erpcloud.rep.ui.components.CenterLoading
import com.erpcloud.rep.ui.components.ChipTone
import com.erpcloud.rep.ui.components.EmptyState
import com.erpcloud.rep.ui.components.KeyValue
import com.erpcloud.rep.ui.components.SectionCard
import com.erpcloud.rep.ui.components.StatTile
import com.erpcloud.rep.ui.components.StatusChip
import com.erpcloud.rep.util.Dec

/**
 * شاشةُ مساحةِ عمل المندوب — كلُّ شيءٍ من `GET /van-sales/me` ولا رقمَ يُحسب محليًّا:
 * ترويسةُ هويةٍ (المندوبُ والسيارةُ والمنشأة)، شبكةُ إحصاءات، ثمّ القوائمُ بالنوافذ.
 */
@Composable
fun WorkspaceScreen(
    vm: AppViewModel,
    onSale: () -> Unit,
    onReturn: () -> Unit,
    onCollection: () -> Unit,
    onClosing: () -> Unit,
    onQueue: () -> Unit,
    onPrinters: () -> Unit,
    onNotifications: () -> Unit,
    onChangePassword: () -> Unit,
    onReceipt: (String) -> Unit,
    onPrint: (String) -> Unit,
) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val workspace = state.workspace

    // إذنُ الإشعارات على ١٣+ — يُطلب مرّةً من مساحة العمل (قناتا الطابور والتوريد).
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }
    LaunchedEffect(Unit) {
        AppNotifier.ensureChannels(context)
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("مساحةُ عمل المندوب", fontWeight = FontWeight.Bold)
                        val sub = workspace?.salesmanName ?: state.me?.user?.fullName ?: ""
                        if (sub.isNotBlank()) {
                            Text(sub, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                },
                actions = {
                    IconButton(onClick = onNotifications) {
                        BadgedBox(
                            badge = { BadgeCount(state.workspaceUnread) }
                        ) {
                            Icon(Icons.Default.Notifications, contentDescription = "الإشعارات")
                        }
                    }
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
                onChangePassword = onChangePassword,
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
    onChangePassword: () -> Unit,
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
            // ترويسةُ الهويّة
            item { IdentityHeader(state, onQueue) }

            // الخادمُ يطلبُ تغييرَ كلمة المرور؟
            if (state.mustChangePassword) {
                item {
                    SectionCard(title = "مطلوبٌ تغييرُ كلمة المرور") {
                        Text(
                            "علّم الخادمُ حسابَك mustChangePassword — غيّر كلمتك الآن لتأمين الحساب.",
                            color = MaterialTheme.colorScheme.error,
                        )
                        OutlinedButton(onClick = onChangePassword, modifier = Modifier.fillMaxWidth().padding(top = 6.dp)) {
                            Icon(Icons.Default.Password, contentDescription = null, Modifier.size(18.dp))
                            Spacer(Modifier.size(6.dp))
                            Text("تغييرُ كلمة المرور")
                        }
                    }
                }
            }

            // شبكةُ الإحصاءات
            item { StatsGrid(workspace) }

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

            // الحسابُ والإعدادات
            item {
                SectionCard(title = "الحساب") {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = onChangePassword, modifier = Modifier.weight(1f)) {
                            Icon(Icons.Default.Password, contentDescription = null, Modifier.size(18.dp))
                            Spacer(Modifier.size(6.dp))
                            Text("تغييرُ كلمة المرور")
                        }
                        OutlinedButton(onClick = onPrinters, modifier = Modifier.weight(1f)) {
                            Icon(Icons.Default.Print, contentDescription = null, Modifier.size(18.dp))
                            Spacer(Modifier.size(6.dp))
                            Text("الطابعات")
                        }
                    }
                    Text(
                        "بياناتُ الدخول المحفوظة والبصمة مُدارة من شاشة الدخول (نسيانُ الحساب).",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            item { Spacer(Modifier.height(20.dp)) }
        }
    }
}

/** ترويسةُ الهويّة — المندوبُ والسيارةُ والمنشأةُ وحالةُ الاتصال والطابور. */
@Composable
private fun IdentityHeader(state: com.erpcloud.rep.ui.UiState, onQueue: () -> Unit) {
    val workspace = state.workspace ?: return
    val tenant = state.me?.membership?.tenantName ?: ""
    Surface(
        shape = MaterialTheme.shapes.extraLarge,
        color = MaterialTheme.colorScheme.primaryContainer,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        workspace.salesmanName ?: "مندوب التوزيع",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                    )
                    if (tenant.isNotBlank()) {
                        Text(
                            tenant,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                Icon(
                    Icons.Default.LocalShipping,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(40.dp),
                )
            }
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (workspace.vehiclePlate?.isNotBlank() == true) {
                    Surface(shape = MaterialTheme.shapes.small, color = MaterialTheme.colorScheme.surface) {
                        Text(
                            "السيارةُ ${workspace.vehiclePlate}",
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        )
                    }
                }
                if (!state.online) {
                    StatusChip("لا اتصال — البيعُ والمرتجعُ والتحصيلُ تُحفظ في الطابور", ChipTone.WARN)
                } else {
                    StatusChip("متّصل", ChipTone.OK)
                }
                val pending = state.queue.count { it.queueStatus == QueueStatus.PENDING }
                val refused = state.queue.count { it.queueStatus == QueueStatus.REFUSED }
                if (pending > 0 || refused > 0) {
                    TextButton(onClick = onQueue) {
                        Text("الطابور: ${pending} بانتظار · ${refused} مرفوضة")
                    }
                }
            }
        }
    }
}

/** شبكةُ الإحصاءات ٢×٢ — العهدةُ والإيرادُ والمحصَّلُ والمتبقّي، كلُّها من الخادم. */
@Composable
private fun StatsGrid(workspace: com.erpcloud.rep.data.api.RepWorkspace) {
    val totals = workspace.totals
    val custody = workspace.custody
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatTile(
                label = "رصيدُ سيارتك",
                value = "${Dec.kg(workspace.custodyKg)} كجم",
                sub = workspace.custodyValue?.let { "قيمتُه ${Dec.money(it)} ريال" },
                icon = Icons.Default.LocalShipping,
                modifier = Modifier.weight(1f),
            )
            StatTile(
                label = "صافي مبيعاتك",
                value = if (totals != null) "${Dec.money(totals.revenue)} ريال" else "—",
                sub = totals?.let { "نقديّ ${Dec.money(it.cashSales)} · آجل ${Dec.money(it.creditSales)}" },
                icon = Icons.Default.TrendingUp,
                tone = ChipTone.INFO,
                modifier = Modifier.weight(1f),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatTile(
                label = "المحصَّل",
                value = if (totals != null) "${Dec.money(totals.collected)} ريال" else "—",
                sub = totals?.let {
                    if (it.returnCount > 0) "بعد ${it.returnCount} إشعارٍ دائنٍ لمرتجعاتك" else null
                },
                icon = Icons.Default.AccountBalanceWallet,
                tone = ChipTone.OK,
                modifier = Modifier.weight(1f),
            )
            StatTile(
                label = "المتبقّي على العملاء",
                value = if (totals != null) "${Dec.money(totals.outstanding)} ريال" else "—",
                sub = custody?.let {
                    if (it.pendingClosings > 0) "⏳ ${it.pendingClosings} إغلاقٌ بانتظار المحاسب" else null
                },
                icon = Icons.Default.ReceiptLong,
                tone = if ((custody?.pendingClosings ?: 0) > 0) ChipTone.WARN else ChipTone.NEUTRAL,
                modifier = Modifier.weight(1f),
            )
        }
        if (totals != null && totals.returnCount > 0) {
            Text(
                "مرتجعاتُك ${Dec.money(totals.returns)} ريال وضريبتُها ${Dec.money(totals.returnsVat)} — " +
                    "خُصمت من المجاميع أعلاه.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
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
            OutlinedButton(
                onClick = onSale,
                enabled = canInvoice,
                modifier = Modifier.weight(1f),
            ) {
                Icon(Icons.Default.PointOfSale, contentDescription = null, Modifier.size(18.dp))
                Spacer(Modifier.size(6.dp))
                Text("بيعٌ جديد")
            }
            OutlinedButton(
                onClick = onReturn,
                enabled = canInvoice,
                modifier = Modifier.weight(1f),
            ) {
                Icon(Icons.AutoMirrored.Filled.Reply, contentDescription = null, Modifier.size(18.dp))
                Spacer(Modifier.size(6.dp))
                Text("مرتجعُ عميل")
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            OutlinedButton(
                onClick = onCollection,
                enabled = canCollect,
                modifier = Modifier.weight(1f),
            ) {
                Icon(Icons.Default.Payments, contentDescription = null, Modifier.size(18.dp))
                Spacer(Modifier.size(6.dp))
                Text("تحصيلُ دين")
            }
            OutlinedButton(
                onClick = onClosing,
                enabled = canClose,
                modifier = Modifier.weight(1f),
            ) {
                Icon(Icons.Default.FactCheck, contentDescription = null, Modifier.size(18.dp))
                Spacer(Modifier.size(6.dp))
                Text("إغلاقُ الوردية")
            }
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

