package com.erpcloud.bakery.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.outlined.BakeryDining
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.LocalShipping
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material.icons.outlined.Print
import androidx.compose.material.icons.outlined.PriceCheck
import androidx.compose.material.icons.outlined.ReceiptLong
import androidx.compose.material.icons.outlined.Sell
import androidx.compose.material.icons.outlined.Speed
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material.icons.outlined.WorkHistory
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.BadgeCount
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.MiniBarChart
import com.erpcloud.bakery.ui.components.ShareBarRow
import com.erpcloud.bakery.ui.components.dayLabelAr
import com.erpcloud.bakery.ui.components.EmptyState
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.components.StatTile
import com.erpcloud.bakery.ui.components.StatusChip
import com.erpcloud.bakery.ui.theme.BakeryColors
import com.erpcloud.bakery.util.Dec

/**
 * الشاشةُ الرئيسيّة — لوحةُ القيادة وعنوانُ التوجيه إلى شاشات الإدارة كلّها.
 * الأرقامُ كلُّها من `GET /van-sales/dashboard` (نصوصٌ من الخادم، تُعرض ولا
 * تُحسب)، وشاراتُ الانتظار (استلام/إقفال/تسوية/قرار عبور) هي صراخُ اليوم:
 * ما يحتاجُ قرارك الآن.
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
    vm: AppViewModel,
    onMenu: () -> Unit = {},
    onProduction: () -> Unit,
    onDistribution: () -> Unit,
    onCustody: () -> Unit,
    onSalesmen: () -> Unit,
    onCollection: () -> Unit,
    onPrices: () -> Unit,
    onReports: () -> Unit,
    onPolicy: () -> Unit,
    onPrinters: () -> Unit,
    onNotifications: () -> Unit,
    onChangePassword: () -> Unit,
    onLogout: () -> Unit,
) {
    val state by vm.uiState.collectAsState()
    val dash = state.dashboard
    val summary = dash?.summary

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("إدارة المخابز") },
                navigationIcon = {
                    IconButton(onClick = onMenu) {
                        Icon(Icons.Default.Menu, contentDescription = "قائمة الوحدات")
                    }
                },
                actions = {
                    IconButton(onClick = { vm.bootstrap() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "تحديث البيانات")
                    }
                    if (state.can("tenant.notification.view")) {
                        IconButton(onClick = onNotifications) {
                            BadgeCount(count = state.notificationsUnread)
                            Icon(Icons.Default.Notifications, contentDescription = "الإشعارات")
                        }
                    }
                    IconButton(onClick = onLogout) {
                        Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = "خروج")
                    }
                },
            )
        },
    ) { padding ->
        if (state.loadingDashboard && dash == null) {
            CenterLoading("جارٍ تحميل لوحة القيادة…", Modifier.padding(padding))
            return@Scaffold
        }
        if (dash == null) {
            EmptyState(
                state.dashboardError ?: "لا لوحة بعد — اسحب للتحديث أو أعد المحاولة.",
                Modifier.padding(padding),
            )
            return@Scaffold
        }

        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            // ------------------------------------------------ هوية وانقطاع
            item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(2) }) {
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            state.me?.user?.fullName ?: state.me?.user?.email ?: "",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            state.me?.membership?.tenantName ?: "",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (!state.online) {
                        Spacer(Modifier.height(6.dp))
                        StatusChip("وضعُ عدم الاتصال — تُعرض آخرُ بياناتٍ محفوظة، والكتاباتُ تنتظرُ عودةَ الشبكة", ChipTone.WARN)
                    }
                    if (state.mustChangePassword) {
                        Spacer(Modifier.height(6.dp))
                        StatusChip("الخادمُ يطلب تغييرَ كلمة مرورك", ChipTone.WARN)
                        OutlinedButton(onClick = onChangePassword) { Text("تغيير كلمة المرور الآن") }
                    }
                }
            }

            // ------------------------------------------------ رسم مبيعات الأسبوع
            item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(2) }) {
                val daily = remember(dash?.documents) {
                    val docs = dash?.documents.orEmpty()
                        .filter { it.documentKind != "sale_return" }
                    docs.groupBy { it.docDate.take(10) }
                        .map { (day, list) ->
                            day to list.sumOf { Dec.parse(it.total)?.toDouble() ?: 0.0 }
                        }
                        .sortedBy { it.first }
                        .takeLast(7)
                        .map { (day, total) -> dayLabelAr(day) to total.toFloat() }
                }
                if (daily.size >= 2) {
                    SectionCard(title = "مبيعاتُ آخر ${daily.size} أيّام", subtitle = "من مستندات البيع في نافذة اللوحة (ر.س)") {
                        MiniBarChart(points = daily, formatValue = { String.format(java.util.Locale.US, "%.0f", it) })
                    }
                }
            }

            // ------------------------------------------------ توزيع الإيراد
            item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(2) }) {
                val docs = dash?.documents.orEmpty()
                val revenue = Dec.parse(summary?.totalRevenueSar)?.toDouble() ?: 0.0
                if (revenue > 0 && docs.isNotEmpty()) {
                    fun share(method: String) =
                        docs.filter { it.paymentMethod == method }.sumOf { Dec.parse(it.total)?.toDouble() ?: 0.0 }
                    val cash = share("cash")
                    val card = share("card")
                    val credit = share("credit")
                    SectionCard(title = "توزيعُ الإيراد حسب الدفع", subtitle = "من مستندات نافذة اللوحة") {
                        ShareBarRow("نقديّ", Dec.money(cash.toBigDecimal().toPlainString()) + " ر.س", (cash / revenue).toFloat(), BakeryColors.Ok)
                        ShareBarRow("شبكة", Dec.money(card.toBigDecimal().toPlainString()) + " ر.س", (card / revenue).toFloat(), BakeryColors.Info)
                        ShareBarRow("آجل", Dec.money(credit.toBigDecimal().toPlainString()) + " ر.س", (credit / revenue).toFloat(), BakeryColors.Warn)
                    }
                }
            }

            // ------------------------------------------------ إحصاءات اليوم
            item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(2) }) {
                SectionCard(title = "صورة المنشأة الآن", subtitle = "أرقامٌ رسميّةٌ من الخادم — لا تُحسب في الجهاز") {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        StatTile("الإنتاج (كجم)", Dec.kg(summary?.totalProducedKg))
                        StatTile("المُحمَّل (كجم)", Dec.kg(summary?.totalLoadedKg))
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        StatTile("المبيع (كجم)", Dec.kg(summary?.totalSoldKg))
                        StatTile("المتبقّي بالسيارات", Dec.kg(summary?.remainingInVansKg))
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        StatTile("الإيراد (ر.س)", Dec.money(summary?.totalRevenueSar))
                        StatTile("المُحصَّل نقدًا", Dec.money(summary?.totalCollectedCashSar), tone = ChipTone.OK)
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        StatTile("ذممٌ آجلة", Dec.money(summary?.totalCreditReceivablesSar), tone = ChipTone.WARN)
                        StatTile("صافي الربح", Dec.money(summary?.totalNetProfitSar))
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        StatTile("رصيدُ الرئيسيّ (كجم)", Dec.kg(summary?.mainWarehouseBalanceKg))
                        StatTile("على الطريق", Dec.kg(summary?.inTransitKg), sub = "${summary?.inTransitTransfersCount ?: 0} مناقلةً")
                    }
                    if (summary?.stockLedgerAgrees == false) {
                        Spacer(Modifier.height(8.dp))
                        StatusChip(
                            "رصيدُ المستودع الرئيسيّ (${Dec.kg(summary.mainWarehouseBalanceKg)} كجم) يخالف المشتق من السجلات (${Dec.kg(summary.derivedMainWarehouseBalanceKg)} كجم)",
                            ChipTone.DANGER,
                        )
                    }
                    val posting = dash.postingReadiness
                    if (posting != null && !posting.salesInvoice) {
                        Spacer(Modifier.height(8.dp))
                        StatusChip(posting.message ?: "ملفُّ الترحيل المحاسبيّ غير مكتمل", ChipTone.WARN)
                    }
                }
            }

            // ------------------------------------------------ ما يحتاج قرارك
            item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(2) }) {
                SectionCard(title = "ما يحتاجُ قرارك الآن") {
                    val pending = listOf(
                        "بانتظار استلام المندوبين" to (summary?.pendingReceiptsCount ?: 0),
                        "بانتظار إقفال الورديات" to (summary?.pendingClosingsCount ?: 0),
                        "بانتظار تسوية المخزون" to (summary?.pendingStockSettlementsCount ?: 0),
                        "قراراتُ فرق العبور" to (summary?.pendingTransitDecisionsCount ?: 0),
                    )
                    var anyPending = false
                    pending.forEach { (label, count) ->
                        if (count > 0) {
                            anyPending = true
                            Row(
                                Modifier.fillMaxWidth().padding(vertical = 3.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(label, style = MaterialTheme.typography.bodyLarge)
                                BadgeCount(count = count)
                            }
                        }
                    }
                    if ((summary?.anomalyCount ?: 0) > 0) {
                        anyPending = true
                        Row(
                            Modifier.fillMaxWidth().padding(vertical = 3.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text("حوادثُ بونصٍ مخالفة", style = MaterialTheme.typography.bodyLarge)
                            BadgeCount(count = summary?.anomalyCount ?: 0)
                        }
                    }
                    if (!anyPending) {
                        Text("لا شيءَ ينتظر قرارك — كلُّ الورديات نظيفة.", style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }

            // ------------------------------------------------ التوجيه
            item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(2) }) {
                Text("الشاشات", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            }

            val canView = state.can("van_sales.view")
            val tiles = buildList {
                if (canView) {
                    add(Tile("الإنتاج", Icons.Outlined.BakeryDining, onProduction))
                    add(Tile("التوزيع والتحميل", Icons.Outlined.LocalShipping, onDistribution))
                    add(Tile("العهدة والإقفال", Icons.Outlined.WorkHistory, onCustody, badge = (summary?.pendingClosingsCount ?: 0) + (summary?.pendingStockSettlementsCount ?: 0) + (summary?.pendingTransitDecisionsCount ?: 0)))
                    add(Tile("المناديب", Icons.Outlined.Sell, onSalesmen))
                    add(Tile("التحصيل", Icons.Outlined.Payments, onCollection, badge = summary?.pendingReceiptsCount ?: 0))
                    add(Tile("أسعارُ العملاء", Icons.Outlined.PriceCheck, onPrices))
                    add(Tile("تقاريرُ الفترة", Icons.Outlined.ReceiptLong, onReports))
                    add(Tile("سياسةُ العجز", Icons.Outlined.Verified, onPolicy))
                    add(Tile("المستنداتُ والحركات", Icons.Outlined.Inventory2, onCollection))
                }
                add(Tile("الطابعات", Icons.Outlined.Print, onPrinters))
                add(Tile("تغييرُ كلمة المرور", Icons.Outlined.Speed, onChangePassword))
            }
            items(tiles) { tile ->
                Surface(
                    shape = MaterialTheme.shapes.large,
                    color = MaterialTheme.colorScheme.surface,
                    tonalElevation = 1.dp,
                    onClick = tile.onClick,
                ) {
                    Column(Modifier.padding(14.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(tile.icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                            Spacer(Modifier.width(8.dp))
                            Text(tile.label, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                        }
                        if (tile.badge > 0) {
                            Spacer(Modifier.height(6.dp))
                            BadgeCount(count = tile.badge)
                        }
                    }
                }
            }
        }
    }
}

/** بلاطةُ توجيهٍ — أيقونةٌ وعنوانٌ وشارةُ انتظارٍ اختياريّة. */
private data class Tile(
    val label: String,
    val icon: ImageVector,
    val onClick: () -> Unit,
    val badge: Int = 0,
)
