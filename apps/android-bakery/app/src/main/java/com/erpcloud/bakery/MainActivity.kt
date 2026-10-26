package com.erpcloud.bakery

import android.os.Bundle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.paddingFromBaseline
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.Assessment
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Badge
import androidx.compose.material.icons.filled.BakeryDining
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Category
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.filled.FactCheck
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Handshake
import androidx.compose.material.icons.filled.Inventory
import androidx.compose.material.icons.filled.LocalShipping
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.ManageAccounts
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Paid
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.PointOfSale
import androidx.compose.material.icons.filled.Policy
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material.icons.filled.ShoppingBag
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Store
import androidx.compose.material.icons.filled.Straighten
import androidx.compose.material.icons.filled.SupportAgent
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.WarningAmber
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.PriceChange
import androidx.compose.material.icons.filled.People
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDrawerState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.erpcloud.bakery.ui.screens.AdjustmentsScreen
import com.erpcloud.bakery.ui.screens.AiAssistantScreen
import com.erpcloud.bakery.ui.screens.BAKERY_EDITION_LABEL
import com.erpcloud.bakery.ui.screens.BrandCrestLogo
import com.erpcloud.bakery.ui.screens.CashBoxesScreen
import com.erpcloud.bakery.ui.screens.CountAdjustmentsScreen
import com.erpcloud.bakery.ui.screens.CategoriesScreen
import com.erpcloud.bakery.ui.screens.ItemsScreen
import com.erpcloud.bakery.ui.screens.OrgScreen
import com.erpcloud.bakery.ui.screens.SalesInvoicesScreen
import com.erpcloud.bakery.ui.screens.UnitsScreen
import com.erpcloud.bakery.ui.screens.EmployeeAccountScreen
import com.erpcloud.bakery.ui.screens.EmployeesScreen
import com.erpcloud.bakery.ui.screens.PayrollScreen
import com.erpcloud.bakery.ui.screens.PosScreen
import com.erpcloud.bakery.ui.screens.PurchasesScreen
import com.erpcloud.bakery.ui.screens.RolesScreen
import com.erpcloud.bakery.ui.screens.SalesRegistryScreen
import com.erpcloud.bakery.ui.screens.SplashScreen
import com.erpcloud.bakery.ui.screens.SupportScreen
import com.erpcloud.bakery.ui.screens.SystemReportsScreen
import com.erpcloud.bakery.ui.screens.TaxFilingsScreen
import com.erpcloud.bakery.ui.screens.TreasuryScreen
import com.erpcloud.bakery.ui.screens.UsersScreen
import com.erpcloud.bakery.ui.screens.VouchersScreen
import kotlinx.coroutines.launch
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.BadgeCount
import com.erpcloud.bakery.ui.components.Notice
import com.erpcloud.bakery.ui.screens.ChangePasswordScreen
import com.erpcloud.bakery.ui.screens.CollectionScreen
import com.erpcloud.bakery.ui.screens.CustodyScreen
import com.erpcloud.bakery.ui.screens.DashboardScreen
import com.erpcloud.bakery.ui.screens.InventoryScreen
import com.erpcloud.bakery.ui.screens.PartiesScreen
import com.erpcloud.bakery.ui.screens.DistributionScreen
import com.erpcloud.bakery.ui.screens.LoginScreen
import com.erpcloud.bakery.ui.screens.NotificationsScreen
import com.erpcloud.bakery.ui.screens.PolicyScreen
import com.erpcloud.bakery.ui.screens.PricesScreen
import com.erpcloud.bakery.ui.screens.PrintersScreen
import com.erpcloud.bakery.ui.screens.ProductionScreen
import com.erpcloud.bakery.ui.screens.ReportsScreen
import com.erpcloud.bakery.ui.screens.SalesmenScreen
import com.erpcloud.bakery.ui.theme.BakeryColors
import com.erpcloud.bakery.ui.theme.BakeryTheme

/**
 * FragmentActivity (لا ComponentActivity) لأنّ مكتبة البصمة الرسميّة تعرض
 * BiometricPrompt عبر Fragment — وبقيةُ Compose تعمل كما هي.
 */
class MainActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // طباعةُ النظامِ تحتاج نشاطًا حيًّا (PrintHelper) — سجّله هنا ليصلَ إليه
        // PrintKit من أيّ مسارِ طباعةٍ بسياقِ التطبيق ("Can print only from an activity").
        com.erpcloud.bakery.printing.ActivityRef.set(this)
        enableEdgeToEdge()
        setContent {
            BakeryTheme {
                // الواجهةُ عربيّةٌ RTL دائمًا — شاشاتُ الإدارة كلُّها عربيّة.
                CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                    Surface(
                        modifier = Modifier.fillMaxSize(),
                        color = MaterialTheme.colorScheme.background,
                    ) {
                        val vm: AppViewModel = viewModel()
                        AppRoot(vm)
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        com.erpcloud.bakery.printing.ActivityRef.clear(this)
        super.onDestroy()
    }
}

internal object Routes {
    const val LOGIN = "login"
    const val HOME = "home"
    const val PRODUCTION = "production"
    const val DISTRIBUTION = "distribution"
    const val CUSTODY = "custody"
    const val SALESMEN = "salesmen"
    const val COLLECTION = "collection"
    const val PRICES = "prices"
    const val REPORTS = "reports"
    const val POLICY = "policy"
    const val PRINTERS = "printers"
    const val NOTIFICATIONS = "notifications"
    const val CHANGE_PASSWORD = "change-password"
    // وحداتُ «الطاقم» المنقولة من apps/staff
    const val PURCHASES = "purchases"
    const val VOUCHERS = "vouchers"
    const val POS = "pos"
    const val EMPLOYEES = "employees"
    const val SALES_REGISTRY = "sales-registry"
    const val USERS = "users"
    const val ROLES = "roles"
    const val ADJUSTMENTS = "adjustments"
    const val PAYROLL = "payroll"
    const val EMPLOYEE_ACCOUNT = "employee-account"
    const val SYSTEM_REPORTS = "system-reports"
    // الفجواتُ التشغيليّة اليوميّة: الخزينة والمخزون والجرد والأطراف
    const val TREASURY = "treasury"
    const val CASH_BOXES = "cash-boxes"
    const val INVENTORY = "inventory"
    const val COUNTS = "counts"
    const val PARTIES = "parties"
    // فواتيرُ المبيعات والمردودات + إعداداتُ المنشأة + فصلُ الكتالوج
    const val SALES_INVOICES = "sales-invoices"
    const val ORG = "org"
    const val ITEMS = "items"
    const val CATEGORIES = "categories"
    const val UNITS = "units"
    // الشاشاتُ المضافة: المساعد الذكي + إعداداته + الفواتير الضريبية + المساعدة والدعم
    const val AI_ASSISTANT = "ai-assistant"
    const val AI_SETTINGS = "ai-settings"
    const val TAX_FILINGS = "tax-filings"
    const val SUPPORT = "support"
}

/** بندُ درجٍ — مسارٌ + عنوانٌ + إذنُ الدخول (الدخولُ بلا إذنٍ يُخفي البندَ لا أكثر). */
private data class DrawerEntry(
    val route: String,
    val titleAr: String,
    val permission: String? = null,
    val icon: ImageVector? = null,
    val permissionsAny: List<String> = emptyList(),
)

/**
 * حاويةُ درجٍ — عنوانٌ وبنودٌ؛ الحاويةُ كلُّها تختفي إن لم يبقَ فيها بندٌ مسموحٌ
 * (لا عناوينَ معلّقةً فوق فراغ).
 */
private data class DrawerGroup(val titleAr: String, val entries: List<DrawerEntry>) {
    fun visible(can: (String) -> Boolean): List<DrawerEntry> =
        entries.filter { entry ->
            when {
                entry.permissionsAny.isNotEmpty() -> entry.permissionsAny.any(can)
                entry.permission != null -> can(entry.permission)
                else -> true
            }
        }
}

@Composable
fun AppRoot(vm: AppViewModel) {
    val state by vm.uiState.collectAsState()
    val notice by vm.notice.collectAsState()
    val serverOffline by com.erpcloud.bakery.data.offline.ServerConnectivity.offline.collectAsState()
    val navController = rememberNavController()

    if (!state.sessionLoaded || !state.splashDone) {
        SplashScreen(
            systemName = state.session.brandName,
            taglineAr = state.session.brandTagline,
        )
        return
    }

    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val backStack by navController.currentBackStackEntryAsState()
    val groups = drawerGroups { state.can(it) }
    val popOrHome: () -> Unit = {
        if (!navController.popBackStack()) {
            navController.navigate(Routes.HOME) { launchSingleTop = true }
        }
    }

    BackHandler(enabled = drawer.isOpen) {
        scope.launch { drawer.close() }
    }

    ModalNavigationDrawer(
        drawerState = drawer,
        gesturesEnabled = state.session.loggedIn,
        drawerContent = {
            ModalDrawerSheet(
                drawerContainerColor = MaterialTheme.colorScheme.background,
            ) {
                Column(Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, top = 18.dp, bottom = 6.dp)) {
                    Surface(
                        shape = RoundedCornerShape(22.dp),
                        color = MaterialTheme.colorScheme.primaryContainer,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Row(
                            Modifier.padding(14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            BrandCrestLogo(size = 46.dp)
                            Spacer(Modifier.width(12.dp))
                            Column {
                                Text(
                                    state.session.brandName,
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.ExtraBold,
                                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                                )
                                Text(
                                    BAKERY_EDITION_LABEL,
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.primary,
                                )
                                val identity = state.me?.user?.let { it.fullName.ifBlank { it.email } }
                                if (identity != null) {
                                    Text(
                                        identity,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.8f),
                                    )
                                }
                            }
                        }
                    }
                }
                LazyColumn {
                    groups.forEach { (groupTitle, visibleEntries) ->
                        item(key = "header-$groupTitle") {
                            Text(
                                groupTitle,
                                style = MaterialTheme.typography.labelLarge,
                                color = MaterialTheme.colorScheme.primary,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .paddingFromBaseline(top = 18.dp)
                                    .padding(horizontal = 20.dp, vertical = 6.dp),
                            )
                        }
                        items(visibleEntries.size, key = { g -> visibleEntries[g].route }) { index ->
                            val entry = visibleEntries[index]
                            val selected = backStack?.destination?.route == entry.route
                            Surface(
                                color = if (selected) MaterialTheme.colorScheme.primaryContainer else Color.Transparent,
                                shape = RoundedCornerShape(16.dp),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 12.dp, vertical = 1.dp),
                            ) {
                                Row(
                                    Modifier
                                        .fillMaxWidth()
                                        .clickable {
                                            scope.launch { drawer.close() }
                                            if (!selected) {
                                                navController.navigate(entry.route) { launchSingleTop = true }
                                            }
                                        }
                                        .padding(horizontal = 10.dp, vertical = 11.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Icon(
                                        entry.icon ?: Icons.Filled.ChevronRight,
                                        contentDescription = null,
                                        tint = if (selected) MaterialTheme.colorScheme.primary
                                        else MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.size(22.dp),
                                    )
                                    Spacer(Modifier.width(10.dp))
                                    Text(
                                        entry.titleAr,
                                        style = MaterialTheme.typography.bodyLarge,
                                        fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                                        color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                                        modifier = Modifier.weight(1f),
                                    )
                                    if (entry.route == Routes.NOTIFICATIONS && state.notificationsUnread > 0) {
                                        BadgeCount(state.notificationsUnread)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
    ) {
        Box(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize()) {
                // شريطُ انقطاعِ الخادم — يظهرُ أعلى الشاشة كلَّما كان غيرَ متصل،
                // والتطبيقُ يعملُ على آخرِ لقطةٍ محفوظةٍ لكلّ شاشة.
                if (serverOffline || !state.online) {
                    OfflineBar()
                }
            NavHost(
                modifier = Modifier.fillMaxSize().weight(1f),
                navController = navController,
                startDestination = if (state.session.loggedIn) Routes.HOME else Routes.LOGIN,
            ) {
            composable(Routes.LOGIN) { LoginScreen(vm) }
            composable(Routes.HOME) {
                DashboardScreen(
                    vm = vm,
                    onMenu = { scope.launch { drawer.open() } },
                    onProduction = { navController.navigate(Routes.PRODUCTION) },
                    onDistribution = { navController.navigate(Routes.DISTRIBUTION) },
                    onCustody = { navController.navigate(Routes.CUSTODY) },
                    onSalesmen = { navController.navigate(Routes.SALESMEN) },
                    onCollection = { navController.navigate(Routes.COLLECTION) },
                    onPrices = { navController.navigate(Routes.PRICES) },
                    onReports = { navController.navigate(Routes.REPORTS) },
                    onPolicy = { navController.navigate(Routes.POLICY) },
                    onPrinters = { navController.navigate(Routes.PRINTERS) },
                    onNotifications = { navController.navigate(Routes.NOTIFICATIONS) },
                    onChangePassword = { navController.navigate(Routes.CHANGE_PASSWORD) },
                    onAiAssistant = { navController.navigate(Routes.AI_ASSISTANT) },
                    onTaxFilings = { navController.navigate(Routes.TAX_FILINGS) },
                    onCashBoxes = { navController.navigate(Routes.CASH_BOXES) },
                    onSupport = { navController.navigate(Routes.SUPPORT) },
                    onLogout = { vm.logout() },
                )
            }
            composable(Routes.PRODUCTION) { ProductionScreen(vm, onBack = popOrHome) }
            composable(Routes.DISTRIBUTION) { DistributionScreen(vm, onBack = popOrHome) }
            composable(Routes.CUSTODY) { CustodyScreen(vm, onBack = popOrHome) }
            composable(Routes.SALESMEN) { SalesmenScreen(vm, onBack = popOrHome) }
            composable(Routes.COLLECTION) { CollectionScreen(vm, onBack = popOrHome) }
            composable(Routes.PRICES) { PricesScreen(vm, onBack = popOrHome) }
            composable(Routes.REPORTS) { ReportsScreen(vm, onBack = popOrHome) }
            composable(Routes.POLICY) { PolicyScreen(vm, onBack = popOrHome) }
            composable(Routes.PRINTERS) { PrintersScreen(vm, onBack = popOrHome) }
            composable(Routes.NOTIFICATIONS) {
                NotificationsScreen(
                    vm = vm,
                    onBack = popOrHome,
                    onNavigateRoute = { route -> navController.navigate(route) },
                )
            }
            composable(Routes.CHANGE_PASSWORD) {
                ChangePasswordScreen(vm, onBack = popOrHome)
            }
            // ------------------------------------------------ وحداتُ «الطاقم»
            composable(Routes.PURCHASES) { PurchasesScreen(vm, onBack = popOrHome) }
            composable(Routes.VOUCHERS) { VouchersScreen(vm, onBack = popOrHome) }
            composable(Routes.POS) { PosScreen(vm, onBack = popOrHome) }
            composable(Routes.EMPLOYEES) { EmployeesScreen(vm, onBack = popOrHome) }
            composable(Routes.SALES_REGISTRY) {
                SalesRegistryScreen(vm, onBack = popOrHome)
            }
            composable(Routes.USERS) { UsersScreen(vm, onBack = popOrHome) }
            composable(Routes.ROLES) { RolesScreen(vm, onBack = popOrHome) }
            composable(Routes.ADJUSTMENTS) { AdjustmentsScreen(vm, onBack = popOrHome) }
            composable(Routes.PAYROLL) { PayrollScreen(vm, onBack = popOrHome) }
            composable(Routes.EMPLOYEE_ACCOUNT) {
                EmployeeAccountScreen(vm, onBack = popOrHome)
            }
            composable(Routes.SYSTEM_REPORTS) {
                SystemReportsScreen(vm, onBack = popOrHome)
            }
            composable(Routes.TREASURY) {
                TreasuryScreen(
                    vm = vm,
                    onBack = popOrHome,
                    onOpenCashBoxes = {
                        navController.navigate(Routes.CASH_BOXES) { launchSingleTop = true }
                    },
                )
            }
            composable(Routes.CASH_BOXES) {
                CashBoxesScreen(
                    vm = vm,
                    onBack = popOrHome,
                    onOpenVouchers = {
                        navController.navigate(Routes.TREASURY) { launchSingleTop = true }
                    },
                )
            }
            composable(Routes.INVENTORY) { InventoryScreen(vm, onBack = popOrHome) }
            composable(Routes.COUNTS) { CountAdjustmentsScreen(vm, onBack = popOrHome) }
            composable(Routes.PARTIES) { PartiesScreen(vm, onBack = popOrHome) }
            composable(Routes.SALES_INVOICES) { SalesInvoicesScreen(vm, onBack = popOrHome) }
            composable(Routes.ORG) { OrgScreen(vm, onBack = popOrHome) }
            composable(Routes.ITEMS) { ItemsScreen(vm, onBack = popOrHome) }
            composable(Routes.CATEGORIES) { CategoriesScreen(vm, onBack = popOrHome) }
            composable(Routes.UNITS) { UnitsScreen(vm, onBack = popOrHome) }
            composable(Routes.AI_ASSISTANT) {
                AiAssistantScreen(vm, onBack = popOrHome, startInSettings = false)
            }
            composable(Routes.AI_SETTINGS) {
                AiAssistantScreen(vm, onBack = popOrHome, startInSettings = true)
            }
            composable(Routes.TAX_FILINGS) {
                TaxFilingsScreen(vm, onBack = popOrHome)
            }
            composable(Routes.SUPPORT) {
                SupportScreen(vm, onBack = popOrHome)
            }
            }

            // الدخولُ والخروجُ يقودان التوجيه — **بعد** تركيبِ NavHost لا قبله:
            // في الإقلاعِ البارد sessionLoaded=false فلا يُركَّبُ NavHost أصلًا،
            // وكان الـLaunchedEffectُ القديمُ (فوق الحاجز) يستدعي navigate() قبل
            // ضبطِ رسمِ الملاحة فينهارُ التطبيقُ عند كلّ تشغيل.
            LaunchedEffect(state.session.loggedIn) {
                val current = navController.currentBackStackEntry?.destination?.route
                if (state.session.loggedIn && current == Routes.LOGIN) {
                    navController.navigate(Routes.HOME) {
                        popUpTo(Routes.LOGIN) { inclusive = true }
                    }
                } else if (!state.session.loggedIn && current != Routes.LOGIN) {
                    navController.navigate(Routes.LOGIN) {
                        popUpTo(0) { inclusive = true }
                    }
                }
            }
            }

            // رسائلُ الخادم — بطاقةٌ عائمةٌ من أسفل الشاشة (v3) بدلَ الشريط الأعلىّ البدائيّ.
            // فوقَ عمودِ المحتوى داخل الصندوق — فتنبثقُ من أسفلِ الشاشة كلِّها.
            ServerNoticeOverlay(notice = notice, onConsume = { vm.consumeNotice() })
        }
    }
}

/**
 * شريطُ انقطاعِ الخادم — رفيعٌ دائمُ الظهور أعلى الشاشة: آخرُ البياناتِ المحفوظة
 * تُعرض، والكتاباتُ تُخبرُ بصدقٍ أنّها لم تصل حتى يعود الاتصال.
 */
@Composable
private fun OfflineBar() {
    Surface(
        color = BakeryColors.WarnBg,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Default.CloudOff,
                contentDescription = null,
                tint = BakeryColors.Warn,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                "السيرفر غير متصل — تعمل على آخر بيانات محفوظة",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Bold,
                color = BakeryColors.Warn,
            )
        }
    }
}

/**
 * بطاقةُ رسائلِ الخادم العائمة — بديلُ الشريط العلويّ: تظهرُ من أسفلِ الشاشة بحركةٍ
 * ناعمة، بأيقونةٍ دائريّةٍ وألوانِ v3 وخطّ Tajawal الثقيل، وتختفي وحدها بعد مهلةٍ
 * تتفاوت مع نوعها (الخطأُ يبقى أطولَ ليُقرأ).
 */
@Composable
private fun BoxScope.ServerNoticeOverlay(notice: Notice?, onConsume: () -> Unit) {
    var current by remember { mutableStateOf<Notice?>(null) }
    var shown by remember { mutableStateOf(false) }

    LaunchedEffect(notice?.id) {
        val n = notice ?: return@LaunchedEffect
        current = n
        shown = true
        kotlinx.coroutines.delay(
            when (n.kind) {
                Notice.Kind.OK -> 3500L
                Notice.Kind.WARN -> 6500L
                Notice.Kind.DANGER -> 10000L
            },
        )
        if (current?.id == n.id) shown = false
    }

    val card = current

    AnimatedVisibility(
        visible = shown,
        enter = fadeIn(),
        exit = fadeOut(),
        modifier = Modifier.align(Alignment.Center),
    ) {
        if (card != null) {
            val (icon, tint) = when (card.kind) {
                Notice.Kind.OK -> Icons.Default.CheckCircle to BakeryColors.Ok
                Notice.Kind.WARN -> Icons.Default.WarningAmber to BakeryColors.Warn
                Notice.Kind.DANGER -> Icons.Default.ErrorOutline to BakeryColors.Danger
            }
            Card(
                shape = androidx.compose.foundation.shape.RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 6.dp),
                border = BorderStroke(1.dp, BakeryColors.Hairline),
                modifier = Modifier
                    .widthIn(max = 420.dp)
                    .padding(horizontal = 22.dp),
            ) {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clickable { shown = false }
                        .padding(horizontal = 18.dp, vertical = 18.dp),
                    horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally,
                ) {
                    Box(
                        Modifier
                            .size(56.dp)
                            .clip(CircleShape)
                            .background(tint.copy(alpha = 0.14f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(30.dp))
                    }
                    Spacer(Modifier.height(12.dp))
                    Text(
                        card.text,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface,
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    )
                    Spacer(Modifier.height(12.dp))
                    TextButton(
                        onClick = {
                            shown = false
                            onConsume()
                        },
                    ) {
                        Text("حسنًا", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

/**
 * بنودُ الدرج — **مجمّعةً في حاويات** كما طلب المالك (محاسبة/مستودعات/إنتاج/مبيعات/
 * مشتريات/تقارير/موظفون/مصروفات)، وكلُّ بندٍ بإذنِه. الأكوادُ كلُّها من سجلِّ
 * الخادم (`packages/contracts/src/permissions.ts`) — لا كودَ مُخترَعًا، فقد أثبت
 * التدقيقُ أنّ كودًا غيرَ موجودٍ يُخفي الشاشةَ عن المالكِ نفسِه.
 */
private fun drawerGroups(can: (String) -> Boolean): List<Pair<String, List<DrawerEntry>>> =
    listOf(
        DrawerGroup("الرئيسيّة", listOf(DrawerEntry(Routes.HOME, "اللوحة", icon = Icons.Filled.Dashboard))),
        DrawerGroup(
            "المبيعات",
            listOf(
                DrawerEntry(Routes.POS, "نقطة البيع", "pos.view", Icons.Filled.PointOfSale),
                DrawerEntry(Routes.SALES_INVOICES, "فواتيرُ المبيعات والمردودات", "sales.view", Icons.Filled.ReceiptLong),
                DrawerEntry(Routes.PRICES, "أسعارُ العملاء", "van_sales.pricing.manage", Icons.Filled.PriceChange),
                DrawerEntry(Routes.SALES_REGISTRY, "مناديبُ المبيعات", "sales.view", Icons.Filled.Group),
            ),
        ),
        DrawerGroup(
            "المشتريات",
            listOf(
                DrawerEntry(Routes.PURCHASES, "فواتيرُ المشتريات والمردودات", "purchase.view", Icons.Filled.ShoppingCart),
            ),
        ),
        DrawerGroup(
            "المستودعات",
            listOf(
                DrawerEntry(Routes.INVENTORY, "المخزون والأرصدة", "inventory.view", Icons.Filled.Inventory),
                DrawerEntry(Routes.VOUCHERS, "السندات المخزنيّة", "inventory.view", Icons.Filled.Store),
                DrawerEntry(Routes.COUNTS, "تسويةُ الجرد", "inventory.view", Icons.Filled.FactCheck),
            ),
        ),
        DrawerGroup(
            "التوزيع والمندوبين",
            listOf(
                DrawerEntry(Routes.DISTRIBUTION, "التوزيع وأوامرُ التحميل", "van_sales.view", Icons.Filled.LocalShipping),
                DrawerEntry(Routes.SALESMEN, "المناديب وعهدُ الطريق", "van_sales.view", Icons.Filled.Badge),
                DrawerEntry(Routes.CUSTODY, "العهدة والإقفال", "van_sales.view", Icons.Filled.Handshake),
                DrawerEntry(Routes.COLLECTION, "التحصيل", "van_sales.view", Icons.Filled.Payments),
                DrawerEntry(Routes.POLICY, "سياسةُ العجز", "van_sales.view", Icons.Filled.Policy),
                DrawerEntry(Routes.REPORTS, "تقاريرُ التوزيع", "van_sales.view", Icons.Filled.Assessment),
            ),
        ),
        DrawerGroup(
            "الإنتاج",
            listOf(DrawerEntry(Routes.PRODUCTION, "الإنتاج", "van_sales.view", Icons.Filled.BakeryDining)),
        ),
        DrawerGroup(
            "المحاسبة والمصروفات",
            listOf(
                DrawerEntry(
                    route = Routes.CASH_BOXES,
                    titleAr = "الصناديق والأرصدة",
                    icon = Icons.Filled.AccountBalanceWallet,
                    permissionsAny = listOf("organization.cashlocation.view", "treasury.view"),
                ),
                DrawerEntry(Routes.TREASURY, "الخزينة والمصروفات", "treasury.view", Icons.Filled.AccountBalance),
            ),
        ),
        DrawerGroup(
            "الكتالوج",
            listOf(
                DrawerEntry(Routes.ITEMS, "الأصناف", "catalog.item.view", Icons.Filled.ShoppingBag),
                DrawerEntry(Routes.CATEGORIES, "المجموعات", "catalog.category.view", Icons.Filled.Category),
                DrawerEntry(Routes.UNITS, "وحداتُ القياس", "catalog.unit.view", Icons.Filled.Straighten),
            ),
        ),
        DrawerGroup(
            "الأطراف",
            listOf(DrawerEntry(Routes.PARTIES, "العملاء والموردون", "parties.view", Icons.Filled.People)),
        ),
        DrawerGroup(
            "الموظفون",
            listOf(
                DrawerEntry(Routes.EMPLOYEES, "الموظفون", "hrm.view", Icons.Filled.Groups),
                DrawerEntry(Routes.ADJUSTMENTS, "المنصرفات", "hrm.view", Icons.Filled.EditNote),
                DrawerEntry(Routes.PAYROLL, "الرواتب", "hrm.view", Icons.Filled.Paid),
                DrawerEntry(Routes.EMPLOYEE_ACCOUNT, "حسابُ موظف", "hrm.view", Icons.Filled.AccountBalanceWallet),
            ),
        ),
        DrawerGroup(
            "الذكاء الاصطناعي والضرائب",
            listOf(
                DrawerEntry(Routes.AI_ASSISTANT, "المساعد الذكي AI", "ai.assistant.use", Icons.Filled.AutoAwesome),
                DrawerEntry(Routes.AI_SETTINGS, "إعدادات المساعد الذكي", "ai.settings.manage", Icons.Filled.Settings),
                DrawerEntry(Routes.TAX_FILINGS, "الفواتير الضريبية", "einvoice.view", Icons.Filled.CloudDone),
            ),
        ),
        DrawerGroup(
            "التقارير",
            listOf(DrawerEntry(Routes.SYSTEM_REPORTS, "التقارير", "reporting.view", Icons.Filled.BarChart)),
        ),
        DrawerGroup(
            "الإدارة والإعدادات",
            listOf(
                DrawerEntry(Routes.ORG, "الفروع والمستودعات والخزائن", "organization.branch.view", Icons.Filled.Store),
                DrawerEntry(Routes.USERS, "المستخدمون", "tenant.membership.manage", Icons.Filled.ManageAccounts),
                DrawerEntry(Routes.ROLES, "الأدوار والصلاحيّات", "tenant.role.manage", Icons.Filled.AdminPanelSettings),
                DrawerEntry(Routes.SUPPORT, "طلب المساعدة والدعم", icon = Icons.Filled.SupportAgent),
                DrawerEntry(Routes.NOTIFICATIONS, "الإشعارات", icon = Icons.Filled.Notifications),
                DrawerEntry(Routes.PRINTERS, "الطباعة والطابعات", icon = Icons.Filled.Print),
                DrawerEntry(Routes.CHANGE_PASSWORD, "تغييرُ كلمة المرور", icon = Icons.Filled.Lock),
            ),
        ),
    )
    .map { group -> group.titleAr to group.visible(can) }
    .filter { (_, visible) -> visible.isNotEmpty() }
