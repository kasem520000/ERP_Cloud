package com.erpcloud.bakery.ui.screens

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.outlined.AccountBalanceWallet
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.BakeryDining
import androidx.compose.material.icons.outlined.CloudDone
import androidx.compose.material.icons.outlined.CreditCard
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.LocalShipping
import androidx.compose.material.icons.outlined.Paid
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material.icons.outlined.Print
import androidx.compose.material.icons.outlined.PriceCheck
import androidx.compose.material.icons.outlined.ReceiptLong
import androidx.compose.material.icons.outlined.Savings
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Sell
import androidx.compose.material.icons.outlined.Speed
import androidx.compose.material.icons.outlined.SupportAgent
import androidx.compose.material.icons.outlined.TrendingUp
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
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.BadgeCount
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.MiniBarChart
import com.erpcloud.bakery.ui.components.PullRefreshBox
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
 *
 * **مبيعاتُ اليومِ من كلِّ القنوات** (كاشيرُ نقطةِ البيع + الفواتيرُ المكتبيّة +
 * مبيعاتُ المناديبِ المرحّلة): بطاقاتُ KPI ومزيجُ الدفعِ ورسمُ الأسبوعِ من
 * تقاريرِ الخادمِ الرسميّةِ (`sales-invoices-details` + `daily-sales`) — تُعادُ
 * قراءتُها بعدَ كلِّ بيعةٍ ناجحةٍ فتتحرّكُ الأرقامُ فورًا. وأرقامُ التوزيعِ
 * (المتبقّي بالسيارات/القرارات المعلّقة/…) من `GET /van-sales/dashboard` كما كانت.
 *
 * الطبقةُ البصريّة (كما الموك-أب `02-dashboard.html`): شريطٌ علويٍّ بلونِ
 * الخلفيّةِ العامّة وعنوانٌ عريضٌ وشاراتُ إشعارٍ/تحديث؛ صفُّ بلاطات KPI
 * (StatTile) للإيرادِ والتحصيل؛ بطاقةُ أعمدةِ الأسبوع؛ بطاقةُ توزيعِ الدفع؛
 * بطاقةُ «صورة المنشأة الآن»؛ بطاقةُ القرارات؛ وشبكةُ وصولٍ سريعٍ لأحد عشرَ
 * بلاطةً بأيقوناتٍ داخلَ مربّعاتِ primaryContainer مستديرة.
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
    onAiAssistant: () -> Unit = {},
    onTaxFilings: () -> Unit = {},
    onCashBoxes: () -> Unit = {},
    onSupport: () -> Unit = {},
    onLogout: () -> Unit,
) {
    val state by vm.uiState.collectAsState()
    val dash = state.dashboard
    val summary = dash?.summary

    Scaffold(
        topBar = {
            // الشريطُ العلويُّ بلونِ الخلفيّةِ العامّة (فاتح) — بلا رفعٍ، كما الموك-أب.
            TopAppBar(
                title = {
                    Text(
                        "إدارة المخابز",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.ExtraBold,
                    )
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
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

        PullRefreshBox(
            refreshing = state.loadingDashboard,
            onRefresh = { vm.refreshDashboard() },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(14.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                // ------------------------------------------------ هوية وانقطاع
                item(span = { GridItemSpan(2) }) {
                    Column {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                state.me?.user?.fullName ?: state.me?.user?.email ?: "",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.ExtraBold,
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

                // ------------------------------------------------ بلاطات الإيراد (KPI)
                // مبيعاتُ اليومِ **من كلِّ قنواتِ البيع** (كاشيرُ نقطةِ البيع + الفواتيرُ
                // المكتبيّة + مبيعاتُ المناديبِ المرحّلة) — من بطاقاتِ تقريرِ الخادمِ
                // الرسميِّ (s_net/s_cash/s_network/s_paid) فتتحدّثُ فورَ أيّ بيعةٍ
                // مرحّلة. وعند غيابِ إذنِ التقارير تُعرضُ أرقامُ نشاطِ التوزيعِ وحدها.
                val home = state.homeSales
                item {
                    StatTile(
                        if (home != null) "مبيعاتُ اليوم (ر.س)" else "إيرادُ التوزيع (ر.س)",
                        if (home != null) Dec.money(home.net.toPlainString()) else Dec.money(summary?.totalRevenueSar),
                        icon = Icons.Outlined.Paid,
                    )
                }
                item {
                    StatTile(
                        if (home != null) "نقديُّ اليوم" else "المُحصَّل نقدًا (توزيع)",
                        if (home != null) Dec.money(home.cash.toPlainString()) else Dec.money(summary?.totalCollectedCashSar),
                        icon = Icons.Outlined.Savings,
                        tone = ChipTone.OK,
                    )
                }
                item {
                    StatTile(
                        if (home != null) "شبكةُ اليوم" else "ذممٌ آجلة (توزيع)",
                        if (home != null) Dec.money(home.network.toPlainString()) else Dec.money(summary?.totalCreditReceivablesSar),
                        icon = if (home != null) Icons.Outlined.CreditCard else Icons.Outlined.Schedule,
                        tone = if (home != null) ChipTone.INFO else ChipTone.WARN,
                    )
                }
                item {
                    StatTile(
                        if (home != null) "آجلُ اليوم" else "صافي الربح (توزيع)",
                        if (home != null) Dec.money(home.credit.toPlainString()) else Dec.money(summary?.totalNetProfitSar),
                        icon = Icons.Outlined.Schedule,
                        tone = ChipTone.WARN,
                    )
                }
                if (home == null && !state.can("reporting.view")) {
                    item(span = { GridItemSpan(2) }) {
                        StatusChip(
                            "تُعرضُ أرقامُ نشاطِ التوزيعِ (المناديب) فقط — منحُ حسابِك إذنَ التقارير يُظهرُ مبيعاتِ اليومِ من كلِّ القنوات",
                            ChipTone.NEUTRAL,
                        )
                    }
                }

                // ------------------------------------------------ رسم مبيعات الأسبوع
                item(span = { GridItemSpan(2) }) {
                    // السلسلةُ الرسميّةُ أولًا (تقريرُ «مبيعات حسب اليوم» من الخادم — كلُّ
                    // القنوات)، وإلا مستنداتُ بيعِ المناديبِ في نافذةِ اللوحة.
                    val daily = remember(state.homeSales, dash?.documents) {
                        val companyDaily = state.homeSales?.daily
                            ?.takeIf { it.isNotEmpty() }
                            ?.sortedBy { it.first }
                            ?.takeLast(7)
                            ?.map { (day, total) -> dayLabelAr(day) to total.toFloat() }
                        if (companyDaily != null) {
                            companyDaily to true
                        } else {
                            val docs = dash?.documents.orEmpty()
                                // الخادمُ يسمّي المرتجعَ «return» — لا «sale_return» كما كان
                                // هنا قبل هذا الإصلاح، فكانت المرتجعاتُ تدخلُ رسمَ المبيعات.
                                .filter { it.documentKind != "return" }
                            docs.groupBy { it.docDate.take(10) }
                                .map { (day, list) ->
                                    day to list.sumOf { Dec.parse(it.total)?.toDouble() ?: 0.0 }
                                }
                                .sortedBy { it.first }
                                .takeLast(7)
                                .map { (day, total) -> dayLabelAr(day) to total.toFloat() } to false
                        }
                    }
                    if (daily.first.size >= 2) {
                        SectionCard(
                            title = "مبيعاتُ آخر ${daily.first.size} أيّام",
                            subtitle = if (daily.second) "مبيعاتُ المنشأةِ من كلِّ القنوات (ر.س)" else "من مستندات بيع المناديب في نافذة اللوحة (ر.س)",
                        ) {
                            MiniBarChart(points = daily.first, formatValue = { String.format(java.util.Locale.US, "%.0f", it) })
                        }
                    }
                }

                // ------------------------------------------------ توزيع الدفع
                item(span = { GridItemSpan(2) }) {
                    if (home != null && home.net.signum() > 0) {
                        // البسطُ والمقامُ من البطاقاتِ الرسميّةِ نفسِها — نقدي/شبكة/آجل
                        // من كلِّ قنواتِ اليومِ (لا من نافذةٍ جزئيّةٍ كما كان قبلًا).
                        val net = home.net.toDouble()
                        SectionCard(title = "توزيعُ دفعِ اليوم", subtitle = "من كلِّ قنواتِ البيع — كما تحسبُها بطاقاتُ تقرير الخادم") {
                            ShareBarRow("نقديّ", Dec.money(home.cash.toPlainString()) + " ر.س", (home.cash.toDouble() / net).toFloat(), BakeryColors.Ok)
                            ShareBarRow("شبكة", Dec.money(home.network.toPlainString()) + " ر.س", (home.network.toDouble() / net).toFloat(), BakeryColors.Info)
                            ShareBarRow("آجل", Dec.money(home.credit.toPlainString()) + " ر.س", (home.credit.toDouble() / net).toFloat(), BakeryColors.Warn)
                        }
                    } else {
                        // بلا إذنِ التقارير: مزيجُ مستنداتِ المناديبِ في النافذةِ نفسِها
                        // (البسطُ والمقامُ من النافذةِ لا من إجماليِّ كلِّ العهود — اتّساقًا).
                        val saleDocs = dash?.documents.orEmpty().filter { it.documentKind != "return" }
                        val windowTotal = saleDocs.sumOf { Dec.parse(it.total)?.toDouble() ?: 0.0 }
                        if (windowTotal > 0 && saleDocs.isNotEmpty()) {
                            fun share(method: String) =
                                saleDocs.filter { it.paymentMethod == method }.sumOf { Dec.parse(it.total)?.toDouble() ?: 0.0 }
                            val cash = share("cash")
                            val card = share("card")
                            val credit = share("credit")
                            SectionCard(title = "توزيعُ دفعِ مبيعاتِ المناديب", subtitle = "من نافذة اللوحة (آخر ١٢٠ مستندًا)") {
                                ShareBarRow("نقديّ", Dec.money(cash.toBigDecimal().toPlainString()) + " ر.س", (cash / windowTotal).toFloat(), BakeryColors.Ok)
                                ShareBarRow("شبكة", Dec.money(card.toBigDecimal().toPlainString()) + " ر.س", (card / windowTotal).toFloat(), BakeryColors.Info)
                                ShareBarRow("آجل", Dec.money(credit.toBigDecimal().toPlainString()) + " ر.س", (credit / windowTotal).toFloat(), BakeryColors.Warn)
                            }
                        }
                    }
                }

                // ------------------------------------------------ إحصاءات اليوم
                item(span = { GridItemSpan(2) }) {
                    SectionCard(title = "صورة المنشأة الآن", subtitle = "أرقامٌ رسميّةٌ من الخادم — لا تُحسب في الجهاز") {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            StatTile("الإنتاج (كجم)", Dec.kg(summary?.totalProducedKg), Modifier.weight(1f))
                            StatTile("المُحمَّل (كجم)", Dec.kg(summary?.totalLoadedKg), Modifier.weight(1f))
                        }
                        Spacer(Modifier.height(8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            StatTile("المبيع (كجم)", Dec.kg(summary?.totalSoldKg), Modifier.weight(1f))
                            StatTile("المتبقّي بالسيارات", Dec.kg(summary?.remainingInVansKg), Modifier.weight(1f))
                        }
                        Spacer(Modifier.height(8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            StatTile("رصيدُ الرئيسيّ (كجم)", Dec.kg(summary?.mainWarehouseBalanceKg), Modifier.weight(1f))
                            StatTile("على الطريق", Dec.kg(summary?.inTransitKg), sub = "${summary?.inTransitTransfersCount ?: 0} مناقلةً", modifier = Modifier.weight(1f))
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
                item(span = { GridItemSpan(2) }) {
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
                item(span = { GridItemSpan(2) }) {
                    Text(
                        "الشاشات",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.ExtraBold,
                    )
                }

                val canView = state.can("van_sales.view")
                val tiles = buildList {
                    if (state.can("organization.cashlocation.view") || state.can("treasury.view")) {
                        add(Tile("الصناديق والأرصدة", Icons.Outlined.AccountBalanceWallet, onCashBoxes))
                    }
                    if (state.can("ai.assistant.use")) {
                        add(Tile("المساعد الذكي AI", Icons.Outlined.AutoAwesome, onAiAssistant))
                    }
                    if (state.can("einvoice.view")) {
                        add(Tile("الفواتير الضريبية", Icons.Outlined.CloudDone, onTaxFilings))
                    }
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
                    add(Tile("طلب المساعدة والدعم", Icons.Outlined.SupportAgent, onSupport))
                    add(Tile("الطابعات", Icons.Outlined.Print, onPrinters))
                    add(Tile("تغييرُ كلمة المرور", Icons.Outlined.Speed, onChangePassword))
                }
                items(tiles) { tile ->
                    // بلاطةُ وصولٍ سريع: بطاقةٌ بيضاءُ (١٨) بظلٍّ كهرمانيٍّ ناعمٍ
                    // وأيقونةٌ داخلَ مربّعِ primaryContainer مستدير.
                    Surface(
                        onClick = tile.onClick,
                        shape = MaterialTheme.shapes.medium,
                        color = MaterialTheme.colorScheme.surface,
                        border = BorderStroke(1.dp, BakeryColors.Hairline),
                        modifier = Modifier
                            .fillMaxWidth()
                            .shadow(
                                elevation = 8.dp,
                                shape = MaterialTheme.shapes.medium,
                                ambientColor = BakeryColors.Primary.copy(alpha = 0.10f),
                                spotColor = BakeryColors.Primary.copy(alpha = 0.14f),
                            ),
                    ) {
                        Column(Modifier.padding(14.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Surface(
                                    color = MaterialTheme.colorScheme.primaryContainer,
                                    shape = RoundedCornerShape(12.dp),
                                    modifier = Modifier.size(38.dp),
                                ) {
                                    Box(contentAlignment = Alignment.Center) {
                                        Icon(
                                            tile.icon,
                                            contentDescription = null,
                                            tint = MaterialTheme.colorScheme.primary,
                                            modifier = Modifier.size(21.dp),
                                        )
                                    }
                                }
                                Spacer(Modifier.width(10.dp))
                                Text(
                                    tile.label,
                                    style = MaterialTheme.typography.titleSmall,
                                    fontWeight = FontWeight.SemiBold,
                                )
                            }
                            if (tile.badge > 0) {
                                Spacer(Modifier.height(8.dp))
                                BadgeCount(count = tile.badge)
                            }
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
