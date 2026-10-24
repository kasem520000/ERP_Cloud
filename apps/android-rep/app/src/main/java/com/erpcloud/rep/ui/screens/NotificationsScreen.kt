@file:OptIn(ExperimentalMaterial3Api::class)

package com.erpcloud.rep.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.LocalShipping
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Refresh
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.erpcloud.rep.data.api.NotificationDto
import com.erpcloud.rep.data.api.typeTitleAr
import com.erpcloud.rep.ui.AppViewModel
import com.erpcloud.rep.ui.components.CenterLoading
import com.erpcloud.rep.ui.components.ChipTone
import com.erpcloud.rep.ui.components.EmptyState
import com.erpcloud.rep.ui.components.InfoCallout
import com.erpcloud.rep.ui.components.SectionCard
import com.erpcloud.rep.ui.components.StatusChip
import com.erpcloud.rep.ui.theme.RepColors

/**
 * مركزُ إشعارات المندوب — يعرض حصريًّا الإشعارات الخاصة بعهدة هذا المندوب وورديته
 * (التوريدات المرسلة إليه، اعتماد إغلاق ورديته، إلغاء أمر تحميله، والتنبيهات العامة).
 */
@Composable
fun NotificationsScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val notifications = state.notifications
    var category by rememberSaveable { mutableStateOf("all") }

    LaunchedEffect(Unit) { vm.refreshNotifications(notifications.unreadOnly) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("إشعاراتُ عهدتي", fontWeight = FontWeight.ExtraBold)
                        Text(
                            "التوريدات المرسلة إليك واعتمادات إقفال وردياتك",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
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
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                FilterChip(
                    selected = !notifications.unreadOnly,
                    onClick = { vm.refreshNotifications(unreadOnly = false) },
                    label = { Text("الكل (${notifications.total})") },
                )
                FilterChip(
                    selected = notifications.unreadOnly,
                    onClick = { vm.refreshNotifications(unreadOnly = true) },
                    label = { Text("غير المقروء (${notifications.unread})") },
                )
                Box(Modifier.weight(1f))
                if (notifications.unread > 0) {
                    OutlinedButton(
                        onClick = { vm.markAllNotificationsRead() },
                        shape = RoundedCornerShape(50),
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                        modifier = Modifier.height(36.dp),
                    ) {
                        Icon(Icons.Default.DoneAll, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("قراءة الكل", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                    }
                }
            }

            when {
                notifications.loading -> CenterLoading("جارٍ جلب إشعارات عهدتك…")
                notifications.error != null -> SectionCard(title = "تعذّر جلب الإشعارات") {
                    InfoCallout(notifications.error ?: "", ChipTone.DANGER)
                }
                notifications.items.isEmpty() -> EmptyState(
                    if (notifications.unreadOnly) "لا توجد إشعارات غير مقروءة على عهدتك."
                    else "صندوق إشعاراتك فارغ حاليًّا.",
                )
                else -> {
                    val supplies = notifications.items.filter {
                        it.type == "van_sales_supply_pending_receipt" || it.type == "van_sales_load_canceled"
                    }
                    val closings = notifications.items.filter { it.type == "van_sales_closing_approved" }

                    Row(
                        Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        FilterChip(
                            selected = category == "all",
                            onClick = { category = "all" },
                            label = { Text("جميع الإشعارات (${notifications.items.size})") },
                        )
                        FilterChip(
                            selected = category == "supply",
                            onClick = { category = "supply" },
                            label = { Text("أوامر التوريد (${supplies.size})") },
                        )
                        FilterChip(
                            selected = category == "closing",
                            onClick = { category = "closing" },
                            label = { Text("اعتماد الإغلاق (${closings.size})") },
                        )
                    }

                    val visible = when (category) {
                        "supply" -> supplies
                        "closing" -> closings
                        else -> notifications.items
                    }

                    if (visible.isEmpty()) {
                        EmptyState("لا توجد إشعارات ضمن هذا التصنيف.")
                    } else {
                        LazyColumn(
                            Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(bottom = 24.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            items(visible, key = { it.id }) { notification ->
                                RepNotificationCard(
                                    notification = notification,
                                    onMarkRead = { vm.markNotificationRead(notification.id) },
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun RepNotificationCard(
    notification: NotificationDto,
    onMarkRead: () -> Unit,
) {
    val (tone, icon) = repNotificationStyle(notification.type)
    val (iconBg, iconFg) = when (tone) {
        ChipTone.OK -> RepColors.OkBg to RepColors.Ok
        ChipTone.WARN -> RepColors.WarnBg to RepColors.Warn
        ChipTone.DANGER -> RepColors.DangerBg to RepColors.Danger
        ChipTone.INFO -> RepColors.InfoBg to RepColors.Info
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
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    if (!notification.isRead) {
                        Box(Modifier.size(9.dp).background(RepColors.Primary, CircleShape))
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
                )
                if (notification.body.isNotBlank()) {
                    Text(
                        notification.body,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                }
                Row(
                    Modifier.fillMaxWidth().padding(top = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        StatusChip(typeTitleAr(notification.type), tone)
                        notification.loadOrderNumber?.let { lo ->
                            StatusChip("#$lo", ChipTone.NEUTRAL)
                        }
                    }
                    if (notification.isRead) {
                        Text(
                            "مقروء",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else {
                        OutlinedButton(
                            onClick = onMarkRead,
                            shape = RoundedCornerShape(50),
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 2.dp),
                            modifier = Modifier.height(32.dp),
                        ) {
                            Text("تعليم كمقروء", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }
}

private fun repNotificationStyle(type: String): Pair<ChipTone, ImageVector> = when (type) {
    "van_sales_supply_pending_receipt" -> ChipTone.WARN to Icons.Filled.LocalShipping
    "van_sales_closing_approved" -> ChipTone.OK to Icons.Filled.CheckCircle
    "van_sales_load_canceled" -> ChipTone.DANGER to Icons.Filled.Cancel
    else -> ChipTone.INFO to Icons.Filled.Notifications
}
