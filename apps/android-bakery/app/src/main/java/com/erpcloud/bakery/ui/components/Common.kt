package com.erpcloud.bakery.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.WarningAmber
import androidx.compose.material3.Checkbox
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.window.Dialog
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import com.erpcloud.bakery.ui.theme.BakeryColors
import com.erpcloud.bakery.ui.theme.ShapeCard

/** إشعارٌ عابر — نتيجةُ إجراءٍ أو خطأ. */
data class Notice(
    val kind: Kind,
    val text: String,
    /** مُعرِّفٌ متزايد — يُميّز رسالتين متطابقتين فتلتقطهما الحركةُ العائمة. */
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

/** بطاقةُ قسمٍ بعنوان. */
@Composable
fun SectionCard(
    title: String?,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    // بطاقةُ نظامِ التصميم v3: سطحٌ أبيضُ بظلٍّ كهرمانيٍّ ناعمٍ نصفِ شفّافٍ
    // (كما في الموك-أب)، حدٌّ دافئٌ خفيف، وزوايا ٢٦ — لا ظلٍّ رماديَّ خام.
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .shadow(
                elevation = 8.dp,
                shape = ShapeCard,
                ambientColor = BakeryColors.Primary.copy(alpha = 0.10f),
                spotColor = BakeryColors.Primary.copy(alpha = 0.14f),
            ),
        shape = ShapeCard,
        color = MaterialTheme.colorScheme.surface,
        border = androidx.compose.foundation.BorderStroke(1.dp, BakeryColors.Hairline),
    ) {
        Column(Modifier.padding(18.dp)) {
            if (title != null) {
                Text(
                    title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = com.erpcloud.bakery.ui.theme.BakeryColors.PrimaryDark,
                )
            }
            if (subtitle != null) {
                Spacer(Modifier.height(2.dp))
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (title != null || subtitle != null) Spacer(Modifier.height(12.dp))
            content()
        }
    }
}

/** سطرُ مفتاح/قيمة. */
@Composable
fun KeyValue(label: String, value: String, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.End,
        )
    }
}

/** شريحةُ حالةٍ ملوّنة. */
@Composable
fun StatusChip(text: String, tone: ChipTone = ChipTone.NEUTRAL) {
    val (bg, fg) = when (tone) {
        ChipTone.OK -> BakeryColors.OkBg to BakeryColors.Ok
        ChipTone.WARN -> BakeryColors.WarnBg to BakeryColors.Warn
        ChipTone.DANGER -> BakeryColors.DangerBg to BakeryColors.Danger
        ChipTone.INFO -> BakeryColors.InfoBg to BakeryColors.Info
        ChipTone.NEUTRAL -> MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
    }
    Surface(color = bg, shape = RoundedCornerShape(50)) {
        Text(
            text,
            color = fg,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}

enum class ChipTone { OK, WARN, DANGER, INFO, NEUTRAL }

/**
 * بطاقةُ إحصائيّةٍ للرأس — قيمةٌ كبيرة وخطٌّ ثانويّ ولونُ نغمة. الرقمُ دائمًا من
 * الخادم (نصًّا) — البطاقةُ تعرضُه ولا تحسبُه.
 */
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
    // بلاطةُ الإحصائيّة v3 (كما في لوحة القيادة بالموك-أب): الأيقونةُ داخلَ
    // صندوقٍ مستديرٍ بلونِ النغمةِ الشفّاف، والرقمُ ضخمٌ بوزنٍ ثقيل.
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
                elevation = 8.dp,
                shape = RoundedCornerShape(22.dp),
                ambientColor = BakeryColors.Primary.copy(alpha = 0.10f),
                spotColor = BakeryColors.Primary.copy(alpha = 0.14f),
            ),
        shape = RoundedCornerShape(22.dp),
        color = MaterialTheme.colorScheme.surface,
        border = androidx.compose.foundation.BorderStroke(1.dp, BakeryColors.Hairline),
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (icon != null) {
                    Surface(
                        color = iconBg,
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.size(34.dp),
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                icon,
                                contentDescription = null,
                                tint = valueColor,
                                modifier = Modifier.size(19.dp),
                            )
                        }
                    }
                    Spacer(Modifier.width(8.dp))
                }
                Text(
                    label,
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
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

/** شارةُ عدّادٍ صغيرة (غيرُ المقروء من الإشعارات، عددُ نيّات الطابور…). */
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

/** أرقامٌ عربيّة-هندية للعرض — كلمةُ العدّاد في واجهةٍ عربيّة. */
private fun formatArabicDigits(value: Int): String =
    value.toString().map { char ->
        if (char in '0'..'9') ('٠' + (char - '0')) else char
    }.joinToString("")

/** حالةٌ فارغة. */
@Composable
fun EmptyState(text: String, modifier: Modifier = Modifier) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
        shape = RoundedCornerShape(18.dp),
        modifier = modifier.fillMaxWidth().padding(vertical = 10.dp),
    ) {
        Text(
            text,
            modifier = Modifier.padding(horizontal = 18.dp, vertical = 22.dp).fillMaxWidth(),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

/**
 * لافتةُ الإشعار — رسائلُ الخادم وأخطاؤه كما يجبُ أن تُرى:
 * بطاقةٌ عائمةٌ بحوافٍ ١٨ وأيقونةٍ دائريّةٍ تقودُ العينَ ولونِ الحالة من
 * لوحة v3 (أخضرُ نجاحٍ / كهرمانُ تحذيرٍ / أحمرُ خطرٍ)، لا شريطٌ خامٌ
 * يلتصقُ بأعلى الشاشة.
 */
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
        border = androidx.compose.foundation.BorderStroke(1.dp, fg.copy(alpha = 0.25f)),
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
            TextButton(onClick = onDismiss) {
                Icon(Icons.Filled.Close, contentDescription = "إغلاق", tint = fg, modifier = Modifier.size(18.dp))
            }
        }
    }
}


