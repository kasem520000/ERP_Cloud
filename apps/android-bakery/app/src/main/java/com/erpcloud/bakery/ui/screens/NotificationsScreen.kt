@file:OptIn(ExperimentalMaterial3Api::class)

package com.erpcloud.bakery.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.FactCheck
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.LocalShipping
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Paid
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.WarningAmber
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.erpcloud.bakery.data.api.NotificationDto
import com.erpcloud.bakery.data.api.typeTitleAr
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.EmptyState
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.theme.BakeryColors

/**
 * مركزُ الإشعارات — صندوقُ العضويّة الرسميّ من `GET /notifications` مع
 * `meta.unread`، وتعليمُ المقروء عبر `POST /notifications/{id}/read`
 * (تكرارٌ آمن). يتطلّب إذنَ tenant.notification.view؛ خطأُ الخادم يُعرض كما هو.
 */
@Composable
fun NotificationsScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val notifications = state.notifications

    LaunchedEffect(Unit) { vm.refreshNotifications(notifications.unreadOnly) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("مركزُ الإشعارات") },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Transparent),
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع")
                    }
                },
                actions = {
                    IconButton(onClick = { vm.refreshNotifications(notifications.unreadOnly) }) {
                        Icon(Icons.Default.Refresh, contentDescription = "تحديث")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 14.dp),
        ) {
            // رقائقُ التصفية بأعدادِها + شريطُ «تعليمُ الكلّ كمقروء» (كما في الموك-أب 09).
            Row(
                Modifier.fillMaxWidth().padding(vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                FilterChip(
                    selected = !notifications.unreadOnly,
                    onClick = { vm.refreshNotifications(unreadOnly = false) },
                    label = { Text("الكلّ (${notifications.total})") },
                )
                FilterChip(
                    selected = notifications.unreadOnly,
                    onClick = { vm.refreshNotifications(unreadOnly = true) },
                    label = { Text("غيرُ المقروء (${notifications.unread})") },
                )
                Box(Modifier.weight(1f))
                if (notifications.unread > 0) {
                    OutlinedButton(
                        onClick = { vm.markAllNotificationsRead() },
                        shape = RoundedCornerShape(50.dp),
                        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 4.dp),
                        modifier = Modifier.height(36.dp),
                    ) {
                        Text(
                            "تعليمُ الكلّ كمقروء",
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }

            when {
                notifications.loading -> CenterLoading("تُقرأ الإشعارات من الخادم…")
                notifications.error != null -> SectionCard(title = "تعذّرت القراءة") {
                    Text(
                        notifications.error ?: "",
                        color = MaterialTheme.colorScheme.error,
                    )
                    Text(
                        "قد يكون حسابُك بلا إذن tenant.notification.view — إشعاراتُ مساحة العمل (أحدث ٢٠) تبقى معروضة هناك.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                notifications.items.isEmpty() -> EmptyState(
                    if (notifications.unreadOnly) "لا إشعاراتٍ غيرِ مقروءة." else "لا إشعارات.",
                )
                else -> LazyColumn(
                    Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(notifications.items, key = { it.id }) { notification ->
                        NotificationCard(notification, onMarkRead = { vm.markNotificationRead(notification.id) })
                    }
                    if (notifications.total > notifications.items.size) {
                        item {
                            Text(
                                "تُعرض أول ${notifications.items.size} إشعارًا من ${notifications.total} — لعرض الأقدم استخدم تطبيق الويب.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                                modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

/** بطاقةُ إشعارٍ واحدة — أيقونةُ النوع داخلَ دائرةٍ ملوّنة، وعنوانٌ عريضٌ بنقطةِ
 * غيرِ المقروء، ووقتٌ رماديّ، ونصُّ الإشعار، ثمّ نوعُه وإجراءُ التعليم (الموك-أب 09). */
@Composable
private fun NotificationCard(notification: NotificationDto, onMarkRead: () -> Unit) {
    val (tone, icon) = notificationStyle(notification.type)
    val (iconBg, iconFg) = when (tone) {
        ChipTone.OK -> BakeryColors.OkBg to BakeryColors.Ok
        ChipTone.WARN -> BakeryColors.WarnBg to BakeryColors.Warn
        ChipTone.DANGER -> BakeryColors.DangerBg to BakeryColors.Danger
        ChipTone.INFO -> BakeryColors.InfoBg to BakeryColors.Info
        ChipTone.NEUTRAL -> MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
    }
    SectionCard(title = null) {
        Row(verticalAlignment = Alignment.Top) {
            Surface(color = iconBg, shape = CircleShape, modifier = Modifier.size(42.dp)) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(icon, contentDescription = null, tint = iconFg, modifier = Modifier.size(21.dp))
                }
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    if (!notification.isRead) {
                        Box(Modifier.size(9.dp).background(BakeryColors.Primary, CircleShape))
                    }
                    Text(
                        notification.title,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = if (notification.isRead) FontWeight.Bold else FontWeight.ExtraBold,
                        modifier = Modifier.weight(1f),
                    )
                }
                Text(
                    notification.createdAt.take(16).replace('T', ' '),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 3.dp),
                )
                if (notification.body.isNotBlank()) {
                    Spacer(Modifier.height(4.dp))
                    Text(notification.body, style = MaterialTheme.typography.bodyMedium)
                }
                Row(
                    Modifier.fillMaxWidth().padding(top = 10.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        typeTitleAr(notification.type),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (notification.isRead) {
                        Text(
                            "مقروء",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else {
                        OutlinedButton(
                            onClick = onMarkRead,
                            shape = RoundedCornerShape(50.dp),
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 2.dp),
                            modifier = Modifier.height(32.dp),
                        ) {
                            Icon(
                                Icons.Default.Notifications,
                                contentDescription = null,
                                modifier = Modifier.size(14.dp),
                            )
                            Text("تعليمٌ كمقروء", style = MaterialTheme.typography.labelMedium)
                        }
                    }
                }
            }
        }
    }
}

/** هيئةُ الإشعار حسبَ نوعه — نغمةُ دائرةِ الأيقونة ورمزُها (كما في الموك-أب 09):
 * ما يطلّبُ قرارًا منك تحذيرٌ أو خطر، وما اكتمل نجاحٌ، والمستنداتُ معلومات. */
private fun notificationStyle(type: String): Pair<ChipTone, ImageVector> = when (type) {
    "van_sales_supply_pending_receipt" -> ChipTone.WARN to Icons.Filled.LocalShipping
    "van_sales_receipt_discrepancy" -> ChipTone.DANGER to Icons.Filled.WarningAmber
    "van_sales_closing_request" -> ChipTone.WARN to Icons.Filled.Schedule
    "van_sales_closing_approved" -> ChipTone.OK to Icons.Filled.CheckCircle
    "van_sales_receipt_confirmed" -> ChipTone.OK to Icons.Filled.FactCheck
    "van_sales_load_canceled" -> ChipTone.NEUTRAL to Icons.Filled.LocalShipping
    "payment_paid" -> ChipTone.OK to Icons.Filled.Payments
    "salary" -> ChipTone.OK to Icons.Filled.Paid
    "advance" -> ChipTone.INFO to Icons.Filled.Payments
    "leave" -> ChipTone.INFO to Icons.Filled.Schedule
    "check_in", "check_out" -> ChipTone.NEUTRAL to Icons.Filled.Fingerprint
    "document" -> ChipTone.INFO to Icons.Filled.Description
    "voucher" -> ChipTone.INFO to Icons.Filled.ReceiptLong
    "settings.updated" -> ChipTone.NEUTRAL to Icons.Filled.Settings
    else -> ChipTone.NEUTRAL to Icons.Filled.Notifications
}
