package com.erpcloud.bakery

import android.os.Bundle
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.WarningAmber
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
import com.erpcloud.bakery.ui.screens.CountAdjustmentsScreen
import com.erpcloud.bakery.ui.screens.CatalogScreen
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
import com.erpcloud.bakery.ui.screens.SystemReportsScreen
import com.erpcloud.bakery.ui.screens.TreasuryScreen
import com.erpcloud.bakery.ui.screens.UsersScreen
import com.erpcloud.bakery.ui.screens.VouchersScreen
import kotlinx.coroutines.launch
import com.erpcloud.bakery.ui.AppViewModel
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
}

private object Routes {
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
    const val CATALOG = "catalog"
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
    const val INVENTORY = "inventory"
    const val COUNTS = "counts"
    const val PARTIES = "parties"
    // فواتيرُ المبيعات والمردودات + إعداداتُ المنشأة + فصلُ الكتالوج
    const val SALES_INVOICES = "sales-invoices"
    const val ORG = "org"
    const val ITEMS = "items"
    const val CATEGORIES = "categories"
    const val UNITS = "units"
}

/** بندُ درجٍ — مسارٌ + عنوانٌ + إذنُ الدخول (الدخولُ بلا إذنٍ يُخفي البندَ لا أكثر). */
private data class DrawerEntry(val route: String, val titleAr: String, val permission: String?)

/**
 * حاويةُ درجٍ — عنوانٌ وبنودٌ؛ الحاويةُ كلُّها تختفي إن لم يبقَ فيها بندٌ مسموحٌ
 * (لا عناوينَ معلّقةً فوق فراغ).
 */
private data class DrawerGroup(val titleAr: String, val entries: List<DrawerEntry>) {
    fun visible(can: (String) -> Boolean): List<DrawerEntry> =
        entries.filter { it.permission == null || can(it.permission) }
}

