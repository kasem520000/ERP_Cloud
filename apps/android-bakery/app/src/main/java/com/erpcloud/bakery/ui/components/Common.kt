package com.erpcloud.bakery.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.UnfoldMore
import androidx.compose.material.icons.filled.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.erpcloud.bakery.ui.theme.BakeryColors
import com.erpcloud.bakery.ui.theme.ShapeCard
import com.erpcloud.bakery.ui.theme.ShapeDialog
import com.erpcloud.bakery.ui.theme.ShapeField
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/** إشعارٌ عابر — نتيجةُ إجراءٍ أو خطأ. */
data class Notice(
    val kind: Kind,
    val text: String,
    val id: Long = nextId(),
) {
    enum class Kind { OK, WARN, DANGER }

    companion object {
        private val ids = java.util.concurrent.atomic.AtomicLong(0)
        private fun nextId(): Long = ids.incrementAndGet()

        fun ok(text: String) = Notice(Kind.OK, text)
        fun warn(text: String) = Notice(Kind.WARN, text)
        fun danger(text: String) = Notice(Kind.DANGER, text)
    }
}

@Composable
private fun isDarkSurface(): Boolean = MaterialTheme.colorScheme.background.luminance() < 0.5f

/** بطاقةُ قسمٍ مؤسسيّة منظّمة — إطارٌ دافئٌ دقيق وشريطُ تمييزٍ رأسيّ وتباعدٌ داخليّ متوازن. */
@Composable
fun SectionCard(
    title: String?,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val headingColor = if (isDarkSurface()) MaterialTheme.colorScheme.primary else BakeryColors.PrimaryDark
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .shadow(
                elevation = 3.dp,
                shape = ShapeCard,
                ambientColor = BakeryColors.Primary.copy(alpha = 0.08f),
                spotColor = BakeryColors.Primary.copy(alpha = 0.12f),
            ),
        shape = ShapeCard,
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, BakeryColors.Hairline),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (title != null || subtitle != null) {
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    if (title != null) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Box(
                                Modifier
                                    .width(4.dp)
                                    .height(18.dp)
                                    .background(MaterialTheme.colorScheme.primary, RoundedCornerShape(4.dp))
                            )
                            Text(
                                title,
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.ExtraBold,
                                color = headingColor,
                            )
                        }
                    }
                    if (subtitle != null) {
                        Text(
                            subtitle,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                HorizontalDivider(
                    modifier = Modifier.padding(bottom = 2.dp),
                    color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.65f),
                )
            }
            content()
        }
    }
}

/** سطرُ مفتاح/قيمة منظّم بفاصلٍ رفيعٍ وحمايةٍ من التداخل في الشاشات الضيقة. */
@Composable
fun KeyValue(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 4.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                label,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f).padding(end = 10.dp),
            )
            Text(
                value,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface,
                textAlign = TextAlign.End,
            )
        }
        HorizontalDivider(
            thickness = 0.5.dp,
            color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.45f),
        )
    }
}

