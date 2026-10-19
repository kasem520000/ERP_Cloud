package com.erpcloud.bakery

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDrawerState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
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
import com.erpcloud.bakery.ui.components.NoticeBanner
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
}

/** بندُ درجٍ — مسارٌ + عنوانٌ + إذنُ الدخول (الدخولُ بلا إذنٍ يُخفي البندَ لا أكثر). */
private data class DrawerEntry(val route: String, val titleAr: String, val permission: String?)

@Composable
fun AppRoot(vm: AppViewModel) {
    val state by vm.uiState.collectAsState()
    val notice by vm.notice.collectAsState()
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
    val entries = drawerEntries { state.can(it) }

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
                    items(entries.size) { index ->
                        val entry = entries[index]
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
        },
    ) {
        Column(Modifier.fillMaxSize()) {
            NoticeBanner(notice = notice, onDismiss = { vm.consumeNotice() })
            NavHost(
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
    }
}

/** بنودُ الدرج — وحداتُ المخبز ثمّ وحداتُ «الطاقم» المنقولة، كلٌّ بإذنه. */
private fun drawerEntries(can: (String) -> Boolean): List<DrawerEntry> =
    buildList {
        fun add(route: String, titleAr: String, permission: String? = null) {
            if (permission == null || can(permission)) add(DrawerEntry(route, titleAr, permission))
        }
        add(Routes.HOME, "اللوحة")
        add(Routes.PRODUCTION, "الإنتاج", "van_sales.view")
        add(Routes.DISTRIBUTION, "التوزيع والمناديب", "distribution.view")
        add(Routes.CUSTODY, "العهدة والإقفال", "distribution.view")
        add(Routes.SALESMEN, "أوامرُ التحميل", "distribution.view")
        add(Routes.COLLECTION, "التحصيل", "collection.view")
        add(Routes.PRICES, "أسعارُ العملاء", "sales.price.manage")
        add(Routes.REPORTS, "تقاريرُ التوزيع", "distribution.view")
        add(Routes.POLICY, "سياسةُ العجز", "distribution.policy.manage")
        add(Routes.CATALOG, "الأصناف والمجموعات", "catalog.item.view")
        add(Routes.PURCHASES, "المشتريات", "purchase.view")
        add(Routes.VOUCHERS, "السندات المخزنيّة", "inventory.view")
        add(Routes.INVENTORY, "المخزون والأرصدة", "inventory.view")
        add(Routes.COUNTS, "تسويةُ الجرد", "inventory.view")
        add(Routes.TREASURY, "الخزينة والمصروفات", "treasury.view")
        add(Routes.PARTIES, "العملاء والموردون", "parties.view")
        add(Routes.POS, "نقطة البيع", "pos.view")
        add(Routes.EMPLOYEES, "الموظفون", "hrm.view")
        add(Routes.ADJUSTMENTS, "المنصرفات", "hrm.view")
        add(Routes.PAYROLL, "الرواتب", "hrm.view")
        add(Routes.EMPLOYEE_ACCOUNT, "حسابُ موظف", "hrm.view")
        add(Routes.SALES_REGISTRY, "مناديبُ المبيعات", "sales.view")
        add(Routes.USERS, "المستخدمون", "tenant.membership.manage")
        add(Routes.ROLES, "الأدوار والصلاحيّات", "tenant.role.manage")
        add(Routes.SYSTEM_REPORTS, "التقارير", "reporting.view")
        add(Routes.NOTIFICATIONS, "الإشعارات")
        add(Routes.PRINTERS, "الطباعة والطابعات")
        add(Routes.CHANGE_PASSWORD, "تغييرُ كلمة المرور")
    }
