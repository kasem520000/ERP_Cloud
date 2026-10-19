package com.erpcloud.bakery

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.NoticeBanner
import com.erpcloud.bakery.ui.screens.ChangePasswordScreen
import com.erpcloud.bakery.ui.screens.CollectionScreen
import com.erpcloud.bakery.ui.screens.CustodyScreen
import com.erpcloud.bakery.ui.screens.DashboardScreen
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
}

@Composable
fun AppRoot(vm: AppViewModel) {
    val state by vm.uiState.collectAsState()
    val notice by vm.notice.collectAsState()
    val navController = rememberNavController()

    // الدخولُ والخروجُ يقودان التوجيه.
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

    if (!state.sessionLoaded) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }

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
        }
    }
}
