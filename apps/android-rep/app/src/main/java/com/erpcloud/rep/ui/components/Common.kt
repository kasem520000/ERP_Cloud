package com.erpcloud.rep.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/**
 * نظامُ التصميم المشترك لتطبيق المندوب — دافئٌ (كهرمان التوزيع) عاليُ التباين
 * للعمل في الشمس، وكلُّ مكوّنٍ يعملُ في الفاتحِ والداكن (يُقرأُ إضاءةُ الثيم).
 * التواقيعُ القديمةُ محفوظةٌ حرفيًّا كي لا تنكسرَ شاشة.
 */

/** إشعارٌ عابر — نتيجةُ إجراءٍ أو خطأ. */
data class Notice(
    val kind: Kind,
    val text: String,
) {
    enum class Kind { OK, WARN, DANGER }

    companion object {
        fun ok(text: String) = Notice(Kind.OK, text)
        fun warn(text: String) = Notice(Kind.WARN, text)
        fun danger(text: String) = Notice(Kind.DANGER, text)
    }
}

/** هل الثيمُ الداكنُ هو السائد؟ (تُشتقّ ألوانُ الشرائح منه). */
@Composable
private fun isDarkTheme(): Boolean = MaterialTheme.colorScheme.background.luminance() < 0.5f

/** ألوانُ النغمات الثابتة — زوجٌ للفاتح وزوجٌ للداكن، وبلا أزرق (تيلٌ بدله). */
@Composable
private fun toneColors(tone: ChipTone): Pair<Color, Color> {
    val dark = isDarkTheme()
    return when (tone) {
        ChipTone.OK -> if (dark) Color(0xFF14532D) to Color(0xFF86EFAC) else Color(0xFFDCFCE7) to Color(0xFF14532D)
        ChipTone.WARN -> if (dark) Color(0xFF78350F) to Color(0xFFFCD34D) else Color(0xFFFEF3C7) to Color(0xFF78350F)
        ChipTone.DANGER -> if (dark) Color(0xFF7F1D1D) to Color(0xFFFCA5A5) else Color(0xFFFEE2E2) to Color(0xFF7F1D1D)
        ChipTone.INFO -> if (dark) Color(0xFF134E4A) to Color(0xFF5EEAD4) else Color(0xFFCCFBF1) to Color(0xFF134E4A)
        ChipTone.NEUTRAL -> MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
    }
}

/** بطاقةُ قسمٍ بعنوانٍ كهرمانيٍّ عريضٍ وفاصلٍ خفيف. */
@Composable
fun SectionCard(
    title: String?,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            if (title != null) {
                Text(
                    title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.ExtraBold,
                    color = titleColor(),
                )
            }
            if (subtitle != null) {
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (title != null) {
                Spacer(Modifier.height(8.dp))
                Box(
                    Modifier
                        .fillMaxWidth(0.38f)
                        .height(3.dp)
                        .background(titleColor().copy(alpha = 0.55f), RoundedCornerShape(2.dp))
                )
                Spacer(Modifier.height(10.dp))
            } else if (subtitle != null) {
                Spacer(Modifier.height(8.dp))
            }
            content()
        }
    }
}

/** لونُ عناوين الأقسام — كهرمانيٌّ غامقٌ في الفاتح وكهرمانيٌّ فاتحٌ في الداكن. */
@Composable
private fun titleColor(): Color =
    if (isDarkTheme()) Color(0xFFFBBF24) else Color(0xFF7C3A0B)

/** سطرُ مفتاح/قيمة — المفتاحُ رماديٌّ والقيمةُ عريضةٌ نحو البداية. */
@Composable
fun KeyValue(label: String, value: String, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.fillMaxWidth().padding(vertical = 3.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.End,
        )
    }
}

