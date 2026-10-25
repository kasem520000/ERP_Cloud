@file:OptIn(ExperimentalMaterial3Api::class)

package com.erpcloud.bakery.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.CloudSync
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Replay
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.erpcloud.bakery.data.ActionResult
import com.erpcloud.bakery.data.api.EinvoiceChainStateDto
import com.erpcloud.bakery.data.api.EinvoiceFilingDetailDto
import com.erpcloud.bakery.data.api.EinvoiceFilingPageDto
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.DatePickerField
import com.erpcloud.bakery.ui.components.EmptyState
import com.erpcloud.bakery.ui.components.InfoCallout
import com.erpcloud.bakery.ui.components.KeyValue
import com.erpcloud.bakery.ui.components.ListItemCard
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.components.StatTile
import com.erpcloud.bakery.ui.components.StatusChip
import com.erpcloud.bakery.util.Dec
import kotlinx.coroutines.launch

private val FILING_STATUS_FILTERS = listOf(
    "" to "الكل",
    "accepted" to "مُعتمدة",
    "cleared" to "مُجازة (Cleared)",
    "reported" to "مُبلّغة (Reported)",
    "pending" to "قيد الرفع",
    "failed" to "فاشلة / مرفوضة",
)

private fun filingStatusChip(status: String, authorityStatus: String?): Pair<String, ChipTone> {
    val normalized = (authorityStatus?.takeIf { it.isNotBlank() } ?: status).lowercase()
    return when {
        normalized in setOf("cleared", "reported", "accepted", "submitted", "valid", "passed") ->
            "مقبولة ضريبيًّا (${authorityStatus ?: status})" to ChipTone.OK
        normalized.contains("warn") ->
            "مقبولة بتحذير" to ChipTone.WARN
        normalized in setOf("pending", "queued", "processing") ->
            "قيد الرفع" to ChipTone.INFO
        normalized in setOf("failed", "rejected", "error") ->
            "مرفوضة / فشل الرفع" to ChipTone.DANGER
        else -> status.ifBlank { "غير محدّد" } to ChipTone.NEUTRAL
    }
}

/**
 * شاشةُ «الفواتير الضريبية» — تقريرُ الفواتير المرفوعة على موقع الزكاة والضريبة (ZATCA)،
 * مع حالة السلسلة التشفيريّة، التصفية بالتاريخ والحالة، المزامنة الفوريّة، وإعادة المحاولة.
 */