/** شريحةُ حالةٍ ملوّنة بحافّةٍ واضحة. */
@Composable
fun StatusChip(text: String, tone: ChipTone = ChipTone.NEUTRAL) {
    val (bg, fg) = when (tone) {
        ChipTone.OK -> BakeryColors.OkBg to BakeryColors.Ok
        ChipTone.WARN -> BakeryColors.WarnBg to BakeryColors.Warn
        ChipTone.DANGER -> BakeryColors.DangerBg to BakeryColors.Danger
        ChipTone.INFO -> BakeryColors.InfoBg to BakeryColors.Info
        ChipTone.NEUTRAL -> MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
    }
    Surface(
        color = bg,
        shape = RoundedCornerShape(50),
        border = BorderStroke(1.dp, fg.copy(alpha = 0.22f)),
    ) {
        Text(
            text,
            color = fg,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}

enum class ChipTone { OK, WARN, DANGER, INFO, NEUTRAL }

/** بطاقةُ إحصائيّةٍ للرأس. */
@Composable
fun StatTile(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    sub: String? = null,
    icon: ImageVector? = null,
    tone: ChipTone = ChipTone.NEUTRAL,
) {
    val valueColor = when (tone) {
        ChipTone.OK -> BakeryColors.Ok
        ChipTone.WARN -> BakeryColors.Warn
        ChipTone.DANGER -> BakeryColors.Danger
        ChipTone.INFO -> BakeryColors.Info
        ChipTone.NEUTRAL -> MaterialTheme.colorScheme.primary
    }
    val iconBg = when (tone) {
        ChipTone.OK -> BakeryColors.OkBg
        ChipTone.WARN -> BakeryColors.WarnBg
        ChipTone.DANGER -> BakeryColors.DangerBg
        ChipTone.INFO -> BakeryColors.InfoBg
        ChipTone.NEUTRAL -> MaterialTheme.colorScheme.primaryContainer
    }
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .shadow(
                elevation = 3.dp,
                shape = RoundedCornerShape(20.dp),
                ambientColor = BakeryColors.Primary.copy(alpha = 0.08f),
                spotColor = BakeryColors.Primary.copy(alpha = 0.12f),
            ),
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, BakeryColors.Hairline),
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (icon != null) {
                    Surface(
                        color = iconBg,
                        shape = RoundedCornerShape(11.dp),
                        modifier = Modifier.size(34.dp),
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                icon,
                                contentDescription = null,
                                tint = valueColor,
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    }
                    Spacer(Modifier.width(8.dp))
                }
                Text(
                    label,
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(Modifier.height(8.dp))
            Text(
                value,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.ExtraBold,
                color = valueColor,
            )
            if (!sub.isNullOrBlank()) {
                Spacer(Modifier.height(2.dp))
                Text(
                    sub,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/** شارةُ عدّادٍ صغيرة. */
@Composable
fun BadgeCount(count: Int, modifier: Modifier = Modifier) {
    if (count <= 0) return
    Surface(
        color = MaterialTheme.colorScheme.error,
        shape = RoundedCornerShape(50),
        modifier = modifier,
    ) {
        Text(
            if (count > 99) "٩٩+" else formatArabicDigits(count),
            color = MaterialTheme.colorScheme.onError,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 5.dp, vertical = 1.dp),
        )
    }
}

private fun formatArabicDigits(value: Int): String =
    value.toString().map { char ->
        if (char in '0'..'9') ('٠' + (char - '0')) else char
    }.joinToString("")

/** حالةٌ فارغة. */
@Composable
fun EmptyState(text: String, modifier: Modifier = Modifier) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = modifier.fillMaxWidth().padding(vertical = 8.dp),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 22.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primaryContainer,
                modifier = Modifier.size(42.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        Icons.Filled.Inbox,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(21.dp),
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            Text(
                text,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/** لافتةُ الإشعار العائمة. */
@Composable
fun NoticeBanner(notice: Notice?, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    if (notice == null) return
    val (bg, fg, icon) = when (notice.kind) {
        Notice.Kind.OK -> Triple(BakeryColors.OkBg, BakeryColors.Ok, Icons.Filled.CheckCircle)
        Notice.Kind.WARN -> Triple(BakeryColors.WarnBg, BakeryColors.Warn, Icons.Filled.WarningAmber)
        Notice.Kind.DANGER -> Triple(BakeryColors.DangerBg, BakeryColors.Danger, Icons.Filled.ErrorOutline)
    }
    Surface(
        color = bg,
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, fg.copy(alpha = 0.25f)),
        modifier = modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        Row(
            Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(
                color = fg.copy(alpha = 0.12f),
                shape = CircleShape,
                modifier = Modifier.size(34.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(20.dp))
                }
            }
            Spacer(Modifier.width(10.dp))
            Text(
                notice.text,
                color = fg,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f),
            )
            IconButton(onClick = onDismiss, modifier = Modifier.size(32.dp)) {
                Icon(Icons.Filled.Close, contentDescription = "إغلاق", tint = fg, modifier = Modifier.size(18.dp))
            }
        }
    }
}

/** تنبيهُ الصلاحية المفقودة. */
@Composable
fun MissingPermissionHint(actionAr: String, permissionCode: String, modifier: Modifier = Modifier) {
    Surface(
        color = BakeryColors.WarnBg,
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, BakeryColors.Warn.copy(alpha = 0.25f)),
        modifier = modifier.fillMaxWidth().padding(vertical = 4.dp),
    ) {
        Text(
            "🔒 «$actionAr» متاحٌ لمن يحملُ صلاحية «${com.erpcloud.bakery.ui.screens.Labels.permission(permissionCode)}» — " +
                "دورُك الحاليُّ لا يملكُها. عدِّلها من شاشةِ الأدوار والصلاحيّات.",
            color = BakeryColors.Warn,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
        )
    }
}

/** عنصرُ اختيارٍ في نافذةِ الانتقاء. */
data class PickerItem(
    val id: String,
    val title: String,
    val subtitle: String? = null,
    val trailing: String? = null,
)

/** نافذةُ انتقاءٍ من قائمة ببحثٍ فوريّ وتحديثٍ مباشر وتصميمٍ منظّم (عملاء، أصناف، مستودعات، حسابات…). */
@Composable
fun PickerDialog(
    title: String,
    items: List<PickerItem>,
    onDismiss: () -> Unit,
    onSelect: (PickerItem) -> Unit,
    loading: Boolean = false,
    errorMessage: String? = null,
    onRefresh: (() -> Unit)? = null,
    onQueryChange: ((String) -> Unit)? = null,
    alwaysShowSearch: Boolean = false,
) {
    var query by rememberSaveable { mutableStateOf("") }
    val currentOnRefresh by rememberUpdatedState(onRefresh)
    val currentOnQueryChange by rememberUpdatedState(onQueryChange)

    LaunchedEffect(Unit) {
        if (items.isEmpty() && !loading) {
            currentOnRefresh?.invoke()
        }
    }
    LaunchedEffect(query) {
        val cb = currentOnQueryChange ?: return@LaunchedEffect
        val trimmed = query.trim()
        if (trimmed.length >= 2) {
            kotlinx.coroutines.delay(280)
            cb(trimmed)
        }
    }

    val searchable = alwaysShowSearch || onQueryChange != null || items.size >= 5
    val visible = if (!searchable || query.isBlank()) items else {
        val needle = query.trim()
        items.filter { item ->
            item.title.contains(needle, ignoreCase = true) ||
                (item.subtitle?.contains(needle, ignoreCase = true) == true) ||
                (item.trailing?.contains(needle, ignoreCase = true) == true)
        }
    }
    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = ShapeDialog,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 4.dp,
            border = BorderStroke(1.dp, BakeryColors.Hairline),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(
                modifier = Modifier.padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            title,
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.ExtraBold,
                        )
                        Text(
                            when {
                                loading && items.isEmpty() -> "جارٍ تحميل القائمة…"
                                query.isBlank() -> "${items.size} خيارًا متاحًا"
                                else -> "النتائج: ${visible.size} من ${items.size}"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (onRefresh != null) {
                        IconButton(onClick = { onRefresh() }, enabled = !loading) {
                            Icon(Icons.Filled.Refresh, contentDescription = "إعادة التحميل")
                        }
                    }
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Filled.Close, contentDescription = "إغلاق")
                    }
                }
                if (searchable) {
                    OutlinedTextField(
                        value = query,
                        onValueChange = { query = it },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        shape = ShapeField,
                        placeholder = { Text("ابحث بالاسم أو الكود…") },
                        leadingIcon = {
                            Icon(Icons.Filled.Search, contentDescription = null, modifier = Modifier.size(18.dp))
                        },
                        trailingIcon = if (query.isNotEmpty()) {
                            {
                                IconButton(onClick = { query = "" }) {
                                    Icon(Icons.Filled.Clear, contentDescription = "مسح البحث", modifier = Modifier.size(18.dp))
                                }
                            }
                        } else null,
                    )
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                if (loading && visible.isEmpty()) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 28.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        CircularProgressIndicator(modifier = Modifier.size(28.dp), strokeWidth = 3.dp)
                        Text(
                            "جارٍ تحميل الخيارات من الخادم…",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                } else if (visible.isEmpty()) {
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        EmptyState(
                            when {
                                searchable && query.isNotBlank() -> "لا نتائج تطابق «${query.trim()}»."
                                !errorMessage.isNullOrBlank() -> errorMessage
                                else -> "لا عناصرَ متاحة حاليًّا."
                            },
                        )
                        if (onRefresh != null) {
                            OutlinedButton(onClick = { onRefresh() }) {
                                Icon(Icons.Filled.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(6.dp))
                                Text("إعادة التحميل", fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                } else {
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 380.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        items(visible, key = { it.id }) { item ->
                            Surface(
                                shape = RoundedCornerShape(14.dp),
                                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
                                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                                onClick = {
                                    onSelect(item)
                                    onDismiss()
                                },
                            ) {
                                Row(
                                    Modifier.fillMaxWidth().padding(horizontal = 13.dp, vertical = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                        Text(
                                            item.title,
                                            style = MaterialTheme.typography.bodyLarge,
                                            fontWeight = FontWeight.Bold,
                                        )
                                        if (!item.subtitle.isNullOrBlank()) {
                                            Text(
                                                item.subtitle,
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                    }
                                    if (!item.trailing.isNullOrBlank()) {
                                        Spacer(Modifier.width(8.dp))
                                        Surface(
                                            shape = RoundedCornerShape(50),
                                            color = MaterialTheme.colorScheme.primaryContainer,
                                        ) {
                                            Text(
                                                item.trailing,
                                                style = MaterialTheme.typography.labelMedium,
                                                fontWeight = FontWeight.Bold,
                                                color = MaterialTheme.colorScheme.onPrimaryContainer,
                                                modifier = Modifier.padding(horizontal = 9.dp, vertical = 4.dp),
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = onDismiss) { Text("إلغاء", fontWeight = FontWeight.Bold) }
                }
            }
        }
    }
}

/** نافذةُ انتقاءٍ متعدّدٍ ببحثٍ فوريّ وتمييزٍ بصريّ للعناصر المختارة. */
@Composable
fun MultiPickerDialog(
    title: String,
    items: List<PickerItem>,
    selectedIds: Set<String>,
    onToggle: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }
    val searchable = items.size >= 6
    val visible = if (!searchable || query.isBlank()) items else {
        val needle = query.trim()
        items.filter { item ->
            item.title.contains(needle, ignoreCase = true) ||
                (item.subtitle?.contains(needle, ignoreCase = true) == true)
        }
    }
    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = ShapeDialog,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 4.dp,
            border = BorderStroke(1.dp, BakeryColors.Hairline),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(
                modifier = Modifier.padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                        Text(
                            "المحدَّد: ${selectedIds.size} من ${items.size}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.primary,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Filled.Close, contentDescription = "إغلاق")
                    }
                }
                if (searchable) {
                    OutlinedTextField(
                        value = query,
                        onValueChange = { query = it },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        shape = ShapeField,
                        placeholder = { Text("ابحث في الصلاحيات أو الفروع…") },
                        leadingIcon = {
                            Icon(Icons.Filled.Search, contentDescription = null, modifier = Modifier.size(18.dp))
                        },
                        trailingIcon = if (query.isNotEmpty()) {
                            {
                                IconButton(onClick = { query = "" }) {
                                    Icon(Icons.Filled.Clear, contentDescription = "مسح البحث", modifier = Modifier.size(18.dp))
                                }
                            }
                        } else null,
                    )
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 380.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    items(visible, key = { it.id }) { item ->
                        val checked = item.id in selectedIds
                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = if (checked) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.35f)
                            else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f),
                            border = BorderStroke(
                                1.dp,
                                if (checked) MaterialTheme.colorScheme.primary.copy(alpha = 0.55f)
                                else MaterialTheme.colorScheme.outlineVariant,
                            ),
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .clickable { onToggle(item.id) },
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
                            ) {
                                Checkbox(
                                    checked = checked,
                                    onCheckedChange = { onToggle(item.id) },
                                )
                                Column(Modifier.padding(start = 4.dp).weight(1f)) {
                                    Text(
                                        item.title,
                                        style = MaterialTheme.typography.bodyMedium,
                                        fontWeight = if (checked) FontWeight.Bold else FontWeight.Medium,
                                    )
                                    item.subtitle?.takeIf { it.isNotBlank() }?.let {
                                        Text(
                                            it,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    Button(
                        onClick = onDismiss,
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Text("تمّ (${selectedIds.size})", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

/** نافذةُ تأكيد. */
@Composable
fun ConfirmDialog(
    title: String,
    message: String,
    confirmLabel: String = "تأكيد",
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        shape = ShapeDialog,
        confirmButton = {
            TextButton(onClick = onConfirm) { Text(confirmLabel, fontWeight = FontWeight.Bold) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("رجوع") }
        },
        title = { Text(title, fontWeight = FontWeight.Bold) },
        text = { Text(message) },
    )
}

/** زرُّ إجراءٍ كبير. */
@Composable
fun ActionButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    enabled: Boolean = true,
    loading: Boolean = false,
) {
    Button(
        onClick = onClick,
        enabled = enabled && !loading,
        modifier = modifier.height(52.dp),
        shape = RoundedCornerShape(16.dp),
    ) {
        if (loading) {
            CircularProgressIndicator(
                modifier = Modifier.size(20.dp),
                strokeWidth = 2.dp,
                color = MaterialTheme.colorScheme.onPrimary,
            )
            Spacer(Modifier.width(8.dp))
        } else if (icon != null) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(label, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.ExtraBold)
    }
}

/** مؤشّرُ تحميلٍ وسطيّ. */
@Composable
fun CenterLoading(text: String? = null, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxWidth().padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator()
        if (text != null) {
            Spacer(Modifier.height(10.dp))
            Text(
                text,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** حقلُ بحثٍ أنيق بزرّ مسحٍ فوريّ وتباعدٍ سفليّ مريح للقوائم. */
@Composable
fun SearchField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "بحث…",
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.fillMaxWidth().padding(bottom = 8.dp),
        singleLine = true,
        shape = ShapeField,
        placeholder = { Text(placeholder) },
        leadingIcon = {
            Icon(Icons.Filled.Search, contentDescription = null, modifier = Modifier.size(19.dp))
        },
        trailingIcon = if (value.isNotEmpty()) {
            {
                IconButton(onClick = { onValueChange("") }) {
                    Icon(Icons.Filled.Clear, contentDescription = "مسح البحث", modifier = Modifier.size(18.dp))
                }
            }
        } else null,
        colors = OutlinedTextFieldDefaults.colors(
            unfocusedContainerColor = MaterialTheme.colorScheme.surface,
            focusedContainerColor = MaterialTheme.colorScheme.surface,
        ),
    )
}

/** حقلُ تاريخٍ بمنتقيٍّ رسميّ. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DatePickerField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var open by remember { mutableStateOf(false) }
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        placeholder = { Text("yyyy-mm-dd") },
        singleLine = true,
        shape = ShapeField,
        modifier = modifier.fillMaxWidth(),
        trailingIcon = {
            IconButton(onClick = { open = true }) {
                Icon(
                    Icons.Filled.CalendarMonth,
                    contentDescription = "اختيار التاريخ",
                    tint = MaterialTheme.colorScheme.primary,
                )
            }
        },
        colors = OutlinedTextFieldDefaults.colors(
            unfocusedContainerColor = MaterialTheme.colorScheme.surface,
            focusedContainerColor = MaterialTheme.colorScheme.surface,
        ),
    )
    if (open) {
        val initialMillis = runCatching {
            LocalDate.parse(value.trim()).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
        }.getOrDefault(System.currentTimeMillis())
        val state = rememberDatePickerState(initialSelectedDateMillis = initialMillis)
        DatePickerDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                TextButton(
                    onClick = {
                        state.selectedDateMillis?.let { millis ->
                            onValueChange(
                                Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate().toString()
                            )
                        }
                        open = false
                    }
                ) { Text("اختيار", fontWeight = FontWeight.Bold) }
            },
            dismissButton = { TextButton(onClick = { open = false }) { Text("رجوع") } },
        ) {
            DatePicker(state = state)
        }
    }
}

/** سحبٌ للتحديث. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PullRefreshBox(
    refreshing: Boolean,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val state = rememberPullToRefreshState()
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = onRefresh,
        state = state,
        modifier = modifier,
    ) {
        content()
    }
}

/** نافذةُ بطاقةٍ تفصيليّةٍ لمستندٍ (فاتورة/سند). */
@Composable
fun DocumentDetailDialog(
    title: String,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = ShapeDialog,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 6.dp,
            border = BorderStroke(1.dp, BakeryColors.Hairline),
            modifier = modifier.fillMaxWidth().heightIn(max = 620.dp),
        ) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                        if (subtitle != null) {
                            Text(
                                subtitle,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Filled.Close, contentDescription = "إغلاق")
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                content()
            }
        }
    }
}

/** تأكيدُ إجراءٍ بسببٍ. */
@Composable
fun ConfirmReasonDialog(
    title: String,
    message: String,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
    confirmLabel: String = "تأكيد",
    reasonLabel: String = "السبب",
    reasonRequired: Boolean = true,
) {
    var reason by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        shape = ShapeDialog,
        title = { Text(title, fontWeight = FontWeight.Bold) },
        text = {
            Column {
                Text(message)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = reason,
                    onValueChange = { reason = it },
                    label = { Text(reasonLabel) },
                    singleLine = true,
                    shape = ShapeField,
                    isError = reasonRequired && reason.isBlank(),
                    supportingText = if (reasonRequired && reason.isBlank()) {
                        { Text("السببُ مطلوبٌ قبل المتابعة.") }
                    } else {
                        null
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(reason.trim()) },
                enabled = !reasonRequired || reason.isNotBlank(),
            ) { Text(confirmLabel, fontWeight = FontWeight.Bold) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("رجوع") } },
    )
}

/** سطورُ مستندٍ (فاتورة مبيعات/مشتريات) في البطاقة التفصيليّة. */
@Composable
fun DocumentLines(
    lines: List<com.erpcloud.bakery.data.api.InvoiceLineDto>,
    itemName: (String) -> String,
) {
    lines.forEachIndexed { index, line ->
        Surface(
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
            shape = RoundedCornerShape(12.dp),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
        ) {
            Column(Modifier.padding(horizontal = 12.dp, vertical = 9.dp)) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "${index + 1}. ${line.description ?: itemName(line.itemId)}",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.weight(1f),
                    )
                    StatusChip("×${line.quantity}", ChipTone.NEUTRAL)
                }
                Spacer(Modifier.height(4.dp))
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        "سعر الوحدة: ${line.unitPrice ?: "—"}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "الإجمالي: ${line.total ?: "—"}",
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.ExtraBold,
                    )
                }
            }
        }
    }
}

/** زرُّ إجراءٍ ثانويّ أنيق بحوافّ مستديرة داخل البطاقات (تفاصيل/تعديل/إبطال). */
@Composable
fun InlineAction(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    tone: ChipTone = ChipTone.INFO,
) {
    val (bg, fg) = when (tone) {
        ChipTone.OK -> BakeryColors.OkBg to BakeryColors.Ok
        ChipTone.WARN -> BakeryColors.WarnBg to BakeryColors.Warn
        ChipTone.DANGER -> BakeryColors.DangerBg to BakeryColors.Danger
        ChipTone.INFO -> MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.55f) to MaterialTheme.colorScheme.primary
        ChipTone.NEUTRAL -> MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
    }
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(50),
        color = if (enabled) bg else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
        border = BorderStroke(
            1.dp,
            if (enabled) fg.copy(alpha = 0.28f) else MaterialTheme.colorScheme.outlineVariant,
        ),
        modifier = modifier,
    ) {
        Text(
            label,
            color = if (enabled) fg else MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
        )
    }
}

/**
 * مصدرُ تفاعلٍ لحقول الانتقاء المقروءة (`OutlinedTextField(readOnly = true)`) —
 * يجعل الضغط على أيّ موضعٍ في الحقل يفتح نافذة الاختيار فورًا، لا مجرّد زرّ «اختر» الجانبيّ.
 */
@Composable
fun rememberPickerInteractionSource(onClick: () -> Unit): MutableInteractionSource {
    val source = remember { MutableInteractionSource() }
    val currentOnClick by rememberUpdatedState(onClick)
    LaunchedEffect(source) {
        source.interactions.collect { interaction ->
            if (interaction is PressInteraction.Release) {
                currentOnClick()
            }
        }
    }
    return source
}

/** زرُّ فتحِ منتقي العناصر داخل الحقول المقروءة — كبسولةٌ واضحةٌ بأيقونة سهمين لا تُقصُّ نصَّ «اختر». */
@Composable
fun PickerTrigger(
    onClick: () -> Unit,
    label: String = "اختر",
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(10.dp),
        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.65f),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.28f)),
        modifier = modifier.padding(end = 6.dp),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Text(
                label,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Bold,
            )
            Icon(
                Icons.Filled.UnfoldMore,
                contentDescription = label,
                tint = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.size(16.dp),
            )
        }
    }
}

