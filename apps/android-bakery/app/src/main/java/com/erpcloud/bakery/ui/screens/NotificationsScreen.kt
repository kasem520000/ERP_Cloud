package com.erpcloud.bakery.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.FactCheck
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.WarningAmber
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.Routes
import com.erpcloud.bakery.data.api.NotificationDto
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.EmptyState
import com.erpcloud.bakery.ui.components.InlineAction
import com.erpcloud.bakery.ui.components.PullRefreshBox
import com.erpcloud.bakery.ui.components.StatusChip
import com.erpcloud.bakery.ui.theme.BakeryColors

private enum class ManagementNotifCategory(val label: String) {
    ALL("الكل"),
    CLOSING("إغلاق الورديات"),
    SUPPLY("استلام التوريدات"),
    SYSTEM("المالية والنظام"),
}

/**
 * مركزُ إشعاراتِ الإدارة والمحاسبة — معزولٌ بالكامل عن إشعارات عهدة المندوب الفرديّة،
 * مع تبويبٍ موضوعيّ وانتقالٍ فوريّ إلى شاشة الاعتماد أو التوزيع.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotificationsScreen(
    vm: AppViewModel,
    onBack: () -> Unit,
    onNavigateRoute: (String) -> Unit = {},
) {
    val state by vm.uiState.collectAsState()
    val notif = state.notifications
    var category by rememberSaveable { mutableStateOf(ManagementNotifCategory.ALL) }

    LaunchedEffect(Unit) { vm.refreshNotifications(unreadOnly = notif.unreadOnly) }

    val filteredItems = notif.items.filter { item ->
        when (category) {
            ManagementNotifCategory.ALL -> true
            ManagementNotifCategory.CLOSING ->
                item.type == "van_sales_closing_request" || item.type == "van_sales_closing_approved"
            ManagementNotifCategory.SUPPLY ->
                item.type == "van_sales_receipt_confirmed" || item.type == "van_sales_receipt_discrepancy"
            ManagementNotifCategory.SYSTEM ->
                !item.type.startsWith("van_sales_")
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("إشعارات الإدارة والمحاسبة", fontWeight = FontWeight.ExtraBold)
                        Text(
                            if (notif.unread > 0) "${notif.unread} إشعار غير مقروء"
                            else "كلُّ الإشعارات مقروءة",
                            style = MaterialTheme.typography.bodySmall,
                            color = if (notif.unread > 0) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع")
                    }
                },
                actions = {
                    if (notif.unread > 0) {
                        TextButton(onClick = { vm.markAllNotificationsRead() }) {
                            Icon(Icons.Filled.DoneAll, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("قراءة الكل", fontWeight = FontWeight.Bold)
                        }
                    }
                    IconButton(onClick = { vm.refreshNotifications(unreadOnly = notif.unreadOnly) }) {
                        Icon(Icons.Filled.Refresh, contentDescription = "تحديث")
                    }
                },
            )
        },
    ) { pad ->
        PullRefreshBox(
            refreshing = notif.loading,
            onRefresh = { vm.refreshNotifications(unreadOnly = notif.unreadOnly) },
            modifier = Modifier.padding(pad).fillMaxSize(),
        ) {
            Column(Modifier.fillMaxSize()) {
                Surface(
                    color = MaterialTheme.colorScheme.surface,
                    border = BorderStroke(0.5.dp, BakeryColors.Hairline),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(
                        Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Row(
                            modifier = Modifier.horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            FilterChip(
                                selected = !notif.unreadOnly,
                                onClick = { vm.refreshNotifications(unreadOnly = false) },
                                label = { Text("جميع السجلات (${notif.total})") },
                            )
                            FilterChip(
                                selected = notif.unreadOnly,
                                onClick = { vm.refreshNotifications(unreadOnly = true) },
                                label = { Text("غير المقروء (${notif.unread})") },
                            )
                        }
                        Row(
                            modifier = Modifier.horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            ManagementNotifCategory.entries.forEach { cat ->
                                FilterChip(
                                    selected = category == cat,
                                    onClick = { category = cat },
                                    label = { Text(cat.label) },
                                )
                            }
                        }
                    }
                }

                when {
                    notif.loading && notif.items.isEmpty() -> CenterLoading("جاري تحميل الإشعارات…")
                    notif.error != null && notif.items.isEmpty() -> EmptyState(notif.error ?: "تعذّر تحميل الإشعارات.")
                    filteredItems.isEmpty() -> EmptyState(
                        if (notif.unreadOnly) "لا توجد إشعارات غير مقروءة في هذا التصنيف."
                        else "لا توجد إشعارات ضمن هذا التصنيف بعد.",
                    )
                    else -> LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(14.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(filteredItems, key = { it.id }) { item ->
                            NotificationCard(
                                item = item,
                                onMarkRead = {
                                    if (!item.isRead) vm.markNotificationRead(item.id)
                                },
                                onOpenTarget = targetRouteFor(item)?.let { targetRoute ->
                                    {
                                        if (!item.isRead) vm.markNotificationRead(item.id)
                                        onNavigateRoute(targetRoute)
                                    }
                                },
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun targetRouteFor(item: NotificationDto): String? = when (item.type) {
    "van_sales_closing_request", "van_sales_closing_approved" -> Routes.CUSTODY
    "van_sales_receipt_confirmed", "van_sales_receipt_discrepancy" -> Routes.DISTRIBUTION
    "invoice.issued", "invoice.overdue" -> Routes.SALES_INVOICES
    "purchase_bill.recorded" -> Routes.PURCHASES
    "payment.received" -> Routes.VOUCHERS
    "stock.low" -> Routes.INVENTORY
    else -> null
}

private fun targetLabelFor(item: NotificationDto): String = when (item.type) {
    "van_sales_closing_request" -> "مراجعة واعتماد الإغلاق"
    "van_sales_closing_approved" -> "فتح سجلّ العهدة"
    "van_sales_receipt_confirmed", "van_sales_receipt_discrepancy" -> "فتح أوامر التوريد"
    "invoice.issued", "invoice.overdue" -> "فتح فواتير المبيعات"
    "purchase_bill.recorded" -> "فتح المشتريات"
    "payment.received" -> "فتح السندات"
    "stock.low" -> "فتح المخزون"
    else -> "فتح السجلّ"
}

@Composable
private fun NotificationCard(
    item: NotificationDto,
    onMarkRead: () -> Unit,
    onOpenTarget: (() -> Unit)?,
) {
    val (tone, icon) = when (item.type) {
        "van_sales_receipt_discrepancy", "invoice.overdue", "stock.low", "marketplace_addon_rejected" ->
            ChipTone.WARN to Icons.Filled.WarningAmber
        "van_sales_closing_request" ->
            ChipTone.INFO to Icons.Filled.FactCheck
        "van_sales_closing_approved", "van_sales_receipt_confirmed", "payment.received", "marketplace_addon_approved" ->
            ChipTone.OK to Icons.Filled.CheckCircle
        "invoice.issued", "purchase_bill.recorded" ->
            ChipTone.INFO to Icons.Filled.ReceiptLong
        else ->
            ChipTone.NEUTRAL to Icons.Filled.Notifications
    }
    val (iconBg, iconFg) = when (tone) {
        ChipTone.OK -> BakeryColors.OkBg to BakeryColors.Ok
        ChipTone.WARN -> BakeryColors.WarnBg to BakeryColors.Warn
        ChipTone.DANGER -> BakeryColors.DangerBg to BakeryColors.Danger
        ChipTone.INFO -> BakeryColors.InfoBg to BakeryColors.Info
        ChipTone.NEUTRAL -> MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
    }

    val loadOrderNumber = item.payloadString("loadOrderNumber")
    val salesmanName = item.payloadString("salesmanName")

    Surface(
        shape = RoundedCornerShape(18.dp),
        color = if (item.isRead) MaterialTheme.colorScheme.surface
        else MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.25f),
        border = BorderStroke(
            width = if (item.isRead) 1.dp else 1.5.dp,
            color = if (item.isRead) BakeryColors.Hairline else MaterialTheme.colorScheme.primary.copy(alpha = 0.55f),
        ),
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .clickable { onMarkRead() },
    ) {
        Row(
            Modifier.padding(14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Surface(
                shape = CircleShape,
                color = iconBg,
                modifier = Modifier.size(42.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(icon, contentDescription = null, tint = iconFg, modifier = Modifier.size(21.dp))
                }
            }

            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    StatusChip(item.typeTitleAr(), tone)
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        if (!item.isRead) {
                            Box(
                                Modifier
                                    .size(9.dp)
                                    .background(MaterialTheme.colorScheme.primary, CircleShape),
                            )
                        }
                        item.createdAt.take(16).replace('T', ' ').takeIf { it.isNotBlank() }?.let { stamp ->
                            Text(
                                stamp,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }

                if (item.title.isNotBlank()) {
                    Text(
                        item.title,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = if (item.isRead) FontWeight.Bold else FontWeight.ExtraBold,
                    )
                }

                if (item.body.isNotBlank()) {
                    Text(
                        item.body,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                if (!loadOrderNumber.isNullOrBlank() || !salesmanName.isNullOrBlank() || onOpenTarget != null) {
                    HorizontalDivider(
                        thickness = 0.5.dp,
                        color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.6f),
                    )
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.weight(1f),
                        ) {
                            if (!loadOrderNumber.isNullOrBlank()) {
                                StatusChip("#$loadOrderNumber", ChipTone.NEUTRAL)
                            }
                            if (!salesmanName.isNullOrBlank()) {
                                Text(
                                    "المندوب: $salesmanName",
                                    style = MaterialTheme.typography.bodySmall,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        if (onOpenTarget != null) {
                            InlineAction(
                                label = targetLabelFor(item),
                                onClick = onOpenTarget,
                                tone = ChipTone.INFO,
                            )
                        }
                    }
                }
            }
        }
    }
}
