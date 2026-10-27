package com.erpcloud.rep

import android.net.Uri
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.ReceiptLong
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.FactCheck
import androidx.compose.material.icons.filled.LocalShipping
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Password
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.PointOfSale
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.SupportAgent
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.NavigationDrawerItemDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.erpcloud.rep.data.offline.QueueStatus
import com.erpcloud.rep.ui.AppViewModel
import com.erpcloud.rep.ui.components.BadgeCount
import com.erpcloud.rep.ui.components.NoticeBanner
import com.erpcloud.rep.ui.screens.BrandCrestLogo
import com.erpcloud.rep.ui.screens.ChangePasswordScreen
import com.erpcloud.rep.ui.screens.ClosingScreen
import com.erpcloud.rep.ui.screens.CollectionScreen
import com.erpcloud.rep.ui.screens.CustodyOverviewScreen
import com.erpcloud.rep.ui.screens.DocumentsScreen
import com.erpcloud.rep.ui.screens.LoginScreen
import com.erpcloud.rep.ui.screens.NotificationsScreen
import com.erpcloud.rep.ui.screens.PrintScreen
import com.erpcloud.rep.ui.screens.PrintersScreen
import com.erpcloud.rep.ui.screens.QueueScreen
import com.erpcloud.rep.ui.screens.REP_EDITION_LABEL
import com.erpcloud.rep.ui.screens.ReceiptScreen
import com.erpcloud.rep.ui.screens.ReturnScreen
import com.erpcloud.rep.ui.screens.SaleScreen
import com.erpcloud.rep.ui.screens.SplashScreen
import com.erpcloud.rep.ui.screens.SupportScreen
import com.erpcloud.rep.ui.screens.WorkspaceScreen
import com.erpcloud.rep.ui.theme.RepTheme
import kotlinx.coroutines.launch

/**
 * FragmentActivity (لا ComponentActivity) لأنّ مكتبة البصمة الرسميّة تعرض
 * BiometricPrompt عبر Fragment — وبقيةُ Compose تعمل كما هي مع قائمة جانبية RTL.
 */
class MainActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        com.erpcloud.rep.printing.InvoicePrint.attachActivity(this)
        enableEdgeToEdge()
        setContent {
            RepTheme {
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
        com.erpcloud.rep.printing.InvoicePrint.detachActivity(this)
        super.onDestroy()
    }
}

private object Routes {
    const val LOGIN = "login"
    const val HOME = "home"
    const val CUSTODY = "custody/{tab}"
    const val CUSTODY_PREFIX = "custody/"
    const val DOCUMENTS = "documents"
    const val SALE = "sale"
    const val RETURN = "return"
    const val COLLECTION = "collection"
    const val QUEUE = "queue"
    const val PRINTERS = "printers"
    const val CLOSING = "closing"
    const val NOTIFICATIONS = "notifications"
    const val CHANGE_PASSWORD = "change-password"
    const val SUPPORT = "support"
    const val RECEIPT = "receipt/{loadOrderId}"
    const val PRINT = "print/{documentId}"

    fun custody(tab: String = "balances") = "custody/${Uri.encode(tab)}"
    fun receipt(loadOrderId: String) = "receipt/${Uri.encode(loadOrderId)}"
    fun print(documentId: String) = "print/${Uri.encode(documentId)}"
}

private data class RepDrawerItem(
    val route: String,
    val label: String,
    val icon: ImageVector,
    val perm: String? = null,
    val badge: Int = 0,
    val matchPrefix: String = route,
)

private data class RepDrawerGroup(
    val title: String,
    val items: List<RepDrawerItem>,
)