/** صندوقُ تنبيهٍ أو إرشادٍ منظم داخل نماذج الإدخال والشاشات. */
@Composable
fun InfoCallout(
    text: String,
    tone: ChipTone = ChipTone.INFO,
    modifier: Modifier = Modifier,
) {
    val (bg, fg) = when (tone) {
        ChipTone.OK -> BakeryColors.OkBg to BakeryColors.Ok
        ChipTone.WARN -> BakeryColors.WarnBg to BakeryColors.Warn
        ChipTone.DANGER -> BakeryColors.DangerBg to BakeryColors.Danger
        ChipTone.INFO -> BakeryColors.InfoBg to BakeryColors.Info
        ChipTone.NEUTRAL -> MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
    }
    val icon = when (tone) {
        ChipTone.OK -> Icons.Filled.CheckCircle
        ChipTone.WARN -> Icons.Filled.WarningAmber
        ChipTone.DANGER -> Icons.Filled.ErrorOutline
        ChipTone.INFO, ChipTone.NEUTRAL -> Icons.Filled.Info
    }
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = bg,
        border = BorderStroke(1.dp, fg.copy(alpha = 0.25f)),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(18.dp))
            Text(
                text,
                color = fg,
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

/** بطاقةُ عنصرٍ في قائمة مع دعم النقر الاختياريّ. */
@Composable
fun ListItemCard(
    modifier: Modifier = Modifier,
    highlighted: Boolean = false,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(16.dp)
    val bg = if (highlighted) {
        MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.28f)
    } else {
        MaterialTheme.colorScheme.surface
    }
    val border = BorderStroke(
        width = if (highlighted) 1.4.dp else 1.dp,
        color = if (highlighted) MaterialTheme.colorScheme.primary.copy(alpha = 0.55f)
        else MaterialTheme.colorScheme.outlineVariant,
    )
    if (onClick != null) {
        Surface(
            onClick = onClick,
            shape = shape,
            color = bg,
            border = border,
            modifier = modifier.fillMaxWidth(),
        ) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
                content = content,
            )
        }
    } else {
        Surface(
            shape = shape,
            color = bg,
            border = border,
            modifier = modifier.fillMaxWidth(),
        ) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
                content = content,
            )
        }
    }
}

