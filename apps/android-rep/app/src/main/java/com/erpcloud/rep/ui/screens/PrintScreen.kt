@file:OptIn(ExperimentalMaterial3Api::class)

package com.erpcloud.rep.ui.screens

import android.graphics.Bitmap
import androidx.compose.foundation.Image
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
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.erpcloud.rep.data.api.PrintViewDto
import com.erpcloud.rep.printing.EscPos
import com.erpcloud.rep.printing.InvoiceBitmap
import com.erpcloud.rep.printing.InvoicePrint
import com.erpcloud.rep.ui.AppViewModel
import com.erpcloud.rep.ui.components.ActionButton
import com.erpcloud.rep.ui.components.CenterLoading
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * شاشةُ طباعةِ الفاتورة — تقرأ `print-view` (نسختان: العميل والمندوب الموقَّعة)،
 * ثمّ طباعةٌ عبر نظام أندرويد (أو حفظ PDF) أو مشاركةُ صورةٍ أو طباعةٌ حراريّةٌ
 * بالبلوتوث — على النسخة المُختارة.
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
    // النسخةُ المُختارة للطباعة: العميلُ أولًا، والمندوبُ تحمل خانةَ توقيع العميل.
    var copyKind by rememberSaveable { mutableStateOf("customer") }

    LaunchedEffect(documentId) {
        loading = true
        view = vm.printViewOrNull(documentId)
        loading = false
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("طباعةُ الفاتورة") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع")
                    }
                },
            )
        },
    ) { padding ->
        if (loading) {
            CenterLoading("تُقرأ نسختا الطباعة من الخادم…", Modifier.padding(padding))
            return@Scaffold
        }
        val printView = view
        if (printView == null) {
            Column(Modifier.padding(padding).padding(16.dp)) {
                Text(
                    "تعذّر قراءةُ نسخة الطباعة — رسالةُ الخطأ في شريط الإشعار أعلى الشاشة.",
                    color = MaterialTheme.colorScheme.error,
                )
            }
            return@Scaffold
        }

        val kinds = printView.copies.map { it.kind }.ifEmpty { listOf("customer") }
        if (copyKind !in kinds) copyKind = kinds.first()
        val bitmap: Bitmap = remember(printView, copyKind) {
            InvoiceBitmap.render(printView, widthPx = 1080, copyKind = copyKind)
        }

        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                kinds.forEach { kind ->
                    FilterChip(
                        selected = copyKind == kind,
                        onClick = { copyKind = kind },
                        label = { Text(if (kind == "rep") "نسخةُ المندوب (تُوقَّع)" else "نسخةُ العميل") },
                    )
                }
            }
            Text(
                "اطبعِ النسختين: نسخةَ العميل له، ونسخةَ المندوب التي تُوقَّعُ من العميل وتُعاد إلى المحاسب مع إغلاق الوردية.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Image(
                bitmap = bitmap.asImageBitmap(),
                contentDescription = "معاينةُ الفاتورة",
                contentScale = ContentScale.FillWidth,
                modifier = Modifier.fillMaxWidth(),
            )

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ActionButton(
                    label = "طباعة / PDF",
                    icon = Icons.Default.Print,
                    onClick = { InvoicePrint.printViaSystem(context, bitmap, "فاتورة ${printView.documentNumber}") },
                    modifier = Modifier.weight(1f),
                )
                ActionButton(
                    label = "مشاركة",
                    icon = Icons.AutoMirrored.Filled.Send,
                    onClick = {
                        InvoicePrint.shareImage(
                            context, bitmap,
                            "invoice-${printView.documentNumber}-$copyKind.png",
                        )
                    },
                    modifier = Modifier.weight(1f),
                )
            }

            ActionButton(
                label = if (state.session.printerMac.isBlank()) "طباعةٌ حراريّةٌ (اختر طابعةً أولًا)" else "طباعةٌ حراريّةٌ بالبلوتوث",
                icon = Icons.Default.Bluetooth,
                loading = printingBt,
                enabled = state.session.printerMac.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
                onClick = {
                    val mac = state.session.printerMac
                    val width = state.session.printerWidthDots
                    printingBt = true
                    btError = null
                    scope.launch {
                        val result = withContext(Dispatchers.IO) {
                            try {
                                // صورةٌ بعرضِ الطابعة نفسِه كي لا يُصغَّر النصّ مرّتين.
                                val printerBitmap: Bitmap =
                                    InvoiceBitmap.render(printView, widthPx = width, copyKind = copyKind)
                                EscPos.printBitmap(context, mac, width, printerBitmap)
                                null
                            } catch (error: EscPos.PrintException) {
                                error.message
                            } catch (error: Exception) {
                                error.message ?: "تعذّرت الطباعة"
                            }
                        }
                        printingBt = false
                        btError = result
                    }
                },
            )

            if (btError != null) {
                Text(btError ?: "", color = MaterialTheme.colorScheme.error)
            }
            if (state.session.printerMac.isBlank()) {
                Text(
                    "لم تُختر طابعةٌ حراريّةٌ بعد — من شاشة «طابعات البلوتوث» في مساحة العمل.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
