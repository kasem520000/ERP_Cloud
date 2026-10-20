@file:OptIn(ExperimentalMaterial3Api::class)

package com.erpcloud.rep.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.erpcloud.rep.printing.EscPos
import com.erpcloud.rep.ui.AppViewModel
import com.erpcloud.rep.ui.components.SectionCard

/** شاشةُ الطابعات — اختيارُ طابعةٍ مقترنةٍ وعرضِ ورقها (٥٨/٨٠ ملم). */
@Composable
fun PrintersScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current

    var devices by remember { mutableStateOf<List<EscPos.PrinterDevice>>(emptyList()) }
    var selectedMac by remember { mutableStateOf(state.session.printerMac) }
    var width by remember { mutableStateOf(if (state.session.printerWidthDots == 384) 384 else 576) }
    var permissionGranted by remember { mutableStateOf(true) }

    fun loadDevices() {
        devices = EscPos.bondedPrinters(context)
    }

    // إذنُ الاتصال بالبلوتوث على أندرويد ١٢+ — الأجهزةُ الأقدم لا تحتاجه للاقتران القائم.
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        permissionGranted = grants.values.all { it }
        if (permissionGranted) loadDevices()
    }

    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= 31) {
            val needed = arrayOf(Manifest.permission.BLUETOOTH_CONNECT)
            val granted = needed.all {
                ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
            }
            if (!granted) {
                permissionGranted = false
                permissionLauncher.launch(needed)
                return@LaunchedEffect
            }
        }
        loadDevices()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("طابعاتُ البلوتوث") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SectionCard(
                title = "الطابعةُ الحاليّة",
                subtitle = if (state.session.printerMac.isBlank()) {
                    "لم تُختر طابعةٌ بعد"
                } else {
                    val device = devices.firstOrNull { it.address == state.session.printerMac }
                    "${device?.name ?: state.session.printerMac} (${if (state.session.printerWidthDots == 384) "٥٨ملم" else "٨٠ملم"})"
                },
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = width == 576,
                        onClick = {
                            width = 576
                            if (selectedMac.isNotBlank()) vm.setPrinter(selectedMac, 576)
                        },
                        label = { Text("ورق ٨٠ملم") },
                    )
                    FilterChip(
                        selected = width == 384,
                        onClick = {
                            width = 384
                            if (selectedMac.isNotBlank()) vm.setPrinter(selectedMac, 384)
                        },
                        label = { Text("ورق ٥٨ملم") },
                    )
                }
            }

            SectionCard(
                title = "الأجهزةُ المقترنة",
                subtitle = "اقرنِ الطابعةَ من إعدادات البلوتوث في الجهاز أولًا ثم اضغط «تحديث القائمة».",
            ) {
                if (!permissionGranted) {
                    Text(
                        "إذنُ «الأجهزة القريبة» مطلوبٌ لعرض الطابعات وطباعتها — امنحه من إعدادات التطبيق.",
                        color = MaterialTheme.colorScheme.error,
                    )
                }
                if (devices.isEmpty()) {
                    Text("لا أجهزةَ مقترنة.")
                } else {
                    devices.forEach { device ->
                        Row(
                            Modifier.fillMaxWidth().padding(vertical = 4.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(device.name)
                                Text(
                                    device.address,
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            OutlinedButton(
                                onClick = {
                                    selectedMac = device.address
                                    vm.setPrinter(device.address, width)
                                },
                            ) { Text(if (selectedMac == device.address) "مُختارة" else "اختيار") }
                        }
                    }
                }
                OutlinedButton(onClick = { loadDevices() }, modifier = Modifier.fillMaxWidth()) {
                    Text("تحديثُ القائمة")
                }
            }

            SectionCard(title = "ملاحظة") {
                Text(
                    "طباعةُ الفاتورة عبر البلوتوث تُرسل صورةَ الفاتورة كاملةً إلى الطابعة، فتخرجُ " +
                        "العربيّةُ والرقمُ الضريبيُّ ورمزُ QR سليمةً على أيّ طابعةٍ حراريّةٍ تدعم ESC/POS " +
                        "ولو لم تكن تدعم العربيّة نصًّا.",
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
    }
}
