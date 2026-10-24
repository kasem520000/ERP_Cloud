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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.erpcloud.rep.data.api.NotificationScope
import com.erpcloud.rep.data.api.typeTitleAr
import com.erpcloud.rep.ui.AppViewModel
import com.erpcloud.rep.ui.components.CenterLoading
import com.erpcloud.rep.ui.components.EmptyState
import com.erpcloud.rep.ui.components.SectionCard
import com.erpcloud.rep.ui.components.StatusChip
import com.erpcloud.rep.ui.components.ChipTone

/**
 * مركزُ الإشعارات — صندوقُ العضويّة الرسميّ من `GET /notifications` مع
 * `meta.unread`، وتعليمُ المقروء عبر `POST /notifications/{id}/read`
 * (تكرارٌ آمن). يتطلّب إذنَ tenant.notification.view؛ خطأُ الخادم يُعرض كما هو.
 *
 * **فصلُ النطاقات**: «عهدتي» = إشعاراتُ عملِ هذا المندوب (توريدُه، اعتمادُ إقفاله،
 * إلغاءُ أمره) و«الإدارة» = طلباتُ الاعتمادِ وقراراتُ المحاسبة. الصندوقُ واحدٌ
 * بعضويّة المُتصل (كلُّ إشعارٍ في الجدول له membershipId واحد) — والتوجيهُ الكاملُ
 * «كلُّ إشعارٍ يصلُ صاحبَه فقط» يتمُّ في الخادم (انظر الوثيقةَ المرفقة). حتى يتمّ،
 * هذه الفلاترُ تعرضُ لكلِّ طرفٍ ما يخصُّه من صندوقه.
 */
@Composable
fun NotificationsScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val notifications = state.notifications

    LaunchedEffect(Unit) { vm.refreshNotifications(notifications.unreadOnly) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("مركزُ الإشعارات", fontWeight = FontWeight.ExtraBold) },
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
                else -> NotificationList(vm, notifications.items)
            }
        }
    }
}

@Composable
private fun NotificationList(vm: AppViewModel, items: List<com.erpcloud.rep.data.api.NotificationDto>) {
    // فصلُ النطاقات: افتراضيًّا «عهدتي» — ما يخصُّ عملِ هذا المندوب.
    var scope by rememberSaveable { mutableStateOf("mine") }
    val mine = items.filter { it.scope == NotificationScope.MY_WORK }
    val management = items.filter { it.scope == NotificationScope.MANAGEMENT }

    Column {
        Row(
            Modifier.fillMaxWidth().padding(vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FilterChip(
                selected = scope == "mine",
                onClick = { scope = "mine" },
                label = { Text("عهدتي (${mine.size})") },
            )
            FilterChip(
                selected = scope == "management",
                onClick = { scope = "management" },
                label = { Text("الإدارة (${management.size})") },
            )
            FilterChip(
                selected = scope == "all",
                onClick = { scope = "all" },
                label = { Text("كلُّ الصندوق (${items.size})") },
            )
        }
        if (scope == "mine") {
            Text(
                "إشعاراتُ عهدتِك أنت: التوريدُ بانتظارِك، واعتمادُ إقفالك، وإلغاءُ أوامرك — " +
                    "قراراتُ الاعتمادِ الإداريّةُ في تبويب «الإدارة».",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 6.dp),
            )
        }
        val visible = when (scope) {
            "mine" -> mine
            "management" -> management
            else -> items
        }
        if (visible.isEmpty()) {
            EmptyState(
                when (scope) {
                    "mine" -> "لا إشعاراتٍ على عهدتك الآن."
                    "management" -> "لا إشعاراتٍ إداريّةٍ في صندوقك."
                    else -> "لا إشعارات."
                },
            )
        } else {
            LazyColumn(
                Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(visible, key = { it.id }) { notification ->
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
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                StatusChip(
                                    typeTitleAr(notification.type),
                                    when (notification.scope) {
                                        NotificationScope.MY_WORK -> ChipTone.INFO
                                        NotificationScope.MANAGEMENT -> ChipTone.WARN
                                        NotificationScope.SYSTEM -> ChipTone.NEUTRAL
                                    },
                                )
                            }
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
                items(1) { androidx.compose.foundation.layout.Spacer(Modifier.padding(16.dp)) }
            }
        }
    }
}
