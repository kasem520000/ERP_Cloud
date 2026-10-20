package com.erpcloud.bakery.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.EmptyState
import com.erpcloud.bakery.ui.components.KeyValue
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.components.StatusChip
import com.erpcloud.bakery.util.Dec

/**
 * شاشةُ تقارير الفترة — `GET /van-sales/reports?salesmanId&fromDate&toDate`:
 * مجاميعُ **الفترة** (`periodTotals`) لا مجاميعَ العمر (`summary`)، وأداءُ
 * المناديب صفًّا صفًّا كما يحسبه الخادم. الأرقامُ كلُّها نصوصٌ من الخادم —
 * الحقلُ الغائب في `periodTotals` يُقال «لم يرجع الخادم هذا الحقل» (—).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReportsScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var salesmanFilter by rememberSaveable { androidx.compose.runtime.mutableStateOf("") }
    var salesmanLabel by rememberSaveable { androidx.compose.runtime.mutableStateOf("") }
    var fromDate by rememberSaveable { androidx.compose.runtime.mutableStateOf("") }
    var toDate by rememberSaveable { androidx.compose.runtime.mutableStateOf("") }
    var pickSalesman by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("تقاريرُ الفترة") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            SectionCard(
                title = "فلترةُ الفترة",
                subtitle = "التاريخان اختياريّان (YYYY-MM-DD) — والمندوبُ يُختار من بطاقات الخادم",
                modifier = Modifier.padding(14.dp),
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = fromDate,
                        onValueChange = { fromDate = it },
                        label = { Text("من تاريخ") },
                        modifier = Modifier.weight(1f),
                    )
                    OutlinedTextField(
                        value = toDate,
                        onValueChange = { toDate = it },
                        label = { Text("إلى تاريخ") },
                        modifier = Modifier.weight(1f),
                    )
                }
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = salesmanLabel,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("المندوب (الكلّ)") },
                        modifier = Modifier.weight(1f),
                        trailingIcon = { IconButton(onClick = { pickSalesman = true }) { Text("اختر") } },
                    )
                    com.erpcloud.bakery.ui.components.ActionButton(
                        label = "عرضُ التقرير",
                        onClick = {
                            vm.refreshReports(
                                salesmanId = salesmanFilter.ifBlank { null },
                                fromDate = fromDate.ifBlank { null },
                                toDate = toDate.ifBlank { null },
                            )
                        },
                        modifier = Modifier.weight(1f),
                        loading = state.loadingReports,
                    )
                }
            }

            if (state.loadingReports) {
                com.erpcloud.bakery.ui.components.CenterLoading("جارٍ حساب تقرير الفترة…")
                return@Column
            }
            val error = state.reportsError
            if (error != null) {
                EmptyState(error)
                return@Column
            }
            val reports = state.reports ?: run {
                vm.refreshReports(null, null, null)
                null
            }
            if (reports == null) {
                return@Column
            }

            LazyColumn(
                contentPadding = PaddingValues(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                val totals = reports.periodTotals
                if (totals == null) {
                    item { EmptyState("لم يرجع الخادم مجاميعَ الفترة (periodTotals) لهذا الطلب.") }
                } else {
                    item {
                        SectionCard(
                            title = "مجاميعُ الفترة",
                            subtitle = "مجموعُ الفترة المفلترة — لا أرقامَ المنشأة الكاملة",
                        ) {
                            val fields = listOf(
                                "الإنتاج (كجم)" to num(totals, "totalProducedKg"),
                                "الفاقد (كجم)" to num(totals, "totalScrapKg"),
                                "المحمَّل (كجم)" to num(totals, "totalLoadedKg"),
                                "المُباع (كجم)" to num(totals, "totalSoldKg"),
                                "المجاني (كجم)" to num(totals, "totalBonusKg"),
                                "المرتجعات (كجم)" to num(totals, "totalReturnedKg"),
                                "التالف (كجم)" to num(totals, "totalDamagedKg"),
                                "العجز (كجم)" to num(totals, "totalShortageKg"),
                                "الإيراد (ر.س)" to num(totals, "totalRevenueSar"),
                                "المُحصَّل (ر.س)" to num(totals, "totalCollectedCashSar"),
                                "الذممُ الآجلة (ر.س)" to num(totals, "totalCreditReceivablesSar"),
                                "صافي الربح (ر.س)" to num(totals, "totalNetProfitSar"),
                            )
                            fields.forEach { (label, value) -> KeyValue(label, value) }
                            if (reports.rowCap != null && reports.rowCap!! > 0) {
                                Spacer(Modifier.height(6.dp))
                                StatusChip("سقفُ الصفوف ${reports.rowCap} — الجداولُ الكاملةُ على الويب", ChipTone.INFO)
                            }
                        }
                    }
                }
                val reps = reports.repCustodyReport
                if (reps.isNotEmpty()) {
                    item {
                        Text("أداءُ المناديب في الفترة", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    }
                    items(reps, key = { it.salesmanId ?: it.salesmanName ?: it.hashCode().toString() }) { row ->
                        SectionCard(title = row.salesmanName ?: "مندوب") {
                            KeyValue("المحمَّل (كجم)", Dec.kg(row.loadedKg ?: "—"))
                            KeyValue("المُباع", Dec.kg(row.soldKg ?: "—"))
                            KeyValue("المجاني", Dec.kg(row.bonusKg ?: "—"))
                            KeyValue("المرتجع", Dec.kg(row.returnedKg ?: "—"))
                            KeyValue("التالف", Dec.kg(row.damagedKg ?: "—"))
                            KeyValue("العجز", Dec.kg(row.shortageKg ?: "—"))
                            KeyValue("قيمةُ العجز (ر.س)", Dec.money(row.shortageSar ?: "—"))
                            KeyValue("المتبقّي بالعهدة", Dec.kg(row.custodyRemainingKg ?: "—"))
                            KeyValue("الإيراد (ر.س)", Dec.money(row.revenueSar ?: "—"))
                            KeyValue("المُحصَّل (ر.س)", Dec.money(row.collectedSar ?: "—"))
                            KeyValue("الذمم (ر.س)", Dec.money(row.creditDebtSar ?: "—"))
                            KeyValue("صافي الربح (ر.س)", Dec.money(row.netProfitSar ?: "—"))
                            if ((row.pendingClosings ?: 0) > 0) {
                                StatusChip("وردياتٌ بانتظار الإقفال: ${row.pendingClosings}", ChipTone.WARN)
                            }
                        }
                    }
                }
                if (reports.generatedAt != null) {
                    item {
                        Text(
                            "وُلِّد في ${reports.generatedAt}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }

    if (pickSalesman) {
        com.erpcloud.bakery.ui.components.PickerDialog(
            title = "اختر المندوب (أو ألغِ = الكلّ)",
            items = state.salesmen.map { com.erpcloud.bakery.ui.components.PickerItem(it.id, it.name) },
            onDismiss = { pickSalesman = false },
            onSelect = { item ->
                salesmanFilter = item.id
                salesmanLabel = item.title
            },
        )
    }
}

/** قراءةُ رقمٍ من مجاميع الفترة (JsonObject حرّة المفاتيح) — الغائب «—» لا صفر. */
private fun num(totals: kotlinx.serialization.json.JsonObject, key: String): String {
    val element = totals[key] ?: return "—"
    val content = element.toString().trim('"')
    return content.ifBlank { "—" }
}