/**
 * تنبيهُ الصلاحية المفقودة — **لا يُخفى الزرُّ بصمتًا أبدًا**: حين لا يملك دورُ
 * المستخدم إذنَ العملية، تُعرض هذه اللافتةُ مكانَ الزرّ، باسمِ الصلاحيةِ
 * **بالعربية**، فيعرفُ المستخدمُ أنّ الشاشةَ موجودةٌ والعمليةَ ممكنةٌ وأنّ
 * النقصَ في دورِه لا في التطبيق.
 */
@Composable
fun MissingPermissionHint(actionAr: String, permissionCode: String, modifier: Modifier = Modifier) {
    Surface(
        color = BakeryColors.WarnBg,
        shape = RoundedCornerShape(14.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, BakeryColors.Warn.copy(alpha = 0.25f)),
        modifier = modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 4.dp),
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

/** نافذةُ انتقاءٍ من قائمة (أمرُ تحميل، عميل، فاتورة…). */
@Composable
fun PickerDialog(
    title: String,
    items: List<PickerItem>,
    onDismiss: () -> Unit,
    onSelect: (PickerItem) -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("إلغاء") }
        },
        title = { Text(title) },
        text = {
            if (items.isEmpty()) {
                Text("لا عناصرَ متاحة.")
            } else {
                LazyColumn(
                    modifier = Modifier.height(360.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    items(items, key = { it.id }) { item ->
                        Surface(
                            shape = RoundedCornerShape(10.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant,
                            onClick = { onSelect(item); onDismiss() },
                        ) {
                            Row(
                                Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(item.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
                                    if (item.subtitle != null) {
                                        Text(
                                            item.subtitle,
                                            style = MaterialTheme.typography.bodyMedium,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                                if (item.trailing != null) {
                                    Spacer(Modifier.width(8.dp))
                                    Text(item.trailing, style = MaterialTheme.typography.bodyMedium)
                                }
                            }
                        }
                    }
                }
            }
        },
    )
}

/** نافذةُ انتقاءٍ متعدّدٍ (أذوناتُ دور، أدوارُ مستخدم، نطاقُ فروع) — toggle مباشر. */
@Composable
fun MultiPickerDialog(
    title: String,
    items: List<PickerItem>,
    selectedIds: Set<String>,
    onToggle: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title, style = MaterialTheme.typography.titleMedium) },
        text = {
            LazyColumn(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                items(items, key = { it.id }) { item ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onToggle(item.id) }
                            .padding(vertical = 2.dp),
                    ) {
                        Checkbox(
                            checked = item.id in selectedIds,
                            onCheckedChange = { onToggle(item.id) },
                        )
                        Column(Modifier.padding(start = 4.dp)) {
                            Text(item.title, style = MaterialTheme.typography.bodyMedium)
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
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("تمّ") }
        },
    )
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
        confirmButton = {
            TextButton(onClick = onConfirm) { Text(confirmLabel) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("رجوع") }
        },
        title = { Text(title) },
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
    androidx.compose.material3.Button(
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
        Text(label)
    }
}

/** مؤشّرُ تحميلٍ وسطيّ. */
@Composable
fun CenterLoading(text: String? = null, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxWidth().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator()
        if (text != null) {
            Spacer(Modifier.height(10.dp))
            Text(text, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

// ============================================================ مكوّنات المرحلة الثانية

/** حقلُ بحثٍ — لكلّ قائمةٍ طويلةٍ (أصناف/موظفون/أطراف/فواتير). */
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
        modifier = modifier.fillMaxWidth(),
        singleLine = true,
        placeholder = { Text(placeholder) },
        leadingIcon = {
            Icon(Icons.Filled.Search, contentDescription = null, modifier = Modifier.size(18.dp))
        },
    )
}

/**
 * حقلُ تاريخٍ بمنتقيٍّ رسميّ — النصُّ يبقى قابلًا للكتابة (yyyy-mm-dd) والزرُّ
 * يفتحُ منتقيَ Material3؛ لا مزيدَ من التواريخ الخام بلا تحقّق.
 */
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
        modifier = modifier.fillMaxWidth(),
        trailingIcon = {
            IconButton(onClick = { open = true }) {
                Icon(Icons.Filled.CalendarMonth, contentDescription = "اختيار التاريخ")
            }
        },
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
                ) { Text("اختيار") }
            },
            dismissButton = { TextButton(onClick = { open = false }) { Text("رجوع") } },
        ) {
            DatePicker(state = state)
        }
    }
}