/** شريحةُ حالةٍ ملوّنة — متوافقةٌ مع الفاتح والداكن (تيلٌ بدل الأزرق للمعلومة). */
@Composable
fun StatusChip(text: String, tone: ChipTone = ChipTone.NEUTRAL) {
    val (bg, fg) = toneColors(tone)
    Surface(color = bg, shape = RoundedCornerShape(10.dp)) {
        Text(
            text,
            color = fg,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}

enum class ChipTone { OK, WARN, DANGER, INFO, NEUTRAL }

/**
 * بطاقةُ إحصائيّةٍ للرأس — الأيقونةُ في صندوقٍ ملوّنٍ والقيمةُ ExtraBold بلون النغمة.
 * الرقمُ دائمًا من الخادم (نصًّا) — البطاقةُ تعرضُه ولا تحسبُه.
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
        ChipTone.OK -> if (isDarkTheme()) Color(0xFF86EFAC) else Color(0xFF14532D)
        ChipTone.WARN -> if (isDarkTheme()) Color(0xFFFCD34D) else Color(0xFF78350F)
        ChipTone.DANGER -> if (isDarkTheme()) Color(0xFFFCA5A5) else Color(0xFF7F1D1D)
        ChipTone.INFO -> if (isDarkTheme()) Color(0xFF5EEAD4) else Color(0xFF0F766E)
        ChipTone.NEUTRAL -> MaterialTheme.colorScheme.onSurface
    }
    val (chipBg, chipFg) = toneColors(tone)
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (icon != null) {
                    Surface(
                        color = if (tone == ChipTone.NEUTRAL) {
                            MaterialTheme.colorScheme.primaryContainer
                        } else {
                            chipBg
                        },
                        shape = RoundedCornerShape(10.dp),
                    ) {
                        Icon(
                            icon,
                            contentDescription = null,
                            tint = if (tone == ChipTone.NEUTRAL) MaterialTheme.colorScheme.primary else chipFg,
                            modifier = Modifier.padding(6.dp).size(18.dp),
                        )
                    }
                    Spacer(Modifier.width(8.dp))
                }
                Text(
                    label,
                    style = MaterialTheme.typography.bodyMedium,
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
                    style = MaterialTheme.typography.bodyMedium,
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
        shape = RoundedCornerShape(10.dp),
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

/** حالةٌ فارغة — بطاقةٌ بأيقونةٍ في دائرةٍ ونصٍّ وسطيّ. */
@Composable
fun EmptyState(text: String, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier.fillMaxWidth().padding(vertical = 6.dp),
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
    ) {
        Column(
            Modifier.fillMaxWidth().padding(vertical = 18.dp, horizontal = 14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Surface(
                shape = RoundedCornerShape(50),
                color = MaterialTheme.colorScheme.primaryContainer,
            ) {
                Icon(
                    Icons.Default.Inbox,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(10.dp).size(22.dp),
                )
            }
            Spacer(Modifier.height(8.dp))
            Text(
                text,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/** شريطُ الإشعار العلويّ — بأيقونةٍ قائدةٍ حسب النوع. */
@Composable
fun NoticeBanner(notice: Notice?, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    if (notice == null) return
    val dark = isDarkTheme()
    val (bg, fg, icon) = when (notice.kind) {
        Notice.Kind.OK ->
            if (dark) Triple(Color(0xFF14532D), Color(0xFFBBF7D0), Icons.Default.CheckCircle)
            else Triple(Color(0xFFDCFCE7), Color(0xFF14532D), Icons.Default.CheckCircle)
        Notice.Kind.WARN ->
            if (dark) Triple(Color(0xFF78350F), Color(0xFFFEF08A), Icons.Default.WarningAmber)
            else Triple(Color(0xFFFEF3C7), Color(0xFF78350F), Icons.Default.WarningAmber)
        Notice.Kind.DANGER ->
            if (dark) Triple(Color(0xFF7F1D1D), Color(0xFFFECACA), Icons.Default.Error)
            else Triple(Color(0xFFFEE2E2), Color(0xFF7F1D1D), Icons.Default.Error)
    }
    Surface(color = bg, modifier = modifier.fillMaxWidth()) {
        Row(
            Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(8.dp))
            Text(
                notice.text,
                color = fg,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = onDismiss) { Text("إغلاق", color = fg) }
        }
    }
}

/** عنصرُ اختيارٍ في نافذةِ الانتقاء. */
data class PickerItem(
    val id: String,
    val title: String,
    val subtitle: String? = null,
    val trailing: String? = null,
)

/**
 * نافذةُ انتقاءٍ من قائمة (أمرُ تحميل، عميل، فاتورة…) — **مع بحثٍ حيٍّ** في العنوان
 * والسطر الثانويّ حين تزيدُ العناصرُ عن ٧: مندوبٌ معه مئاتُ العملاء يختارُ بطاقتَه
 * بثلاثةِ أحرفٍ لا بتمريرٍ أعمى.
 */
@Composable
fun PickerDialog(
    title: String,
    items: List<PickerItem>,
    onDismiss: () -> Unit,
    onSelect: (PickerItem) -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }
    val searchable = items.size > 7
    val visible = if (!searchable || query.isBlank()) items else items.filter { item ->
        item.title.contains(query.trim(), ignoreCase = true) ||
            (item.subtitle?.contains(query.trim(), ignoreCase = true) == true) ||
            (item.trailing?.contains(query.trim(), ignoreCase = true) == true)
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("إلغاء") }
        },
        title = { Text(title) },
        text = {
            Column {
                if (searchable) {
                    OutlinedTextField(
                        value = query,
                        onValueChange = { query = it },
                        label = { Text("بحث…") },
                        singleLine = true,
                        trailingIcon = {
                            if (query.isNotEmpty()) {
                                IconButton(onClick = { query = "" }) {
                                    Icon(Icons.Default.Clear, contentDescription = "مسح البحث")
                                }
                            } else {
                                Icon(Icons.Default.Search, contentDescription = null)
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        if (query.isBlank()) "${items.size} عنصرًا" else "${visible.size} من ${items.size}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(4.dp))
                }
                if (visible.isEmpty()) {
                    Text(
                        if (searchable && query.isNotBlank()) "لا نتائجَ تطابقُ «${query.trim()}»." else "لا عناصرَ متاحة.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    LazyColumn(
                        modifier = Modifier.height(360.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        items(visible, key = { it.id }) { item ->
                            Surface(
                                shape = RoundedCornerShape(12.dp),
                                color = MaterialTheme.colorScheme.surfaceVariant,
                                onClick = { onSelect(item); onDismiss() },
                            ) {
                                Row(
                                    Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 9.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Column(Modifier.weight(1f)) {
                                        Text(
                                            item.title,
                                            style = MaterialTheme.typography.bodyLarge,
                                            fontWeight = FontWeight.SemiBold,
                                        )
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
                                        Text(
                                            item.trailing,
                                            style = MaterialTheme.typography.bodyMedium,
                                            fontWeight = FontWeight.SemiBold,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
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

/** زرُّ إجراءٍ كبير — ٥٢دب بحواف ١٦. */
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
        Text(label, fontWeight = FontWeight.Bold)
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
