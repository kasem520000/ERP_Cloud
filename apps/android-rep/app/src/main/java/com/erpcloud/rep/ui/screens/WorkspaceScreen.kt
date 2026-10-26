@file:OptIn(ExperimentalMaterial3Api::class)

package com.erpcloud.rep.ui.screens

import android.Manifest
import android.content.Intent
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
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.SupportAgent
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
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
import com.erpcloud.rep.ui.components.InfoCallout
import com.erpcloud.rep.ui.components.KeyValue
import com.erpcloud.rep.ui.components.ListItemCard
import com.erpcloud.rep.ui.components.SearchField
import com.erpcloud.rep.ui.components.SectionCard
import com.erpcloud.rep.ui.components.StatTile
import com.erpcloud.rep.ui.components.StatusChip
import com.erpcloud.rep.util.Dec
import com.erpcloud.rep.util.MakkahTime

/**
 * شاشةُ مساحةِ عمل المندوب — كلُّ شيءٍ من `GET /van-sales/me` ولا رقمَ يُحسب محليًّا:
 * ترويسةُ هويةٍ (المندوبُ والسيارةُ والمنشأة)، شبكةُ إحصاءات، أصنافُ السيارة،
 * القوائمُ بالنوافذ، ومشاركةُ ملخصِ الورديةٍ نصًّا للإدارة.
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
    onSupport: () -> Unit,
    onReceipt: (String) -> Unit,
    onPrint: (String) -> Unit,
) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val workspace = state.workspace

    // إذنُ الإشعارات على ١٣+ — يُطلب مرّةً من مساحة العمل (قنوات الطابور والتوريد والرسائل).
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
                        Text("مساحةُ عمل المندوب", fontWeight = FontWeight.ExtraBold)
                        val sub = workspace?.salesmanName ?: state.me?.user?.fullName ?: ""
                        if (sub.isNotBlank()) {
                            Text(sub, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                },
                actions = {
                    IconButton(onClick = onSupport) {
                        Icon(Icons.Default.SupportAgent, contentDescription = "طلب المساعدة والدعم")
                    }
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
                onSupport = onSupport,
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
    onSupport: () -> Unit,
    onReceipt: (String) -> Unit,
    onPrint: (String) -> Unit,
) {
    val workspace = state.workspace ?: return
    val context = LocalContext.current
    var docFilter by rememberSaveable { mutableStateOf("all") }
    var docQuery by rememberSaveable { mutableStateOf("") }

    fun shareSummary() {
        val totals = workspace.totals
        val pending = state.scopedQueue.count { it.queueStatus == QueueStatus.PENDING }
        val summary = buildString {
            appendLine("ملخصُ وردية المندوب ${workspace.salesmanName ?: ""}")
            workspace.vehiclePlate?.takeIf { it.isNotBlank() }?.let { appendLine("السيارة: $it") }
            appendLine("—")
            appendLine("رصيدُ السيارة: ${Dec.kg(workspace.custodyKg)} كجم" +
                (workspace.custodyValue?.let { " (قيمتُه ${Dec.money(it)} ريال)" } ?: ""))
            totals?.let {
                appendLine("صافي المبيعات: ${Dec.money(it.revenue)} ريال (نقديّ ${Dec.money(it.cashSales)} · آجل ${Dec.money(it.creditSales)})")
                appendLine("المُحصَّل: ${Dec.money(it.collected)} ريال")
                appendLine("المتبقّي على العملاء: ${Dec.money(it.outstanding)} ريال")
                if (it.returnCount > 0) {
                    appendLine("المرتجعات: ${Dec.money(it.returns)} ريال (${it.returnCount} إشعارًا)")
                }
            }
            workspace.custody?.let {
                if (it.pendingClosings > 0) appendLine("⏳ إغلاقاتٌ بانتظار اعتماد المحاسب: ${it.pendingClosings}")
            }
            if (pending > 0) appendLine("⚠️ نيّاتٌ محفوظةٌ دون اتصال بانتظار الإرسال: $pending")
            appendLine("—")
            appendLine(
                "أُرسل من تطبيق المندوب — " + MakkahTime.nowSlashDateTime(),
            )
        }
        val sendIntent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, summary)
        }
        context.startActivity(
            Intent.createChooser(sendIntent, "مشاركةُ ملخص الوردية"),
        )
    }

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

            // شبكةُ الإحصاءات + تدقيقُ معادلة المجاميع (totalsReconcile كما في الويب)
            val reconcileWarning = totalsReconcile(workspace.totals)
            if (reconcileWarning != null) {
                item {
                    SectionCard(title = "تنبيهُ مطابقة المجاميع") {
                        Text(
                            reconcileWarning,
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }
            }
            item { StatsGrid(workspace) }

            // مشاركةُ الملخص + آخر تحديث
            item {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    FilledTonalButton(onClick = { shareSummary() }, modifier = Modifier.weight(1f)) {
                        Icon(Icons.Default.Share, contentDescription = null, Modifier.size(18.dp))
                        Spacer(Modifier.size(6.dp))
                        Text("مشاركةُ ملخص الوردية")
                    }
                    if (state.lastRefreshAt > 0) {
                        Text(
                            "آخرُ تحديثٍ ${MakkahTime.formatTimeHm(state.lastRefreshAt)}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            // أصنافُ السيارة (العهدة تفصيلًا) — من balances كما يرسلها الخادم.
            item {
                SectionCard(
                    title = "أصنافُ سيارتك (${workspace.balances.size})",
                    subtitle = "عهدتُك تفصيلًا من الخادم — الكميةُ والقيمةُ الرسميّتان.",
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
                                        shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
                                    ) {
                                        Text("مراجعة وتأكيد الاستلام", fontWeight = FontWeight.Bold)
                                    }
                                }
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
                                        StatusChip(statusAr(order.status), statusTone(order.status))
                                    }
                                    KeyValue("الصنف", order.itemName)
                                    KeyValue("المحمَّل / المستلَم", "${Dec.kg(order.loadedQty)} / ${Dec.kg(order.receivedQty)} كجم")
                                    KeyValue("المتبقّي المتوقّع", "${Dec.kg(order.expectedRemainingQty)} كجم")
                                    receiptShortfallText(order)?.let { shortfallMsg ->
                                        InfoCallout(shortfallMsg, ChipTone.WARN, Modifier.padding(top = 4.dp))
                                    }
                                    closingShortageText(order)?.let { shortageMsg ->
                                        InfoCallout(shortageMsg, ChipTone.DANGER, Modifier.padding(top = 4.dp))
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // المستندات — مع بحث حي وفلاتر عرض (بيع/مرتجع/عليه متبقٍّ)
            item {
                SectionCard(
                    title = "مستنداتُك (${workspace.documents.size})",
                    subtitle = windowNote(workspace.windows?.documents?.returned, workspace.windows?.documents?.total),
                ) {
                    if (workspace.documents.size >= 4) {
                        SearchField(
                            value = docQuery,
                            onValueChange = { docQuery = it },
                            placeholder = "ابحث برقم الفاتورة أو اسم العميل…",
                        )
                    }
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        FilterPill("الكل", workspace.documents.size, docFilter == "all") { docFilter = "all" }
                        FilterPill("بيع", workspace.documents.count { it.isSale }, docFilter == "sale") { docFilter = "sale" }
                        FilterPill("مرتجع", workspace.documents.count { !it.isSale }, docFilter == "return") { docFilter = "return" }
                        FilterPill(
                            "آجل",
                            workspace.documents.count { Dec.isPositive(it.outstanding) },
                            docFilter == "due",
                        ) { docFilter = "due" }
                    }
                    val filteredByKind = when (docFilter) {
                        "sale" -> workspace.documents.filter { it.isSale }
                        "return" -> workspace.documents.filter { !it.isSale }
                        "due" -> workspace.documents.filter { Dec.isPositive(it.outstanding) }
                        else -> workspace.documents
                    }
                    val visibleDocs = if (docQuery.isBlank()) filteredByKind else {
                        val needle = docQuery.trim()
                        filteredByKind.filter {
                            it.number.contains(needle, ignoreCase = true) ||
                                it.customerName.contains(needle, ignoreCase = true)
                        }
                    }
                    if (visibleDocs.isEmpty()) {
                        EmptyState(
                            if (docFilter == "all" && docQuery.isBlank()) "لا مستندات بعد."
                            else "لا مستنداتٍ تطابقُ الفلتر أو البحث.",
                        )
                    } else {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            visibleDocs.forEach { doc ->
                                ListItemCard {
                                    Row(
                                        Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Text(
                                            doc.number,
                                            style = MaterialTheme.typography.titleMedium,
                                            fontWeight = FontWeight.ExtraBold,
                                        )
                                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                            if (doc.isSale) StatusChip("بيع", ChipTone.INFO) else StatusChip("مرتجع", ChipTone.WARN)
                                            if (Dec.isPositive(doc.outstanding)) StatusChip("متبقٍّ", ChipTone.DANGER)
                                        }
                                    }
                                    KeyValue("العميل", doc.customerName)
                                    KeyValue("التاريخ", doc.docDate)
                                    KeyValue("الكميّة × السعر", "${Dec.kg(doc.soldQty)} كجم × ${Dec.money(doc.unitPrice)} ر.س")
                                    KeyValue("الإجمالي", "${Dec.money(doc.total)} ريال")
                                    if (Dec.isPositive(doc.outstanding)) {
                                        KeyValue("المتبقّي غير المسدَّد", "${Dec.money(doc.outstanding)} ريال")
                                    }
                                    Row(
                                        Modifier.fillMaxWidth().padding(top = 4.dp),
                                        horizontalArrangement = Arrangement.End,
                                    ) {
                                        OutlinedButton(
                                            onClick = { onPrint(doc.id) },
                                            shape = androidx.compose.foundation.shape.RoundedCornerShape(50),
                                        ) {
                                            Icon(Icons.Default.Print, contentDescription = null, Modifier.size(16.dp))
                                            Spacer(Modifier.size(6.dp))
                                            Text("معاينة وطباعة", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                                        }
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
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            workspace.collections.forEach { collection ->
                                ListItemCard {
                                    Row(
                                        Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Text(
                                            collection.voucherNumber ?: "سند تحصيل",
                                            style = MaterialTheme.typography.titleMedium,
                                            fontWeight = FontWeight.Bold,
                                        )
                                        StatusChip("${Dec.money(collection.amount)} ريال", ChipTone.OK)
                                    }
                                    KeyValue("التاريخ والوقت", collection.collectedAt.take(16).replace('T', ' '))
                                }
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
                    FilledTonalButton(onClick = onSupport, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                        Icon(Icons.Default.SupportAgent, contentDescription = null, Modifier.size(18.dp))
                        Spacer(Modifier.size(6.dp))
                        Text("طلب المساعدة والدعم الفني", fontWeight = FontWeight.Bold)
                    }
                    TextButton(onClick = onQueue, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Default.FactCheck, contentDescription = null, Modifier.size(18.dp))
                        Spacer(Modifier.size(6.dp))
                        Text("طابورُ النيّات (ما حُفظ دون اتصال)")
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

/** رقاقةُ فلترٍ بعددِها — فلترةُ عرضٍ محليّةٌ لا حسابَ جديد. */
@Composable
private fun FilterPill(label: String, count: Int, selected: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = androidx.compose.foundation.shape.RoundedCornerShape(50),
        color = if (selected) {
            MaterialTheme.colorScheme.secondaryContainer
        } else {
            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f)
        },
    ) {
        Text(
            "$label ($count)",
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
            color = if (selected) {
                MaterialTheme.colorScheme.onSecondaryContainer
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
        )
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
                        fontWeight = FontWeight.ExtraBold,
                    )
                    if (tenant.isNotBlank()) {
                        Text(
                            tenant,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                Surface(
                    shape = androidx.compose.foundation.shape.RoundedCornerShape(14.dp),
                    color = MaterialTheme.colorScheme.primary.copy(alpha = 0.14f),
                ) {
                    Icon(
                        Icons.Default.LocalShipping,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(10.dp).size(28.dp),
                    )
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (workspace.vehiclePlate?.isNotBlank() == true) {
                    Surface(shape = MaterialTheme.shapes.small, color = MaterialTheme.colorScheme.surface) {
                        Text(
                            "السيارةُ ${workspace.vehiclePlate}",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        )
                    }
                }
                if (!state.online) {
                    StatusChip("لا اتصال — الطابورُ يعمل", ChipTone.WARN)
                } else {
                    StatusChip("متّصل", ChipTone.OK)
                }
            }
            val pending = state.scopedQueue.count { it.queueStatus == QueueStatus.PENDING }
            val refused = state.scopedQueue.count { it.queueStatus == QueueStatus.REFUSED }
            if (pending > 0 || refused > 0) {
                Spacer(Modifier.height(6.dp))
                TextButton(onClick = onQueue) {
                    Text(
                        "الطابور: ${pending} بانتظار · ${refused} مرفوضة",
                        fontWeight = FontWeight.Bold,
                    )
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
                label = "المُحصَّل",
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
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilledTonalButton(
                onClick = onSale,
                enabled = canInvoice,
                modifier = Modifier.weight(1f),
            ) {
                Icon(Icons.Default.PointOfSale, contentDescription = null, Modifier.size(18.dp))
                Spacer(Modifier.size(6.dp))
                Text("بيعٌ جديد")
            }
            FilledTonalButton(
                onClick = onReturn,
                enabled = canInvoice,
                modifier = Modifier.weight(1f),
            ) {
                Icon(Icons.AutoMirrored.Filled.Reply, contentDescription = null, Modifier.size(18.dp))
                Spacer(Modifier.size(6.dp))
                Text("مرتجعُ عميل")
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilledTonalButton(
                onClick = onCollection,
                enabled = canCollect,
                modifier = Modifier.weight(1f),
            ) {
                Icon(Icons.Default.Payments, contentDescription = null, Modifier.size(18.dp))
                Spacer(Modifier.size(6.dp))
                Text("تحصيلُ دين")
            }
            FilledTonalButton(
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

/** فحصُ المعادلتين على أرقام الخادم (مطابقٌ لـ totalsReconcile في rep-screen.ts). */
private fun totalsReconcile(totals: com.erpcloud.rep.data.api.RepTotals?): String? {
    if (totals == null) return null
    val scale = java.math.RoundingMode.HALF_UP
    val salesGross = Dec.orZero(totals.salesGross).setScale(2, scale)
    val cashSales = Dec.orZero(totals.cashSales).setScale(2, scale)
    val creditSales = Dec.orZero(totals.creditSales).setScale(2, scale)
    val returns = Dec.orZero(totals.returns).setScale(2, scale)
    val returnsVat = Dec.orZero(totals.returnsVat).setScale(2, scale)
    val revenue = Dec.orZero(totals.revenue).setScale(2, scale)

    val byGross = salesGross.subtract(returns).subtract(returnsVat)
    val byTender = cashSales.add(creditSales).subtract(returns).subtract(returnsVat)
    if (byGross.compareTo(revenue) != 0 || byTender.compareTo(revenue) != 0) {
        return "أرقامُ الخادم لا تُغلق المعادلة: الإيرادُ ${revenue.toPlainString()} بينما إجماليُّ المبيعات ناقصًا المرتجعات وضريبتَها ${byGross.toPlainString()} ونقديّ + آجل ناقصًا المرتجعات ${byTender.toPlainString()} — راجع المحاسب."
    }
    return null
}

private fun receiptShortfallText(row: com.erpcloud.rep.data.api.RepLoadOrderRow): String? {
    if (!Dec.isPositive(row.discrepancyQty)) return null
    val pending = row.stockSettlementStatus == "pending_transit_decision"
    val suffix = when {
        pending -> " — فرقٌ بانتظار قرار المحاسب، ولا يُشطب تلقائيًّا."
        row.stockSettlementNote.isNotBlank() -> " — قرار المحاسب: ${row.stockSettlementNote}"
        else -> "."
    }
    return "نقصٌ عند الاستلام ${Dec.kg(row.discrepancyQty)} كجم (المحمَّل ${Dec.kg(row.loadedQty)} − المستلَم ${Dec.kg(row.receivedQty)})$suffix"
}

private fun closingShortageText(row: com.erpcloud.rep.data.api.RepLoadOrderRow): String? {
    if (!Dec.isPositive(row.shortageQty)) return null
    val tail = if (!row.approvedAt.isNullOrBlank()) {
        val note = if (row.stockSettlementNote.isNotBlank()) " — قرار المحاسب: ${row.stockSettlementNote}" else ""
        "اعتُمد$note."
    } else {
        "بانتظار اعتماد المحاسب — لا يُشطب تلقائيًّا."
    }
    return "عجزٌ مُعلن ${Dec.kg(row.shortageQty)} كجم بقيمة ${Dec.money(row.shortageValue)} ريال — $tail"
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