/** سحبٌ للتحديث — لكلّ شاشةِ قائمةٍ رئيسة (Material3 PullToRefresh). */
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

/**
 * نافذةُ بطاقةٍ تفصيليّةٍ لمستندٍ (فاتورة/سند) — ترويسةٌ قابلةٌ للإغلاق ومحتوى
 * يمسحُ عموديًّا مهما طال: عرضُ كلّ السطور والدفعات في مكانٍ واحد.
 */
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
            shape = MaterialTheme.shapes.extraLarge,
            tonalElevation = 6.dp,
            modifier = modifier.fillMaxWidth(),
        ) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(20.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(title, style = MaterialTheme.typography.titleLarge)
                        if (subtitle != null) {
                            Text(
                                subtitle,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Filled.Close, contentDescription = "إغلاق")
                    }
                }
                Spacer(Modifier.height(12.dp))
                content()
            }
        }
    }
}

/**
 * تأكيدُ إجراءٍ بسببٍ — لكلّ عمليّةِ إبطالٍ أو رفضٍ أو قرارِ فرقٍ: الخادمُ يطلبُ
 * سببًا نصيًّا فلا يُرسلَ سببٌ مُخترَعٌ نيابةً عن المستخدم.
 */
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
        title = { Text(title) },
        text = {
            Column {
                Text(message)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = reason,
                    onValueChange = { reason = it },
                    label = { Text(reasonLabel) },
                    singleLine = true,
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

/** سطورُ مستندٍ (فاتورة مبيعات/مشتريات) في البطاقة التفصيليّة — أرقامُ الخادم نصًّا. */
@Composable
fun DocumentLines(
    lines: List<com.erpcloud.bakery.data.api.InvoiceLineDto>,
    itemName: (String) -> String,
) {
    lines.forEachIndexed { index, line ->
        Surface(
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
        ) {
            Column(Modifier.padding(horizontal = 10.dp, vertical = 8.dp)) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "${index + 1}. ${line.description ?: itemName(line.itemId)}",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f),
                    )
                    Text("×${line.quantity}", style = MaterialTheme.typography.bodyMedium)
                }
                Spacer(Modifier.height(2.dp))
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
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
    }
}

/** زرُّ نصٍّ صغيرٌ للإجراءات الثانويّة داخل البطاقات (تفاصيل/تعديل/إبطال). */
@Composable
fun InlineAction(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    tone: ChipTone = ChipTone.INFO,
) {
    val color = when (tone) {
        ChipTone.OK -> BakeryColors.Ok
        ChipTone.WARN -> BakeryColors.Warn
        ChipTone.DANGER -> BakeryColors.Danger
        ChipTone.INFO -> MaterialTheme.colorScheme.primary
        ChipTone.NEUTRAL -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    TextButton(onClick = onClick, enabled = enabled, modifier = modifier) {
        Text(label, color = if (enabled) color else MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.Bold)
    }
}
