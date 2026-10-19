package com.erpcloud.bakery.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SecondaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.data.api.ReportResultDto
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.EmptyState
import com.erpcloud.bakery.ui.components.KeyValue
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.components.StatusChip
import com.erpcloud.bakery.util.Dec
import kotlinx.serialization.json.JsonObject

/**
 * شاشةُ حزمةِ التقارير (من تطبيق الطاقم) — مركزُ تقارير المنشأة كلِّها:
 * فهرسُ الخادم (`GET /reports` — مئاتُ التقارير)، ثمّ تشغيلُ تقريرٍ
 * (`GET /reports/{key}`) بمدخلاته (فرع/من/إلى/شهر…) وعرضُ الأعمدة
 * والصفوف والإجماليّات كما تعود — **بلا حسابٍ عند العميل**.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SystemReportsScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var search by remember { mutableStateOf("") }
    var runKey by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { if (state.staff.reportCatalog.isEmpty()) vm.loadReportCatalog() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("التقارير") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(horizontal = 14.dp)) {
            if (runKey == null) {
                // ------------------------------------------------ فهرسُ التقارير
                OutlinedTextField(
                    value = search,
                    onValueChange = { search = it },
                    label = { Text("بحثٌ في اسم التقرير أو مفتاحه") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(10.dp))
                if (state.staff.loadingKey == "report-catalog") {
                    CenterLoading("جارٍ تحميل فهرس التقارير…")
                } else {
                    val reports = state.staff.reportCatalog.filter {
                        search.isBlank() ||
                            it.titleAr.contains(search.trim(), ignoreCase = true) ||
                            it.key.contains(search.trim(), ignoreCase = true) ||
                            it.group.contains(search.trim(), ignoreCase = true)
                    }
                    if (reports.isEmpty()) {
                        EmptyState(state.staff.error ?: "لا تقاريرَ مطابقة.")
                    } else {
                        LazyColumn(
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 20.dp),
                        ) {
                            items(reports, key = { it.key }) { report ->
                                SectionCard(title = report.titleAr, subtitle = "المفتاح: ${report.key}") {
                                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                        StatusChip(Labels.reportGroup(report.group), ChipTone.INFO)
                                    }
                                    report.hintAr?.takeIf { it.isNotBlank() }?.let {
                                        Spacer(Modifier.height(4.dp))
                                        Text(
                                            it,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                    Spacer(Modifier.height(8.dp))
                                    OutlinedButton(onClick = { runKey = report.key }) { Text("تشغيلُ التقرير") }
                                }
                            }
                        }
                    }
                }
            } else {
                // ------------------------------------------------ تشغيلُ تقرير
                ReportRunner(
                    vm = vm,
                    reportKey = runKey ?: "",
                    onBack = { runKey = null },
                )
            }
        }
    }
}

/** مشغّلُ التقرير — مدخلاتٌ عامّة (فرع/من/إلى/شهر) + النتيجةُ أعمدةً وصفوفًا. */
@Composable
private fun ReportRunner(vm: AppViewModel, reportKey: String, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    val catalog = state.staff.reportCatalog.firstOrNull { it.key == reportKey }
    var branchId by remember { mutableStateOf("") }
    var branchLabel by remember { mutableStateOf("") }
    var from by remember { mutableStateOf("${java.time.Year.now().value}-01-01") }
    var to by remember { mutableStateOf(todayIso()) }
    var yearMonth by remember { mutableStateOf("") }
    var pickBranch by remember { mutableStateOf(false) }

    LaunchedEffect(reportKey) {
        // مدخلاتٌ عامّةٌ تُرسَل كما هي — والخادمُ يتجاهلُ ما لا يلزم تقريرَه.
        val params = buildParams(branchId, from, to, yearMonth)
        vm.runReport(reportKey, params)
    }

    Column(Modifier.fillMaxSize()) {
        SectionCard(
            title = catalog?.titleAr ?: reportKey,
            subtitle = catalog?.hintAr ?: "",
        ) {
            OutlinedTextField(
                value = branchLabel,
                onValueChange = {},
                readOnly = true,
                label = { Text("الفرع (كلُّ الفروع إن تُرك)") },
                modifier = Modifier.fillMaxWidth(),
                trailingIcon = { IconButton(onClick = { pickBranch = true }) { Text("اختر") } },
            )
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = from,
                    onValueChange = { from = it },
                    label = { Text("من") },
                    modifier = Modifier.weight(1f),
                )
                OutlinedTextField(
                    value = to,
                    onValueChange = { to = it },
                    label = { Text("إلى") },
                    modifier = Modifier.weight(1f),
                )
                OutlinedTextField(
                    value = yearMonth,
                    onValueChange = { yearMonth = it },
                    label = { Text("شهر YYYY-MM") },
                    modifier = Modifier.weight(1f),
                )
            }
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedButton(
                    onClick = {
                        vm.runReport(reportKey, buildParams(branchId, from, to, yearMonth))
                    },
                    modifier = Modifier.weight(1f),
                ) { Text("تشغيلٌ بالمدخلات") }
                OutlinedButton(onClick = onBack, modifier = Modifier.weight(1f)) { Text("رجوعٌ للفهرس") }
            }
        }
        Spacer(Modifier.height(10.dp))

        if (state.staff.loadingKey == "report-$reportKey") {
            CenterLoading("جارٍ تشغيل التقرير…")
        } else {
            val result = state.staff.reportResult
            if (result == null) {
                EmptyState(state.staff.error ?: "اضغط «تشغيلٌ بالمدخلات».")
            } else {
                ReportResult(result)
            }
        }
    }

    if (pickBranch) {
        PickerDialog(
            title = "اختر الفرع",
            items = state.staff.branches.map { PickerItem(it.id, it.nameAr, trailing = if (it.isDefault) "افتراضيّ" else null) },
            onDismiss = { pickBranch = false },
            onSelect = { branchId = it.id; branchLabel = it.title; pickBranch = false },
        )
    }
}