@Composable
fun TaxFilingsScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()

    var statusFilter by rememberSaveable { mutableStateOf("") }
    var fromDate by rememberSaveable { mutableStateOf("") }
    var toDate by rememberSaveable { mutableStateOf("") }
    var pageNo by rememberSaveable { mutableIntStateOf(1) }

    var page by remember { mutableStateOf(EinvoiceFilingPageDto()) }
    var chain by remember { mutableStateOf<EinvoiceChainStateDto?>(null) }
    var selectedId by rememberSaveable { mutableStateOf<String?>(null) }
    var detail by remember { mutableStateOf<EinvoiceFilingDetailDto?>(null) }

    var loading by remember { mutableStateOf(true) }
    var loadingDetail by remember { mutableStateOf(false) }
    var syncing by remember { mutableStateOf(false) }
    var retrying by remember { mutableStateOf(false) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    fun reload() {
        scope.launch {
            loading = true
            errorMsg = null
            try {
                page = vm.einvoiceFilings(
                    status = statusFilter.takeIf { it.isNotBlank() },
                    from = fromDate.takeIf { it.isNotBlank() },
                    to = toDate.takeIf { it.isNotBlank() },
                    pageNo = pageNo,
                    pageSize = 30,
                )
                chain = vm.einvoiceChain()
            } catch (e: Exception) {
                errorMsg = vm.friendlyError(e)
            } finally {
                loading = false
            }
        }
    }

    LaunchedEffect(statusFilter, fromDate, toDate, pageNo) { reload() }

    LaunchedEffect(selectedId) {
        val id = selectedId
        if (id == null) {
            detail = null
            return@LaunchedEffect
        }
        loadingDetail = true
        try {
            detail = vm.einvoiceFilingDetail(id)
        } catch (e: Exception) {
            vm.showNoticeDanger(vm.friendlyError(e))
        } finally {
            loadingDetail = false
        }
    }

    // رجوعٌ سليم: من تفصيل الفاتورة يعود إلى قائمة الفواتير الضريبية.
    BackHandler(enabled = selectedId != null) {
        selectedId = null
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            if (selectedId != null) "تفاصيل الرفع الضريبي" else "الفواتير الضريبية",
                            fontWeight = FontWeight.ExtraBold,
                        )
                        if (selectedId == null) {
                            Text(
                                "الفواتير المرفوعة لبوابة الزكاة والضريبة",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(
                        onClick = {
                            if (selectedId != null) selectedId = null else onBack()
                        },
                    ) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع")
                    }
                },
                actions = {
                    if (selectedId == null) {
                        IconButton(onClick = { reload() }) {
                            Icon(Icons.Default.Refresh, contentDescription = "تحديث")
                        }
                    }
                },
            )
        },
    ) { padding ->
        if (selectedId != null) {
            val d = detail
            Column(
                Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (loadingDetail && d == null) {
                    CenterLoading("جارٍ قراءة شهادة الرفع والتوقيع…")
                } else if (d == null) {
                    EmptyState("تعذّر تحميل تفاصيل الرفع الضريبي.")
                } else {
                    val sub = d.submission
                    val (stLabel, stTone) = filingStatusChip(sub.status, sub.authorityStatus)
                    SectionCard(title = "الفاتورة ${d.invoice?.number ?: sub.invoice?.number ?: "—"}") {
                        StatusChip(stLabel, stTone)
                        Spacer(Modifier.height(8.dp))
                        d.invoice?.let { inv ->
                            KeyValue("الإجمالي شامل الضريبة", "${Dec.money(inv.total)} ${inv.currency}")
                            KeyValue("ضريبة القيمة المضافة", "${Dec.money(inv.taxTotal)} ${inv.currency}")
                            inv.issuedAt?.takeIf { it.isNotBlank() }?.let {
                                KeyValue("تاريخ الإصدار", it.take(16).replace('T', ' '))
                            }
                        }
                        KeyValue("بيئة الربط", if (sub.environment == "production") "الإنتاج الفعلي (Production)" else "المحاكاة / الامتثال (${sub.environment})")
                        KeyValue("عدد المحاولات", sub.attemptsText)
                        sub.submittedAt?.takeIf { it.isNotBlank() }?.let {
                            KeyValue("وقت الرفع للبوابة", it.take(16).replace('T', ' '))
                        }
                    }

                    SectionCard(title = "البصمة التشفيريّة والسلسلة (ZATCA Chain)") {
                        sub.chainIndex?.let { KeyValue("ترتيب السلسلة (ICV)", it.toString()) }
                        KeyValue("المعرّف الفريد (UUID)", sub.uuid?.ifBlank { "—" } ?: "—")
                        KeyValue("تجزئة الفاتورة (Hash)", (d.chain?.hash ?: sub.hash)?.take(28)?.plus("…") ?: "—")
                        KeyValue("تجزئة الفاتورة السابقة", (d.chain?.previousHash ?: sub.previousHash)?.take(28)?.plus("…") ?: "—")
                    }

                    val warnings = d.authority?.warnings.orEmpty()
                    val errors = buildList {
                        sub.error?.takeIf { it.isNotBlank() }?.let { add(it) }
                        d.authority?.error?.takeIf { it.isNotBlank() }?.let { add(it) }
                        addAll(d.authority?.errors.orEmpty())
                    }.distinct()

                    if (warnings.isNotEmpty()) {
                        SectionCard(title = "ملاحظات وتحذيرات البوابة (${warnings.size})") {
                            warnings.forEach { w ->
                                InfoCallout(w, ChipTone.WARN)
                                Spacer(Modifier.height(6.dp))
                            }
                        }
                    }
                    if (errors.isNotEmpty()) {
                        SectionCard(title = "أسباب الرفض أو الخطأ (${errors.size})") {
                            errors.forEach { err ->
                                InfoCallout(err, ChipTone.DANGER)
                                Spacer(Modifier.height(6.dp))
                            }
                        }
                    }

                    val qrTags = d.qr?.tags.orEmpty()
                    if (qrTags.isNotEmpty()) {
                        SectionCard(title = "حقول رمز الاستجابة السريعة (ZATCA TLV)") {
                            qrTags.forEach { tag ->
                                KeyValue("(${tag.tag}) ${tag.labelAr}", tag.value)
                            }
                        }
                    }

                    if (state.can("einvoice.submit")) {
                        Button(
                            onClick = {
                                retrying = true
                                scope.launch {
                                    when (val res = vm.retryEinvoice(sub.id)) {
                                        is ActionResult.Synced -> {
                                            vm.showNoticeOk("تمّت إعادة رفع الفاتورة لبوابة الضرائب بنجاح.")
                                            runCatching { detail = vm.einvoiceFilingDetail(sub.id) }
                                            reload()
                                        }
                                        is ActionResult.Refused -> vm.showNoticeDanger(res.messageAr)
                                        is ActionResult.Offline -> vm.showNoticeWarn(res.messageAr)
                                    }
                                    retrying = false
                                }
                            },
                            enabled = !retrying,
                            modifier = Modifier.fillMaxWidth().height(50.dp),
                        ) {
                            Icon(Icons.Default.Replay, contentDescription = null, Modifier.size(18.dp))
                            Spacer(Modifier.size(8.dp))
                            Text(
                                if (retrying) "جارٍ إعادة الإرسال…" else "إعادة إرسال الفاتورة للبوابة الضريبية",
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    }
                }
            }
            return@Scaffold
        }

        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    StatTile(
                        label = "إجمالي السجلات",
                        value = page.total.toString(),
                        sub = "صفحة ${page.pageNo} من ${page.pages}",
                        icon = Icons.Default.CloudDone,
                        tone = ChipTone.INFO,
                        modifier = Modifier.weight(1f),
                    )
                    StatTile(
                        label = "عدّاد السلسلة (ICV)",
                        value = (chain?.counter ?: 0).toString(),
                        sub = chain?.environment?.takeIf { it.isNotBlank() }?.let {
                            if (it == "production") "ربط فعليّ" else "وضع تجريبيّ"
                        },
                        icon = Icons.Default.CloudSync,
                        tone = ChipTone.OK,
                        modifier = Modifier.weight(1f),
                    )
                }
            }

            if (state.can("einvoice.submit")) {
                item {
                    FilledTonalButton(
                        onClick = {
                            syncing = true
                            scope.launch {
                                try {
                                    val report = vm.syncEinvoices()
                                    vm.showNoticeOk(
                                        report.message.ifBlank {
                                            "اكتملت المزامنة: رُفع ${report.sent} · فشل ${report.failed} · تُخطّي ${report.skipped}"
                                        },
                                    )
                                    reload()
                                } catch (e: Exception) {
                                    vm.showNoticeDanger(vm.friendlyError(e))
                                } finally {
                                    syncing = false
                                }
                            }
                        },
                        enabled = !syncing,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                    ) {
                        Icon(Icons.Default.CloudSync, contentDescription = null, Modifier.size(18.dp))
                        Spacer(Modifier.size(8.dp))
                        Text(
                            if (syncing) "جارٍ مزامنة الفواتير مع بوابة الضرائب…" else "مزامنة الفواتير المعلّقة مع البوابة الضريبية",
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }

            item {
                SectionCard(title = "تصفية التقرير") {
                    Row(
                        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        FILING_STATUS_FILTERS.forEach { (code, label) ->
                            FilterChip(
                                selected = statusFilter == code,
                                onClick = { statusFilter = code; pageNo = 1 },
                                label = { Text(label) },
                            )
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        DatePickerField(
                            value = fromDate,
                            onValueChange = { fromDate = it; pageNo = 1 },
                            label = "من تاريخ",
                            modifier = Modifier.weight(1f),
                        )
                        DatePickerField(
                            value = toDate,
                            onValueChange = { toDate = it; pageNo = 1 },
                            label = "إلى تاريخ",
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }

            if (errorMsg != null) {
                item { InfoCallout(errorMsg.orEmpty(), ChipTone.DANGER) }
            }

            if (loading && page.items.isEmpty()) {
                item { CenterLoading("جارٍ جلب الفواتير المرفوعة…") }
            } else if (page.items.isEmpty()) {
                item { EmptyState("لا فواتير ضريبيّة مطابقة للتصفية الحاليّة.") }
            } else {
                items(page.items, key = { it.id }) { row ->
                    val (stLabel, stTone) = filingStatusChip(row.status, row.authorityStatus)
                    ListItemCard(onClick = { selectedId = row.id }) {
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                row.invoice?.number?.takeIf { it.isNotBlank() } ?: "فاتورة #${row.invoiceId.take(8)}",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.ExtraBold,
                            )
                            StatusChip(stLabel, stTone)
                        }
                        Spacer(Modifier.height(4.dp))
                        row.invoice?.partyName?.takeIf { it.isNotBlank() }?.let { KeyValue("العميل", it) }
                        row.invoice?.total?.takeIf { it.isNotBlank() }?.let {
                            KeyValue("الإجمالي", "${Dec.money(it)} ر.س")
                        }
                        row.invoice?.branchName?.takeIf { it.isNotBlank() }?.let { KeyValue("الفرع", it) }
                        KeyValue(
                            "تاريخ الرفع",
                            (row.submittedAt ?: row.createdAt).take(16).replace('T', ' '),
                        )
                        row.chainIndex?.let { KeyValue("رقم السلسلة (ICV)", it.toString()) }
                        row.error?.takeIf { it.isNotBlank() }?.let {
                            Spacer(Modifier.height(4.dp))
                            InfoCallout(it, ChipTone.DANGER)
                        }
                    }
                }

                if (page.pages > 1) {
                    item {
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            OutlinedButton(
                                onClick = { if (pageNo > 1) pageNo-- },
                                enabled = pageNo > 1,
                            ) { Text("السابق") }
                            Text("صفحة ${page.pageNo} من ${page.pages}", fontWeight = FontWeight.Bold)
                            OutlinedButton(
                                onClick = { if (pageNo < page.pages) pageNo++ },
                                enabled = pageNo < page.pages,
                            ) { Text("التالي") }
                        }
                    }
                }
            }
        }
    }
}
