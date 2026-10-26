@file:OptIn(ExperimentalMaterial3Api::class)

package com.erpcloud.rep.ui.screens

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Bluetooth
import androidx.compose.material.icons.filled.Print
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.erpcloud.rep.data.api.PrintViewDto
import com.erpcloud.rep.printing.EscPos
import com.erpcloud.rep.printing.InvoiceBitmap
import com.erpcloud.rep.printing.InvoicePrint
import com.erpcloud.rep.ui.AppViewModel
import com.erpcloud.rep.ui.components.ActionButton
import com.erpcloud.rep.ui.components.CenterLoading
import com.erpcloud.rep.ui.components.ChipTone
import com.erpcloud.rep.ui.components.InfoCallout
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * شاشةُ طباعةِ فاتورة الكاشير — تطبع افتراضيًّا **نسختين معًا** (نسخة العميل الأصل
 + نسخة المندوب المخصّصة للتوقيع والمحاسبة) بضغطةٍ واحدة عبر البلوتوث أو PDF.
 */
@Composable
fun PrintScreen(vm: AppViewModel, documentId: String, onBack: () -> Unit) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var view by remember { mutableStateOf<PrintViewDto?>(null) }
    var loading by remember { mutableStateOf(true) }
    var printingBt by remember { mutableStateOf(false) }
    var btError by remember { mutableStateOf<String?>(null) }
    var btSuccess by remember { mutableStateOf<String?>(null) }
    // الافتراضيّ: طباعةُ النسختين معًا (العميل + المندوب).
    var copyMode by rememberSaveable { mutableStateOf("both") }
    var bitmap by remember { mutableStateOf<Bitmap?>(null) }
    var rendering by remember { mutableStateOf(true) }

    LaunchedEffect(documentId) {
        loading = true
        view = vm.printViewOrNull(documentId)
        loading = false
    }

    val currentView = view
    LaunchedEffect(currentView, copyMode) {
        if (currentView == null) return@LaunchedEffect
        rendering = true
        bitmap = withContext(Dispatchers.Default) {
            if (copyMode == "both") {
                InvoiceBitmap.renderTwoCopies(currentView, widthPx = 1080)
            } else {
                InvoiceBitmap.render(currentView, widthPx = 1080, copyKind = copyMode)
            }
        }
        rendering = false
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("طباعة فاتورة الكاشير (نسختين)", fontWeight = FontWeight.ExtraBold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع")
                    }
                },
            )
        },
    ) { padding ->
        if (loading) {
            CenterLoading("تُجهَّز نسختا فاتورة الكاشير من الخادم…", Modifier.padding(padding))
            return@Scaffold
        }
        val printView = view
        if (printView == null) {
            Column(Modifier.padding(padding).padding(16.dp)) {
                InfoCallout(
                    "تعذّر قراءةُ بيانات الطباعة من الخادم — تحقّق من الاتصال وأعد المحاولة.",
                    ChipTone.DANGER,
                )
            }
            return@Scaffold
        }

        val preview = bitmap

        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                FilterChip(
                    selected = copyMode == "both",
                    onClick = { copyMode = "both"; btSuccess = null },
                    label = { Text("نسختان معًا (العميل + المندوب)") },
                )
                FilterChip(
                    selected = copyMode == "customer",
                    onClick = { copyMode = "customer"; btSuccess = null },
                    label = { Text("نسخة العميل فقط (١/٢)") },
                )
                FilterChip(
                    selected = copyMode == "rep",
                    onClick = { copyMode = "rep"; btSuccess = null },
                    label = { Text("نسخة المندوب فقط (٢/٢)") },
                )
            }

            InfoCallout(
                if (copyMode == "both") {
                    "وضعُ النسختين مفعّل: ستُطبَع نسخةُ العميل أولًا ثمّ تُقطع وتُطبَع نسخةُ المندوب المخصّصة للتوقيع وتسليم المحاسبة."
                } else {
                    "تُطبع الآن نسخةٌ مفردة — اختر «نسختان معًا» لطباعة نسختَي العميل والمندوب دفعةً واحدة."
                },
                ChipTone.INFO,
            )

            if (rendering || preview == null) {
                CenterLoading("تُرسمُ معاينةُ الفاتورة…")
            } else {
                ActionButton(
                    label = when {
                        state.session.printerMac.isBlank() -> "طباعة حراريّة (اختر طابعة بلوتوث أولًا)"
                        copyMode == "both" -> "طباعة النسختين حراريًّا بالبلوتوث"
                        else -> "طباعة هذه النسخة حراريًّا بالبلوتوث"
                    },
                    icon = Icons.Default.Bluetooth,
                    loading = printingBt,
                    enabled = state.session.printerMac.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                    onClick = {
                        val mac = state.session.printerMac
                        val width = state.session.printerWidthDots
                        printingBt = true
                        btError = null
                        btSuccess = null
                        scope.launch {
                            val result = withContext(Dispatchers.IO) {
                                try {
                                    if (copyMode == "both") {
                                        val copies = InvoiceBitmap.renderPairForThermal(printView, widthPx = width)
                                        EscPos.printBitmaps(context, mac, width, copies)
                                    } else {
                                        val single = InvoiceBitmap.render(printView, widthPx = width, copyKind = copyMode)
                                        EscPos.printBitmap(context, mac, width, single)
                                    }
                                    null
                                } catch (error: EscPos.PrintException) {
                                    error.message
                                } catch (error: Exception) {
                                    error.message ?: "تعذّرت الطباعة"
                                }
                            }
                            printingBt = false
                            btError = result
                            if (result == null) {
                                btSuccess = if (copyMode == "both") {
                                    "تمّت طباعةُ النسختين (نسخة العميل + نسخة المندوب) بنجاح ✓"
                                } else {
                                    "تمّت طباعةُ النسخة بنجاح ✓"
                                }
                            }
                        }
                    },
                )

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ActionButton(
                        label = if (copyMode == "both") "طباعة نسختين / PDF" else "طباعة / PDF",
                        icon = Icons.Default.Print,
                        onClick = {
                            val ok = InvoicePrint.printViaSystem(
                                context, preview, "فاتورة كاشير ${printView.documentNumber}",
                            )
                            if (!ok) btError = "تعذّر فتح نافذة الطباعة في النظام — جرّب المشاركة."
                        },
                        modifier = Modifier.weight(1f),
                    )
                    ActionButton(
                        label = "مشاركة",
                        icon = Icons.AutoMirrored.Filled.Send,
                        onClick = {
                            InvoicePrint.shareImage(
                                context, preview,
                                "invoice-${printView.documentNumber}-$copyMode.png",
                            )
                        },
                        modifier = Modifier.weight(1f),
                    )
                }

                if (btSuccess != null) {
                    InfoCallout(btSuccess ?: "", ChipTone.OK)
                }
                if (btError != null) {
                    InfoCallout(btError ?: "", ChipTone.DANGER)
                }
                if (state.session.printerMac.isBlank()) {
                    InfoCallout(
                        "لم تُختر طابعةٌ حراريّةٌ بعد — يمكنك ربطها من «طابعات البلوتوث» في القائمة الجانبيّة، أو الطباعة كـ PDF الآن.",
                        ChipTone.WARN,
                    )
                }

                Image(
                    bitmap = preview.asImageBitmap(),
                    contentDescription = "معاينةُ فاتورة الكاشير",
                    contentScale = ContentScale.FillWidth,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}
