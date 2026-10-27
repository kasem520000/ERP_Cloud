@file:OptIn(ExperimentalMaterial3Api::class)

package com.erpcloud.rep.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.PointOfSale
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.erpcloud.rep.ui.AppViewModel
import com.erpcloud.rep.ui.components.CenterLoading
import com.erpcloud.rep.ui.components.ChipTone
import com.erpcloud.rep.ui.components.EmptyState
import com.erpcloud.rep.ui.components.KeyValue
import com.erpcloud.rep.ui.components.ListItemCard
import com.erpcloud.rep.ui.components.SearchField
import com.erpcloud.rep.ui.components.SectionCard
import com.erpcloud.rep.ui.components.StatusChip
import com.erpcloud.rep.util.Dec

/**
 * شاشةٌ مخصّصة لسجلّ الفواتير والمرتجعات والطباعة وسجلّ التحصيلات — مع بحثٍ وفلاتر سريعة.
 */
@Composable
fun DocumentsScreen(
    vm: AppViewModel,
    onBack: () -> Unit,
    onNewSale: () -> Unit,
    onReturn: () -> Unit,
    onCollection: () -> Unit,
    onPrint: (String) -> Unit,
) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val workspace = state.workspace
    var viewTab by rememberSaveable { mutableStateOf("documents") }
    var docFilter by rememberSaveable { mutableStateOf("all") }
    var docQuery by rememberSaveable { mutableStateOf("") }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("الفواتير والتحصيلات والطباعة", fontWeight = FontWeight.ExtraBold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع")
                    }
                },
                actions = {
                    if (state.can("van_sales.invoice.create")) {
                        IconButton(onClick = onNewSale) {
                            Icon(Icons.Default.PointOfSale, contentDescription = "فاتورة بيع جديدة")
                        }
                    }
                    IconButton(onClick = { vm.refreshAll() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "تحديث")
                    }
                },
            )
        },
    ) { padding ->
        if (state.loadingWorkspace && workspace == null) {
            CenterLoading("جارٍ قراءة الفواتير والسجلات…", Modifier.padding(padding))
            return@Scaffold
        }
        if (workspace == null) {
            Column(Modifier.padding(padding).padding(16.dp)) {
                Text(
                    state.workspaceError ?: "لا بيانات متاحة حالياً — اضغط تحديث.",
                    color = MaterialTheme.colorScheme.error,
                )
            }
            return@Scaffold
        }

        LazyColumn(
            Modifier.fillMaxSize().padding(padding).padding(horizontal = 14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Row(
                    Modifier.fillMaxWidth().padding(top = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    DocSectionPill(
                        label = "الفواتير والمرتجعات (${workspace.documents.size})",
                        selected = viewTab == "documents",
                        modifier = Modifier.weight(1f),
                        onClick = { viewTab = "documents" },
                    )
                    DocSectionPill(
                        label = "سجلُّ التحصيلات (${workspace.collections.size})",
                        selected = viewTab == "collections",
                        modifier = Modifier.weight(1f),
                        onClick = { viewTab = "collections" },
                    )
                }
            }

            if (viewTab == "documents") {
                item {
                    SectionCard(
                        title = "مستنداتُك (${workspace.documents.size})",
                        subtitle = custodyWindowNote(
                            workspace.windows?.documents?.returned,
                            workspace.windows?.documents?.total,
                        ),
                    ) {
                        SearchField(
                            value = docQuery,
                            onValueChange = { docQuery = it },
                            placeholder = "ابحث برقم الفاتورة أو اسم العميل…",
                        )
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            DocFilterPill("الكل", workspace.documents.size, docFilter == "all") { docFilter = "all" }
                            DocFilterPill("بيع", workspace.documents.count { it.isSale }, docFilter == "sale") {
                                docFilter = "sale"
                            }
                            DocFilterPill("مرتجع", workspace.documents.count { !it.isSale }, docFilter == "return") {
                                docFilter = "return"
                            }
                            DocFilterPill(
                                "آجل",
                                workspace.documents.count { Dec.isPositive(it.outstanding) },
                                docFilter == "due",
                            ) {
                                docFilter = "due"
                            }
                        }

                        val filteredByKind = when (docFilter) {
                            "sale" -> workspace.documents.filter { it.isSale }
                            "return" -> workspace.documents.filter { !it.isSale }
                            "due" -> workspace.documents.filter { Dec.isPositive(it.outstanding) }
                            else -> workspace.documents
                        }
                        val visibleDocs = if (docQuery.isBlank()) filteredByKind else {
                            val needle = docQuery.trim()
                            filteredByKind.filter {
                                it.number.contains(needle, ignoreCase = true) ||
                                    it.customerName.contains(needle, ignoreCase = true)
                            }
                        }

                        if (visibleDocs.isEmpty()) {
                            EmptyState(
                                if (docFilter == "all" && docQuery.isBlank()) "لا مستندات بعد."
                                else "لا مستنداتٍ تطابقُ الفلتر أو البحث.",
                            )
                        } else {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                visibleDocs.forEach { doc ->
                                    ListItemCard {
                                        Row(
                                            Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Text(
                                                doc.number,
                                                style = MaterialTheme.typography.titleMedium,
                                                fontWeight = FontWeight.ExtraBold,
                                            )
                                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                                if (doc.isSale) StatusChip("بيع", ChipTone.INFO)
                                                else StatusChip("مرتجع", ChipTone.WARN)
                                                if (Dec.isPositive(doc.outstanding)) {
                                                    StatusChip("متبقٍّ", ChipTone.DANGER)
                                                }
                                            }
                                        }
                                        KeyValue("العميل", doc.customerName)
                                        KeyValue("التاريخ", doc.docDate)
                                        KeyValue(
                                            "الكميّة × السعر",
                                            "${Dec.kg(doc.soldQty)} كجم × ${Dec.money(doc.unitPrice)} ر.س",
                                        )
                                        KeyValue("الإجمالي", "${Dec.money(doc.total)} ريال")
                                        if (Dec.isPositive(doc.outstanding)) {
                                            KeyValue("المتبقّي غير المسدَّد", "${Dec.money(doc.outstanding)} ريال")
                                        }
                                        Row(
                                            Modifier.fillMaxWidth().padding(top = 6.dp),
                                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                                        ) {
                                            FilledTonalButton(
                                                onClick = { onPrint(doc.id) },
                                                modifier = Modifier.weight(1f),
                                                shape = RoundedCornerShape(12.dp),
                                            ) {
                                                Icon(Icons.Default.Print, contentDescription = null, Modifier.size(16.dp))
                                                Spacer(Modifier.size(6.dp))
                                                Text("معاينة وطباعة", fontWeight = FontWeight.Bold)
                                            }
                                            if (doc.isSale && state.can("van_sales.invoice.create")) {
                                                OutlinedButton(
                                                    onClick = onReturn,
                                                    shape = RoundedCornerShape(12.dp),
                                                ) {
                                                    Icon(
                                                        Icons.AutoMirrored.Filled.Reply,
                                                        contentDescription = null,
                                                        Modifier.size(16.dp),
                                                    )
                                                    Spacer(Modifier.size(4.dp))
                                                    Text("مرتجع")
                                                }
                                            }
                                            if (Dec.isPositive(doc.outstanding) && state.can("van_sales.collection.create")) {
                                                OutlinedButton(
                                                    onClick = onCollection,
                                                    shape = RoundedCornerShape(12.dp),
                                                ) {
                                                    Icon(
                                                        Icons.Default.Payments,
                                                        contentDescription = null,
                                                        Modifier.size(16.dp),
                                                    )
                                                    Spacer(Modifier.size(4.dp))
                                                    Text("تحصيل")
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            } else {
                item {
                    SectionCard(
                        title = "تحصيلاتُك (${workspace.collections.size})",
                        subtitle = custodyWindowNote(
                            workspace.windows?.collections?.returned,
                            workspace.windows?.collections?.total,
                        ),
                    ) {
                        if (workspace.collections.isEmpty()) {
                            EmptyState("لا تحصيلات مسجّلة في هذه النافذة.")
                        } else {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                workspace.collections.forEach { collection ->
                                    ListItemCard {
                                        Row(
                                            Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Text(
                                                collection.voucherNumber ?: "سند تحصيل",
                                                style = MaterialTheme.typography.titleMedium,
                                                fontWeight = FontWeight.Bold,
                                            )
                                            StatusChip("${Dec.money(collection.amount)} ريال", ChipTone.OK)
                                        }
                                        KeyValue(
                                            "التاريخ والوقت",
                                            collection.collectedAt.take(16).replace('T', ' '),
                                        )
                                        if (collection.reason.isNotBlank()) {
                                            KeyValue("البيان", collection.reason)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            item { Spacer(Modifier.height(20.dp)) }
        }
    }
}

@Composable
private fun DocSectionPill(
    label: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        modifier = modifier,
        shape = RoundedCornerShape(14.dp),
        color = if (selected) {
            MaterialTheme.colorScheme.primaryContainer
        } else {
            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.65f)
        },
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = if (selected) FontWeight.ExtraBold else FontWeight.Medium,
            color = if (selected) {
                MaterialTheme.colorScheme.onPrimaryContainer
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 10.dp),
        )
    }
}

@Composable
private fun DocFilterPill(label: String, count: Int, selected: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(50),
        color = if (selected) {
            MaterialTheme.colorScheme.secondaryContainer
        } else {
            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f)
        },
    ) {
        Text(
            "$label ($count)",
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
            color = if (selected) {
                MaterialTheme.colorScheme.onSecondaryContainer
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
        )
    }
}