private fun buildParams(branchId: String, from: String, to: String, yearMonth: String): JsonObject =
    kotlinx.serialization.json.buildJsonObject {
        if (branchId.isNotBlank()) put("branchId", branchId)
        if (from.isNotBlank()) put("from", from.trim())
        if (to.isNotBlank()) put("to", to.trim())
        if (yearMonth.isNotBlank()) put("yearMonth", yearMonth.trim())
    }

/** نتيجةُ التقرير — الأعمدةُ من الخادم، والصفوفُ قيمٌ نصّيّةٌ كما جاءت. */
@Composable
private fun ReportResult(result: ReportResultDto) {
    LazyColumn(
        verticalArrangement = Arrangement.spacedBy(8.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 20.dp),
    ) {
        item {
            SectionCard(title = result.titleAr, subtitle = "${result.rowCount} صفًّا · ${Labels.dateOrDash(result.generatedAt.take(10))}") {
                StatusChip(Labels.reportGroup(result.group), ChipTone.INFO)
                Spacer(Modifier.height(6.dp))
                val labelOf = { key: String ->
                    result.columns.firstOrNull { it.key == key }?.labelAr ?: key
                }
                result.totals.forEach { (key, value) ->
                    if (Dec.parse(value) != null) KeyValue(labelOf(key), Dec.money(value))
                }
                result.grandTotal.forEach { card ->
                    KeyValue(card.labelAr, Dec.money(card.amount))
                }
            }
        }
        if (result.rows.isEmpty()) {
            item { EmptyState("لا صفوفَ في النتيجة.") }
        } else {
            items(result.rows.size) { index ->
                val row = result.rows[index]
                SectionCard(title = result.columns.firstOrNull()?.let { rowValue(row, it.key) } ?: "صف ${index + 1}") {
                    result.columns.drop(1).forEach { column ->
                        val value = rowValue(row, column.key)
                        if (value.isNotBlank()) {
                            KeyValue(column.labelAr, if (column.numeric) Dec.money(value) else value)
                        }
                    }
                }
            }
        }
    }
}

/** قيمةُ خليةٍ من صفِّ التقرير — الصفُّ خريطةُ نصوصٍ كما جاءت من الخادم. */
private fun rowValue(row: Map<String, String>, key: String): String = row[key] ?: row[key.replaceFirstChar { it.uppercase() }] ?: ""