@Composable
fun AppRoot(vm: AppViewModel) {
    val state by vm.uiState.collectAsState()
    val notice by vm.notice.collectAsState()
    val navController = rememberNavController()
    val drawerState = rememberDrawerState(initialValue = DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route ?: Routes.HOME

    if (!state.sessionLoaded || !state.splashDone) {
        SplashScreen(
            systemName = state.session.brandName,
            taglineAr = state.session.brandTagline,
        )
        return
    }

    LaunchedEffect(state.session.loggedIn) {
        val current = navController.currentBackStackEntry?.destination?.route
        if (state.session.loggedIn && current == Routes.LOGIN) {
            navController.navigate(Routes.HOME) {
                popUpTo(Routes.LOGIN) { inclusive = true }
            }
        } else if (!state.session.loggedIn && current != Routes.LOGIN) {
            scope.launch { drawerState.close() }
            navController.navigate(Routes.LOGIN) {
                popUpTo(0) { inclusive = true }
            }
        }
    }

    val pendingReceiptsCount = state.workspace?.pendingReceipts?.size ?: 0
    val pendingQueueCount = state.scopedQueue.count {
        it.queueStatus == QueueStatus.PENDING || it.queueStatus == QueueStatus.REFUSED
    }
    val defaultCustodyRoute = Routes.custody(if (pendingReceiptsCount > 0) "receipts" else "balances")

    val drawerGroups = listOf(
        RepDrawerGroup(
            "العمليات اليومية",
            listOf(
                RepDrawerItem(Routes.HOME, "ملخص الوردية", Icons.Default.Dashboard),
                RepDrawerItem(
                    route = defaultCustodyRoute,
                    label = "التوريدات وعهدة السيارة",
                    icon = Icons.Default.LocalShipping,
                    badge = pendingReceiptsCount,
                    matchPrefix = Routes.CUSTODY_PREFIX,
                ),
                RepDrawerItem(
                    route = Routes.SALE,
                    label = "بيعٌ جديد",
                    icon = Icons.Default.PointOfSale,
                    perm = "van_sales.invoice.create",
                ),
                RepDrawerItem(
                    route = Routes.COLLECTION,
                    label = "تحصيلُ دين",
                    icon = Icons.Default.Payments,
                    perm = "van_sales.collection.create",
                ),
                RepDrawerItem(
                    route = Routes.RETURN,
                    label = "مرتجعُ عميل",
                    icon = Icons.AutoMirrored.Filled.Reply,
                    perm = "van_sales.invoice.create",
                ),
                RepDrawerItem(
                    route = Routes.CLOSING,
                    label = "إغلاقُ الوردية",
                    icon = Icons.Default.FactCheck,
                    perm = "van_sales.closing.submit",
                ),
            ),
        ),
        RepDrawerGroup(
            "السجلات والطباعة",
            listOf(
                RepDrawerItem(
                    route = Routes.DOCUMENTS,
                    label = "الفواتير والتحصيلات",
                    icon = Icons.AutoMirrored.Filled.ReceiptLong,
                ),
                RepDrawerItem(
                    route = Routes.QUEUE,
                    label = "طابور عدم الاتصال",
                    icon = Icons.Default.Sync,
                    badge = pendingQueueCount,
                ),
                RepDrawerItem(
                    route = Routes.PRINTERS,
                    label = "الطابعات الحرارية",
                    icon = Icons.Default.Print,
                ),
            ),
        ),
        RepDrawerGroup(
            "الحساب والدعم",
            listOf(
                RepDrawerItem(
                    route = Routes.NOTIFICATIONS,
                    label = "الإشعارات",
                    icon = Icons.Default.Notifications,
                    badge = state.workspaceUnread,
                ),
                RepDrawerItem(
                    route = Routes.SUPPORT,
                    label = "الدعم الفنّي",
                    icon = Icons.Default.SupportAgent,
                ),
                RepDrawerItem(
                    route = Routes.CHANGE_PASSWORD,
                    label = "تغييرُ كلمة المرور",
                    icon = Icons.Default.Password,
                ),
            ),
        ),
    )

    fun navigateFromDrawer(route: String) {
        scope.launch { drawerState.close() }
        if (route == Routes.HOME) {
            navController.popBackStack(Routes.HOME, inclusive = false)
        } else {
            navController.navigate(route) {
                popUpTo(Routes.HOME) { saveState = false }
                launchSingleTop = true
            }
        }
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        gesturesEnabled = state.session.loggedIn && currentRoute != Routes.LOGIN,
        drawerContent = {
            if (state.session.loggedIn) {
                ModalDrawerSheet(modifier = Modifier.width(305.dp)) {
                    Column(
                        Modifier
                            .verticalScroll(rememberScrollState())
                            .padding(vertical = 12.dp),
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            BrandCrestLogo(size = 46.dp)
                            Column(Modifier.weight(1f)) {
                                Text(
                                    state.session.brandName,
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.ExtraBold,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    REP_EDITION_LABEL,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.primary,
                                    fontWeight = FontWeight.Bold,
                                )
                                val repLine = listOfNotNull(
                                    state.workspace?.salesmanName?.takeIf { it.isNotBlank() },
                                    state.workspace?.vehiclePlate?.takeIf { it.isNotBlank() },
                                ).joinToString(" · ")
                                if (repLine.isNotBlank()) {
                                    Text(
                                        repLine,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                            }
                        }

                        HorizontalDivider(Modifier.padding(vertical = 6.dp))

                        drawerGroups.forEach { group ->
                            val visibleItems = group.items.filter { it.perm == null || state.can(it.perm) }
                            if (visibleItems.isNotEmpty()) {
                                Text(
                                    group.title,
                                    style = MaterialTheme.typography.labelMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp),
                                )
                                visibleItems.forEach { item ->
                                    val selected = if (item.matchPrefix == Routes.CUSTODY_PREFIX) {
                                        currentRoute.startsWith("custody")
                                    } else {
                                        currentRoute == item.route
                                    }
                                    NavigationDrawerItem(
                                        label = {
                                            Text(
                                                item.label,
                                                fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                                            )
                                        },
                                        selected = selected,
                                        onClick = { navigateFromDrawer(item.route) },
                                        icon = { Icon(item.icon, contentDescription = null) },
                                        badge = if (item.badge > 0) {
                                            { BadgeCount(item.badge) }
                                        } else {
                                            null
                                        },
                                        shape = RoundedCornerShape(12.dp),
                                        modifier = Modifier.padding(NavigationDrawerItemDefaults.ItemPadding),
                                    )
                                }
                                Spacer(Modifier.height(4.dp))
                            }
                        }

                        HorizontalDivider(Modifier.padding(vertical = 6.dp))
                        NavigationDrawerItem(
                            label = {
                                Text(
                                    "تسجيل الخروج",
                                    color = MaterialTheme.colorScheme.error,
                                    fontWeight = FontWeight.Bold,
                                )
                            },
                            selected = false,
                            onClick = {
                                scope.launch { drawerState.close() }
                                vm.logout()
                            },
                            icon = {
                                Icon(
                                    Icons.AutoMirrored.Filled.Logout,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.error,
                                )
                            },
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.padding(NavigationDrawerItemDefaults.ItemPadding),
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
                    WorkspaceScreen(
                        vm = vm,
                        onMenu = { scope.launch { drawerState.open() } },
                        onSale = { navController.navigate(Routes.SALE) },
                        onReturn = { navController.navigate(Routes.RETURN) },
                        onCollection = { navController.navigate(Routes.COLLECTION) },
                        onClosing = { navController.navigate(Routes.CLOSING) },
                        onCustody = { tab -> navController.navigate(Routes.custody(tab)) },
                        onDocuments = { navController.navigate(Routes.DOCUMENTS) },
                        onQueue = { navController.navigate(Routes.QUEUE) },
                        onPrinters = { navController.navigate(Routes.PRINTERS) },
                        onNotifications = { navController.navigate(Routes.NOTIFICATIONS) },
                        onChangePassword = { navController.navigate(Routes.CHANGE_PASSWORD) },
                        onSupport = { navController.navigate(Routes.SUPPORT) },
                    )
                }
                composable(
                    route = Routes.CUSTODY,
                    arguments = listOf(navArgument("tab") { type = NavType.StringType }),
                ) { entry ->
                    val tab = entry.arguments?.getString("tab") ?: "balances"
                    CustodyOverviewScreen(
                        vm = vm,
                        initialTab = tab,
                        onBack = { navController.popBackStack() },
                        onReceipt = { id -> navController.navigate(Routes.receipt(id)) },
                        onClosing = { navController.navigate(Routes.CLOSING) },
                    )
                }
                composable(Routes.DOCUMENTS) {
                    DocumentsScreen(
                        vm = vm,
                        onBack = { navController.popBackStack() },
                        onNewSale = { navController.navigate(Routes.SALE) },
                        onReturn = { navController.navigate(Routes.RETURN) },
                        onCollection = { navController.navigate(Routes.COLLECTION) },
                        onPrint = { docId -> navController.navigate(Routes.print(docId)) },
                    )
                }
                composable(Routes.SALE) {
                    SaleScreen(
                        vm = vm,
                        onDone = { navController.popBackStack() },
                        onPrintSale = { docId ->
                            navController.navigate(Routes.print(docId)) {
                                popUpTo(Routes.SALE) { inclusive = true }
                            }
                        },
                    )
                }
                composable(Routes.RETURN) {
                    ReturnScreen(vm, onDone = { navController.popBackStack() })
                }
                composable(Routes.COLLECTION) {
                    CollectionScreen(vm, onDone = { navController.popBackStack() })
                }
                composable(Routes.CLOSING) {
                    ClosingScreen(vm, onDone = { navController.popBackStack() })
                }
                composable(Routes.RECEIPT) { entry ->
                    val id = entry.arguments?.getString("loadOrderId").orEmpty()
                    ReceiptScreen(vm, loadOrderId = id, onDone = { navController.popBackStack() })
                }
                composable(Routes.PRINT) { entry ->
                    val docId = entry.arguments?.getString("documentId").orEmpty()
                    PrintScreen(vm, documentId = docId, onBack = { navController.popBackStack() })
                }
                composable(Routes.QUEUE) {
                    QueueScreen(vm, onBack = { navController.popBackStack() })
                }
                composable(Routes.PRINTERS) {
                    PrintersScreen(vm, onBack = { navController.popBackStack() })
                }
                composable(Routes.NOTIFICATIONS) {
                    NotificationsScreen(vm, onBack = { navController.popBackStack() })
                }
                composable(Routes.CHANGE_PASSWORD) {
                    ChangePasswordScreen(vm, onBack = { navController.popBackStack() })
                }
                composable(Routes.SUPPORT) {
                    SupportScreen(vm, onBack = { navController.popBackStack() })
                }
            }
        }
    }
}
