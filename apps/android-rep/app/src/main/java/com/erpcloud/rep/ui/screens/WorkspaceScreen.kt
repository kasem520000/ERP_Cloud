@file:OptIn(ExperimentalMaterial3Api::class)

package com.erpcloud.rep.ui.screens

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.ReceiptLong
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.FactCheck
import androidx.compose.material.icons.filled.LocalShipping
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Password
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.PointOfSale
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.SupportAgent
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.erpcloud.rep.data.api.RepTotals
import com.erpcloud.rep.data.api.RepWorkspace
import com.erpcloud.rep.data.offline.QueueStatus
import com.erpcloud.rep.platform.AppNotifier
import com.erpcloud.rep.ui.AppViewModel
import com.erpcloud.rep.ui.UiState
import com.erpcloud.rep.ui.components.BadgeCount
import com.erpcloud.rep.ui.components.CenterLoading
import com.erpcloud.rep.ui.components.ChipTone
import com.erpcloud.rep.ui.components.SectionCard
import com.erpcloud.rep.ui.components.StatTile
import com.erpcloud.rep.ui.components.StatusChip
import com.erpcloud.rep.ui.theme.RepColors
import com.erpcloud.rep.util.Dec
import com.erpcloud.rep.util.MakkahTime

/**
 * شاشةُ لوحة الوردية الرئيسية للمندوب — مركّزةٌ على الملخص المالي والمخزني الرسمي،
 * تنبيهات التوريدات العاجلة، وبوّابات الانتقال السريع إلى شاشات التطبيق المقسَّمة عبر القائمة الجانبية.
 */
