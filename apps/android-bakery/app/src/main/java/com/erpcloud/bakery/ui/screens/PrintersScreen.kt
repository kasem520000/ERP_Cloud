@file:OptIn(ExperimentalMaterial3Api::class)

package com.erpcloud.bakery.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.os.Build
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.erpcloud.bakery.printing.EscPos
import com.erpcloud.bakery.printing.PrintKit
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.ActionButton
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.KeyValue
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.components.StatusChip
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

/** شاشةُ الطابعات — اختيارُ طابعةٍ مقترنةٍ وعرضِ ورقها (٥٨/٨٠ ملم). */
@Composable
fun PrintersScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current

    var devices by remember { mutableStateOf<List<EscPos.PrinterDevice>>(emptyList()) }
    var selectedMac by remember { mutableStateOf(state.session.printerMac) }
    var width by remember { mutableStateOf(if (state.session.printerWidthDots == 384) 384 else 576) }
    var permissionGranted by remember { mutableStateOf(true) }
    var testBusy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

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
                    "غير محددة"
                } else {
                    val device = devices.firstOrNull { it.address == state.session.printerMac }
                    "${device?.name ?: state.session.printerMac} (${if (state.session.printerWidthDots == 384) "٥٨ملم" else "٨٠ملم"})"
                },
            ) {
                if (state.session.printerMac.isBlank()) {
                    StatusChip("غير محددة", ChipTone.WARN)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "ستُوجَّه الطباعةُ إلى خدمة الطباعة في النظام (أو «حفظ PDF») حتى تختار طابعةً مقترنةً.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    KeyValue("العنوان (MAC)", state.session.printerMac)
                    KeyValue(
                        "عرضُ الورق",
                        if (state.session.printerWidthDots == 384) "٥٨ملم — ٣٨٤ نقطة" else "٨٠ملم — ٥٧٦ نقطة",
                    )
                }
                Spacer(Modifier.height(8.dp))

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

                Spacer(Modifier.height(10.dp))
                ActionButton(
                    label = if (testBusy) "جارٍ الطباعة…" else "طباعة اختبار",
                    onClick = {
                        testBusy = true
                        scope.launch {
                            try {
                                val bitmap = withContext(Dispatchers.IO) {
                                    val rendered = testPrintBitmap(width, selectedMac)
                                    if (selectedMac.isNotBlank()) {
                                        EscPos.printBitmap(context, selectedMac, width, rendered)
                                    }
                                    rendered
                                }
                                if (selectedMac.isBlank()) {
                                    PrintKit.printViaSystem(context, bitmap, "اختبار الطباعة")
                                }
                            } catch (error: Exception) {
                                vm.showPrintError(error.message ?: "تعذّرت طباعةُ الاختبار")
                            } finally {
                                testBusy = false
                            }
                        }
                    },
                    enabled = !testBusy,
                    loading = testBusy,
                    modifier = Modifier.fillMaxWidth(),
                )
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


/** صورةُ اختبار الطباعة — سطورٌ عربيّةٌ قليلةٌ على أبيض، بمسارِ رسمٍ مبسّطٍ على نمطِ BakeryDocs (StaticLayout + TextPaint بخطّ النظام — العربيّةُ تُرسمُ سليمةً). */
private fun testPrintBitmap(widthDots: Int, mac: String): Bitmap {
    val width = widthDots.coerceAtLeast(200)
    val pad = width / 22
    val bodySize = (width / 26f).coerceIn(9f, 42f)
    val titleSize = bodySize * 1.5f

    fun paint(size: Float, bold: Boolean) = TextPaint().apply {
        isAntiAlias = true
        textSize = size
        color = Color.BLACK
        isFakeBoldText = bold
    }

    fun line(text: String, tp: TextPaint): StaticLayout =
        StaticLayout.Builder.obtain(text, 0, text.length, tp, (width - pad * 2).coerceAtLeast(1))
            .setAlignment(Layout.Alignment.ALIGN_CENTER)
            .setLineSpacing(0f, 1.15f)
            .build()

    val stamp = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"))
    val blocks = listOf(
        line("اختبار الطباعة — المخبز", paint(titleSize, bold = true)),
        line(if (mac.isBlank()) "بدون طابعةٍ مختارة — طباعةُ النظام" else "الطابعة: $mac", paint(bodySize, false)),
        line("عرضُ الورق: $widthDots نقطة", paint(bodySize, false)),
        line(stamp, paint(bodySize, false)),
    )
    val height = pad * 2 + blocks.sumOf { it.height }
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.RGB_565)
    val canvas = Canvas(bitmap)
    canvas.drawColor(Color.WHITE)
    var y = pad.toFloat()
    for (block in blocks) {
        canvas.save()
        canvas.translate(pad.toFloat(), y)
        block.draw(canvas)
        canvas.restore()
        y += block.height
    }
    return bitmap
}