@Composable
fun AppRoot(vm: AppViewModel) {
    val state by vm.uiState.collectAsState()
    val notice by vm.notice.collectAsState()
    val serverOffline by com.erpcloud.bakery.data.offline.ServerConnectivity.offline.collectAsState()
    val navController = rememberNavController()

    if (!state.sessionLoaded) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }

    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val backStack by navController.currentBackStackEntryAsState()
    val groups = drawerGroups { state.can(it) }

    ModalNavigationDrawer(
        drawerState = drawer,
        drawerContent = {
            ModalDrawerSheet {
                Text(
                    "المخبز — وحداتُ المنشأة",
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(16.dp),
                )
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
                            Text(
                                entry.titleAr,
                                style = MaterialTheme.typography.bodyLarge,
                                color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        scope.launch { drawer.close() }
                                        if (!selected) navController.navigate(entry.route)
                                    }
                                    .padding(horizontal = 20.dp, vertical = 12.dp),
                            )
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
                    onLogout = { vm.logout() },
                )
            }
            composable(Routes.PRODUCTION) { ProductionScreen(vm, onBack = { navController.popBackStack() }) }
            composable(Routes.DISTRIBUTION) { DistributionScreen(vm, onBack = { navController.popBackStack() }) }
            composable(Routes.CUSTODY) { CustodyScreen(vm, onBack = { navController.popBackStack() }) }
            composable(Routes.SALESMEN) { SalesmenScreen(vm, onBack = { navController.popBackStack() }) }
            composable(Routes.COLLECTION) { CollectionScreen(vm, onBack = { navController.popBackStack() }) }
            composable(Routes.PRICES) { PricesScreen(vm, onBack = { navController.popBackStack() }) }
            composable(Routes.REPORTS) { ReportsScreen(vm, onBack = { navController.popBackStack() }) }
            composable(Routes.POLICY) { PolicyScreen(vm, onBack = { navController.popBackStack() }) }
            composable(Routes.PRINTERS) { PrintersScreen(vm, onBack = { navController.popBackStack() }) }
            composable(Routes.NOTIFICATIONS) {
                NotificationsScreen(vm, onBack = { navController.popBackStack() })
            }
            composable(Routes.CHANGE_PASSWORD) {
                ChangePasswordScreen(vm, onBack = { navController.popBackStack() })
            }
            // ------------------------------------------------ وحداتُ «الطاقم»
            composable(Routes.CATALOG) { CatalogScreen(vm, onBack = { navController.popBackStack() }) }
            composable(Routes.PURCHASES) { PurchasesScreen(vm, onBack = { navController.popBackStack() }) }
            composable(Routes.VOUCHERS) { VouchersScreen(vm, onBack = { navController.popBackStack() }) }
            composable(Routes.POS) { PosScreen(vm, onBack = { navController.popBackStack() }) }
            composable(Routes.EMPLOYEES) { EmployeesScreen(vm, onBack = { navController.popBackStack() }) }
            composable(Routes.SALES_REGISTRY) {
                SalesRegistryScreen(vm, onBack = { navController.popBackStack() })
            }
            composable(Routes.USERS) { UsersScreen(vm, onBack = { navController.popBackStack() }) }
            composable(Routes.ROLES) { RolesScreen(vm, onBack = { navController.popBackStack() }) }
            composable(Routes.ADJUSTMENTS) { AdjustmentsScreen(vm, onBack = { navController.popBackStack() }) }
            composable(Routes.PAYROLL) { PayrollScreen(vm, onBack = { navController.popBackStack() }) }
            composable(Routes.EMPLOYEE_ACCOUNT) {
                EmployeeAccountScreen(vm, onBack = { navController.popBackStack() })
            }
            composable(Routes.SYSTEM_REPORTS) {
                SystemReportsScreen(vm, onBack = { navController.popBackStack() })
            }
            composable(Routes.TREASURY) { TreasuryScreen(vm, onBack = { navController.popBackStack() }) }
            composable(Routes.INVENTORY) { InventoryScreen(vm, onBack = { navController.popBackStack() }) }
            composable(Routes.COUNTS) { CountAdjustmentsScreen(vm, onBack = { navController.popBackStack() }) }
            composable(Routes.PARTIES) { PartiesScreen(vm, onBack = { navController.popBackStack() }) }
            composable(Routes.SALES_INVOICES) { SalesInvoicesScreen(vm, onBack = { navController.popBackStack() }) }
            composable(Routes.ORG) { OrgScreen(vm, onBack = { navController.popBackStack() }) }
            composable(Routes.ITEMS) { ItemsScreen(vm, onBack = { navController.popBackStack() }) }
            composable(Routes.CATEGORIES) { CategoriesScreen(vm, onBack = { navController.popBackStack() }) }
            composable(Routes.UNITS) { UnitsScreen(vm, onBack = { navController.popBackStack() }) }
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
        DrawerGroup("الرئيسيّة", listOf(DrawerEntry(Routes.HOME, "اللوحة"))),
        DrawerGroup(
            "المبيعات",
            listOf(
                DrawerEntry(Routes.POS, "نقطة البيع", "pos.view"),
                DrawerEntry(Routes.SALES_INVOICES, "فواتيرُ المبيعات والمردودات", "sales.view"),
                DrawerEntry(Routes.PRICES, "أسعارُ العملاء", "van_sales.pricing.manage"),
                DrawerEntry(Routes.SALES_REGISTRY, "مناديبُ المبيعات", "sales.view"),
            ),
        ),
        DrawerGroup(
            "المشتريات",
            listOf(
                DrawerEntry(Routes.PURCHASES, "فواتيرُ المشتريات والمردودات", "purchase.view"),
            ),
        ),
        DrawerGroup(
            "المستودعات",
            listOf(
                DrawerEntry(Routes.INVENTORY, "المخزون والأرصدة", "inventory.view"),
                DrawerEntry(Routes.VOUCHERS, "السندات المخزنيّة", "inventory.view"),
                DrawerEntry(Routes.COUNTS, "تسويةُ الجرد", "inventory.view"),
            ),
        ),
        DrawerGroup(
            "التوزيع والمندوبين",
            listOf(
                DrawerEntry(Routes.DISTRIBUTION, "التوزيع والمناديب", "van_sales.view"),
                DrawerEntry(Routes.SALESMEN, "أوامرُ التحميل", "van_sales.view"),
                DrawerEntry(Routes.CUSTODY, "العهدة والإقفال", "van_sales.view"),
                DrawerEntry(Routes.COLLECTION, "التحصيل", "van_sales.view"),
                DrawerEntry(Routes.POLICY, "سياسةُ العجز", "distribution.policy.manage"),
                DrawerEntry(Routes.REPORTS, "تقاريرُ التوزيع", "van_sales.view"),
            ),
        ),
        DrawerGroup("الإنتاج", listOf(DrawerEntry(Routes.PRODUCTION, "الإنتاج", "van_sales.view"))),
        DrawerGroup(
            "المحاسبة والمصروفات",
            listOf(DrawerEntry(Routes.TREASURY, "الخزينة والمصروفات", "treasury.view")),
        ),
        DrawerGroup(
            "الكتالوج",
            listOf(
                DrawerEntry(Routes.ITEMS, "الأصناف", "catalog.item.view"),
                DrawerEntry(Routes.CATEGORIES, "المجموعات", "catalog.category.view"),
                DrawerEntry(Routes.UNITS, "وحداتُ القياس", "catalog.unit.view"),
            ),
        ),
        DrawerGroup(
            "الأطراف",
            listOf(DrawerEntry(Routes.PARTIES, "العملاء والموردون", "parties.view")),
        ),
        DrawerGroup(
            "الموظفون",
            listOf(
                DrawerEntry(Routes.EMPLOYEES, "الموظفون", "hrm.view"),
                DrawerEntry(Routes.ADJUSTMENTS, "المنصرفات", "hrm.view"),
                DrawerEntry(Routes.PAYROLL, "الرواتب", "hrm.view"),
                DrawerEntry(Routes.EMPLOYEE_ACCOUNT, "حسابُ موظف", "hrm.view"),
            ),
        ),
        DrawerGroup("التقارير", listOf(DrawerEntry(Routes.SYSTEM_REPORTS, "التقارير", "reporting.view"))),
        DrawerGroup(
            "الإدارة والإعدادات",
            listOf(
                DrawerEntry(Routes.ORG, "الفروع والمستودعات والخزائن", "organization.branch.view"),
                DrawerEntry(Routes.USERS, "المستخدمون", "tenant.membership.manage"),
                DrawerEntry(Routes.ROLES, "الأدوار والصلاحيّات", "tenant.role.manage"),
                DrawerEntry(Routes.NOTIFICATIONS, "الإشعارات"),
                DrawerEntry(Routes.PRINTERS, "الطباعة والطابعات"),
                DrawerEntry(Routes.CHANGE_PASSWORD, "تغييرُ كلمة المرور"),
            ),
        ),
    )
    .map { group -> group.titleAr to group.visible(can) }
    .filter { (_, visible) -> visible.isNotEmpty() }