@Composable
fun WorkspaceScreen(
    vm: AppViewModel,
    onMenu: () -> Unit,
    onSale: () -> Unit,
    onReturn: () -> Unit,
    onCollection: () -> Unit,
    onClosing: () -> Unit,
    onCustody: (initialTab: String) -> Unit,
    onDocuments: () -> Unit,
    onQueue: () -> Unit,
    onPrinters: () -> Unit,
    onNotifications: () -> Unit,
    onChangePassword: () -> Unit,
    onSupport: () -> Unit,
) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val workspace = state.workspace

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { }
    LaunchedEffect(Unit) {
        AppNotifier.ensureChannels(context)
        if (
            Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onMenu) {
                        Icon(Icons.Default.Menu, contentDescription = "فتح القائمة الجانبية")
                    }
                },
                title = {
                    Column {
                        Text(
                            "ملخصُ الوردية",
                            fontWeight = FontWeight.ExtraBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        val sub = workspace?.salesmanName ?: state.me?.user?.fullName ?: ""
                        if (sub.isNotBlank()) {
                            Text(
                                sub,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                },
                actions = {
                    IconButton(onClick = onSupport) {
                        Icon(Icons.Default.SupportAgent, contentDescription = "طلب المساعدة والدعم")
                    }
                    IconButton(onClick = onNotifications) {
                        BadgedBox(badge = { BadgeCount(state.workspaceUnread) }) {
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
            workspace == null -> Column(
                Modifier.padding(padding).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    state.workspaceError ?: "لا بيانات بعد — اضغط زرَّ التحديث.",
                    color = MaterialTheme.colorScheme.error,
                )
                Button(
                    onClick = { vm.refreshAll() },
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                    shape = RoundedCornerShape(14.dp),
                ) {
                    Text("إعادة المحاولة", fontWeight = FontWeight.Bold)
                }
            }
            else -> WorkspaceDashboardBody(
                state = state,
                padding = padding,
                onSale = onSale,
                onReturn = onReturn,
                onCollection = onCollection,
                onClosing = onClosing,
                onCustody = onCustody,
                onDocuments = onDocuments,
                onQueue = onQueue,
                onPrinters = onPrinters,
                onChangePassword = onChangePassword,
                onSupport = onSupport,
            )
        }
    }
}

@Composable
private fun WorkspaceDashboardBody(
    state: UiState,
    padding: PaddingValues,
    onSale: () -> Unit,
    onReturn: () -> Unit,
    onCollection: () -> Unit,
    onClosing: () -> Unit,
    onCustody: (initialTab: String) -> Unit,
    onDocuments: () -> Unit,
    onQueue: () -> Unit,
    onPrinters: () -> Unit,
    onChangePassword: () -> Unit,
    onSupport: () -> Unit,
) {
    val workspace = state.workspace ?: return
    val context = LocalContext.current
    val pendingQueueCount = state.scopedQueue.count { it.queueStatus == QueueStatus.PENDING }
    val refusedQueueCount = state.scopedQueue.count { it.queueStatus == QueueStatus.REFUSED }
    val unpaidCount = workspace.documents.count { Dec.isPositive(it.outstanding) }

    fun shareSummary() {
        val totals = workspace.totals
        val summary = buildString {
            appendLine("ملخصُ وردية المندوب ${workspace.salesmanName ?: ""}")
            workspace.vehiclePlate?.takeIf { it.isNotBlank() }?.let { appendLine("السيارة: $it") }
            appendLine("—")
            appendLine(
                "رصيدُ السيارة: ${Dec.kg(workspace.custodyKg)} كجم" +
                    (workspace.custodyValue?.let { " (قيمتُه ${Dec.money(it)} ريال)" } ?: ""),
            )
            totals?.let {
                appendLine(
                    "صافي المبيعات: ${Dec.money(it.revenue)} ريال (نقديّ ${Dec.money(it.cashSales)} · آجل ${Dec.money(it.creditSales)})",
                )
                appendLine("المُحصَّل: ${Dec.money(it.collected)} ريال")
                appendLine("المتبقّي على العملاء: ${Dec.money(it.outstanding)} ريال")
                if (it.returnCount > 0) {
                    appendLine("المرتجعات: ${Dec.money(it.returns)} ريال (${it.returnCount} إشعارًا)")
                }
            }
            workspace.custody?.let {
                if (it.pendingClosings > 0) appendLine("⏳ إغلاقاتٌ بانتظار اعتماد المحاسب: ${it.pendingClosings}")
            }
            if (pendingQueueCount > 0) {
                appendLine("⚠️ نيّاتٌ محفوظةٌ دون اتصال بانتظار الإرسال: $pendingQueueCount")
            }
            appendLine("—")
            appendLine("أُرسل من تطبيق المندوب — " + MakkahTime.nowSlashDateTime())
        }
        val sendIntent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, summary)
        }
        context.startActivity(Intent.createChooser(sendIntent, "مشاركةُ ملخص الوردية"))
    }

    LazyColumn(
        Modifier.fillMaxSize().padding(padding).padding(horizontal = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (!workspace.isRep) {
            item {
                SectionCard(title = "لا بطاقةَ مندوب") {
                    Text(workspace.message ?: "حسابُك غير مرتبطٍ ببطاقة مندوب توزيع.")
                }
            }
        } else {
            item { IdentityHeader(state, onQueue) }

            if (state.mustChangePassword) {
                item {
                    SectionCard(title = "مطلوبٌ تغييرُ كلمة المرور") {
                        Text(
                            "علّم الخادمُ حسابَك mustChangePassword — غيّر كلمتك الآن لتأمين الحساب.",
                            color = MaterialTheme.colorScheme.error,
                        )
                        OutlinedButton(
                            onClick = onChangePassword,
                            modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                        ) {
                            Icon(Icons.Default.Password, contentDescription = null, Modifier.size(18.dp))
                            Spacer(Modifier.size(6.dp))
                            Text("تغييرُ كلمة المرور")
                        }
                    }
                }
            }

            if (workspace.pendingReceipts.isNotEmpty()) {
                item {
                    Surface(
                        onClick = { onCustody("receipts") },
                        shape = RoundedCornerShape(18.dp),
                        color = RepColors.WarnBg,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Row(
                            Modifier.fillMaxWidth().padding(14.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Row(
                                Modifier.weight(1f),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                Icon(
                                    Icons.Default.LocalShipping,
                                    contentDescription = null,
                                    tint = RepColors.Warn,
                                    modifier = Modifier.size(26.dp),
                                )
                                Column {
                                    Text(
                                        "لديك ${workspace.pendingReceipts.size} توريد بانتظار تأكيد استلامك",
                                        style = MaterialTheme.typography.titleSmall,
                                        fontWeight = FontWeight.ExtraBold,
                                        color = RepColors.Warn,
                                    )
                                    Text(
                                        "اضغط لمراجعة الكميات المحمّلة وتأكيد دخولها لعهدتك.",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = RepColors.Warn,
                                    )
                                }
                            }
                            FilledTonalButton(
                                onClick = { onCustody("receipts") },
                                shape = RoundedCornerShape(12.dp),
                            ) {
                                Text("استلام", fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }

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

            item {
                SectionCard(
                    title = "بوّابات العمل الميداني",
                    subtitle = "اختر العملية مباشرةً أو تنقّل بين الأقسام من القائمة الجانبية (☰).",
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            QuickLaunchCard(
                                title = "بيعٌ جديد",
                                subtitle = "فاتورة نقدي أو آجل وطباعة فورية",
                                icon = Icons.Default.PointOfSale,
                                accent = RepColors.Primary,
                                primary = true,
                                enabled = state.can("van_sales.invoice.create"),
                                onClick = onSale,
                                modifier = Modifier.weight(1f),
                            )
                            QuickLaunchCard(
                                title = "العهدة والتوريدات",
                                subtitle = "${workspace.balances.size} صنف · ${workspace.loadOrders.size} أمر",
                                icon = Icons.Default.LocalShipping,
                                accent = RepColors.Info,
                                badge = workspace.pendingReceipts.size,
                                onClick = {
                                    onCustody(if (workspace.pendingReceipts.isNotEmpty()) "receipts" else "balances")
                                },
                                modifier = Modifier.weight(1f),
                            )
                        }

                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            QuickLaunchCard(
                                title = "تحصيلُ دين",
                                subtitle = if (unpaidCount > 0) "$unpaidCount فاتورة آجلة مفتوحة" else "سندات قبض العملاء",
                                icon = Icons.Default.Payments,
                                accent = RepColors.Ok,
                                badge = unpaidCount,
                                enabled = state.can("van_sales.collection.create"),
                                onClick = onCollection,
                                modifier = Modifier.weight(1f),
                            )
                            QuickLaunchCard(
                                title = "مرتجعُ عميل",
                                subtitle = "إشعار دائن مرتبط بالفاتورة الأصل",
                                icon = Icons.AutoMirrored.Filled.Reply,
                                accent = RepColors.Warn,
                                enabled = state.can("van_sales.invoice.create"),
                                onClick = onReturn,
                                modifier = Modifier.weight(1f),
                            )
                        }

                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            QuickLaunchCard(
                                title = "الفواتير والطباعة",
                                subtitle = "${workspace.documents.size} مستند · ${workspace.collections.size} تحصيل",
                                icon = Icons.AutoMirrored.Filled.ReceiptLong,
                                accent = MaterialTheme.colorScheme.primary,
                                onClick = onDocuments,
                                modifier = Modifier.weight(1f),
                            )
                            QuickLaunchCard(
                                title = "إغلاقُ الوردية",
                                subtitle = "جرد البضاعة المتبقية وتصفية العهدة",
                                icon = Icons.Default.FactCheck,
                                accent = RepColors.Info,
                                enabled = state.can("van_sales.closing.submit"),
                                onClick = onClosing,
                                modifier = Modifier.weight(1f),
                            )
                        }

                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            QuickLaunchCard(
                                title = "طابور عدم الاتصال",
                                subtitle = if (pendingQueueCount + refusedQueueCount > 0) {
                                    "$pendingQueueCount بانتظار · $refusedQueueCount مرفوضة"
                                } else {
                                    "متزامن بالكامل مع الخادم"
                                },
                                icon = Icons.Default.Sync,
                                accent = if (refusedQueueCount > 0) RepColors.Danger else RepColors.Info,
                                badge = pendingQueueCount + refusedQueueCount,
                                onClick = onQueue,
                                modifier = Modifier.weight(1f),
                            )
                            QuickLaunchCard(
                                title = "الطابعات الحرارية",
                                subtitle = "إعداد طابعة البلوتوث والنسختين",
                                icon = Icons.Default.Print,
                                accent = MaterialTheme.colorScheme.secondary,
                                onClick = onPrinters,
                                modifier = Modifier.weight(1f),
                            )
                        }

                        FilledTonalButton(
                            onClick = onSupport,
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                        ) {
                            Icon(Icons.Default.SupportAgent, contentDescription = null, Modifier.size(18.dp))
                            Spacer(Modifier.size(6.dp))
                            Text("طلب المساعدة والدعم الفني", fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }

            item { Spacer(Modifier.height(20.dp)) }
        }
    }
}

@Composable
private fun QuickLaunchCard(
    title: String,
    subtitle: String,
    icon: ImageVector,
    accent: Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    badge: Int = 0,
    primary: Boolean = false,
    enabled: Boolean = true,
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        shape = RoundedCornerShape(16.dp),
        color = when {
            !enabled -> MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.25f)
            primary -> MaterialTheme.colorScheme.primaryContainer
            else -> MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.48f)
        },
        tonalElevation = if (primary && enabled) 2.dp else 0.dp,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier = Modifier
                        .size(38.dp)
                        .clip(RoundedCornerShape(11.dp))
                        .background(accent.copy(alpha = if (enabled) 0.16f else 0.08f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        icon,
                        contentDescription = null,
                        tint = if (enabled) accent else MaterialTheme.colorScheme.outline,
                        modifier = Modifier.size(20.dp),
                    )
                }
                if (badge > 0) {
                    BadgeCount(badge)
                }
            }
            Text(
                title,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.ExtraBold,
                color = when {
                    !enabled -> MaterialTheme.colorScheme.outline
                    primary -> MaterialTheme.colorScheme.onPrimaryContainer
                    else -> MaterialTheme.colorScheme.onSurface
                },
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = when {
                    !enabled -> MaterialTheme.colorScheme.outline
                    primary -> MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.82f)
                    else -> MaterialTheme.colorScheme.onSurfaceVariant
                },
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** ترويسةُ الهويّة — المندوبُ والسيارةُ والمنشأةُ وحالةُ الاتصال والطابور. */
@Composable
private fun IdentityHeader(state: UiState, onQueue: () -> Unit) {
    val workspace = state.workspace ?: return
    val tenant = state.me?.membership?.tenantName ?: ""
    Surface(
        shape = MaterialTheme.shapes.extraLarge,
        color = MaterialTheme.colorScheme.primaryContainer,
        modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
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
                    shape = RoundedCornerShape(14.dp),
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
                        "الطابور: $pending بانتظار · $refused مرفوضة",
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
    }
}

/** شبكةُ الإحصاءات ٢×٢ — العهدةُ والإيرادُ والمحصَّلُ والمتبقّي، كلُّها من الخادم. */
@Composable
private fun StatsGrid(workspace: RepWorkspace) {
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
                icon = Icons.AutoMirrored.Filled.ReceiptLong,
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

/** فحصُ المعادلتين على أرقام الخادم (مطابقٌ لـ totalsReconcile في rep-screen.ts). */
private fun totalsReconcile(totals: RepTotals?): String? {
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
