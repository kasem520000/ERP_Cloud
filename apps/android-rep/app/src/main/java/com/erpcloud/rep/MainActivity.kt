package com.erpcloud.rep

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
import com.erpcloud.rep.ui.AppViewModel
import com.erpcloud.rep.ui.components.NoticeBanner
import com.erpcloud.rep.ui.screens.ChangePasswordScreen
import com.erpcloud.rep.ui.screens.ClosingScreen
import com.erpcloud.rep.ui.screens.CollectionScreen
import com.erpcloud.rep.ui.screens.LoginScreen
import com.erpcloud.rep.ui.screens.NotificationsScreen
import com.erpcloud.rep.ui.screens.PrintersScreen
import com.erpcloud.rep.ui.screens.PrintScreen
import com.erpcloud.rep.ui.screens.QueueScreen
import com.erpcloud.rep.ui.screens.ReceiptScreen
import com.erpcloud.rep.ui.screens.ReturnScreen
import com.erpcloud.rep.ui.screens.SaleScreen
import com.erpcloud.rep.ui.screens.WorkspaceScreen
import com.erpcloud.rep.ui.theme.RepTheme

/**
 * FragmentActivity (لا ComponentActivity) لأنّ مكتبة البصمة الرسميّة تعرض
 * BiometricPrompt عبر Fragment — وبقيةُ Compose تعمل كما هي.
 */
class MainActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            RepTheme {
                // الواجهةُ عربيّةٌ RTL دائمًا — النصوصُ والأرقامُ المعروضةُ للمندوب عربيّة.
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
    const val SALE = "sale"
    const val RETURN = "return"
    const val COLLECTION = "collection"
    const val QUEUE = "queue"
    const val PRINTERS = "printers"
    const val CLOSING = "closing"
    const val NOTIFICATIONS = "notifications"
    const val CHANGE_PASSWORD = "change-password"
    const val RECEIPT = "receipt/{loadOrderId}"
    const val PRINT = "print/{documentId}"

    fun receipt(loadOrderId: String) = "receipt/$loadOrderId"
    fun print(documentId: String) = "print/$documentId"
}

@Composable
fun AppRoot(vm: AppViewModel) {
    val state by vm.uiState.collectAsState()
    val notice by vm.notice.collectAsState()
    val navController = rememberNavController()

    // الدخولُ والخروجُ يقودان التوجيه: بلا جلسةٍ → شاشةُ الدخول، وبجلسةٍ → المساحة.
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
                WorkspaceScreen(
                    vm = vm,
                    onSale = { navController.navigate(Routes.SALE) },
                    onReturn = { navController.navigate(Routes.RETURN) },
                    onCollection = { navController.navigate(Routes.COLLECTION) },
                    onClosing = { navController.navigate(Routes.CLOSING) },
                    onQueue = { navController.navigate(Routes.QUEUE) },
                    onPrinters = { navController.navigate(Routes.PRINTERS) },
                    onNotifications = { navController.navigate(Routes.NOTIFICATIONS) },
                    onChangePassword = { navController.navigate(Routes.CHANGE_PASSWORD) },
                    onReceipt = { id -> navController.navigate(Routes.receipt(id)) },
                    onPrint = { docId -> navController.navigate(Routes.print(docId)) },
                )
            }
            composable(Routes.SALE) { SaleScreen(vm, onDone = { navController.popBackStack() }) }
            composable(Routes.RETURN) { ReturnScreen(vm, onDone = { navController.popBackStack() }) }
            composable(Routes.COLLECTION) { CollectionScreen(vm, onDone = { navController.popBackStack() }) }
            composable(Routes.CLOSING) { ClosingScreen(vm, onDone = { navController.popBackStack() }) }
            composable(Routes.RECEIPT) { entry ->
                val id = entry.arguments?.getString("loadOrderId").orEmpty()
                ReceiptScreen(vm, loadOrderId = id, onDone = { navController.popBackStack() })
            }
            composable(Routes.PRINT) { entry ->
                val docId = entry.arguments?.getString("documentId").orEmpty()
                PrintScreen(vm, documentId = docId, onBack = { navController.popBackStack() })
            }
            composable(Routes.QUEUE) { QueueScreen(vm, onBack = { navController.popBackStack() }) }
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
