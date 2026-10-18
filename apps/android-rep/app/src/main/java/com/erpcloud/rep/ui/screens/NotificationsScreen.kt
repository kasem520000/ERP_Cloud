@file:OptIn(ExperimentalMaterial3Api::class)

package com.erpcloud.rep.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.erpcloud.rep.ui.AppViewModel
import com.erpcloud.rep.ui.components.CenterLoading
import com.erpcloud.rep.ui.components.EmptyState
import com.erpcloud.rep.ui.components.SectionCard

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
                    OutlinedButton(onClick = { vm.markAllNotificationsRead() }) {
                        Text("تعليمُ الكلّ كمقروء")
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
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(notifications.items, key = { it.id }) { notification ->
                        SectionCard(
                            title = notification.title,
                            subtitle = notification.createdAt.take(19).replace('T', ' '),
                        ) {
                            if (notification.body.isNotBlank()) {
                                Text(notification.body, style = MaterialTheme.typography.bodyMedium)
                            }
                            Row(
                                Modifier.fillMaxWidth().padding(top = 4.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    notification.type,
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
                                    OutlinedButton(onClick = { vm.markNotificationRead(notification.id) }) {
                                        Icon(
                                            Icons.Default.Notifications,
                                            contentDescription = null,
                                            modifier = Modifier.size(16.dp),
                                        )
                                        Text("  تعليمٌ كمقروء")
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
