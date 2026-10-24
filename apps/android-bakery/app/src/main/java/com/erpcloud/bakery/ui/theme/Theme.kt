package com.erpcloud.bakery.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.erpcloud.bakery.R

/**
 * نظامُ التصميم v3 المعتمد — كما في `design-mockups/09_design_system.png`:
 *
 * - **الخطّ**: Tajawal في كلّ شيء (الرسميّ من google/fonts/ofl/tajawal).
 * - **الخلفيّة**: `#FAF6F0` (ورقيّة دافئة) والسطوحُ بيضاءُ بظلٍّ ناعمٍ نصف شفّاف.
 * - **اللونُ الأساسيّ**: `#B45309` (كهرمانيّ مخبوز) — هو وأحواضُه لونُ الهويّة.
 * - **الحالات**: OK `#15803D` · WARN `#92400E` · DANGER `#B91C1C` · INFO `#1D4ED8`.
 * - **الاستدارة**: ٢٦ للحاويات الكبيرة (البطاقات/الحوارات)، ١٨ للمتوسّطة، ١٠ للصغيرة.
 * - **RTL**: كلُّ تخطيطٍ من اليمين إلى اليسار، والـFAB أسفلُ يسارٍ (يدُ اليمين حرّة).
 */

/** Tajawal — Regular/Medium/Bold/ExtraBold. */
val Tajawal = FontFamily(
    Font(R.font.tajawal_regular, FontWeight.Normal),
    Font(R.font.tajawal_medium, FontWeight.Medium),
    Font(R.font.tajawal_bold, FontWeight.Bold),
    Font(R.font.tajawal_extrabold, FontWeight.ExtraBold),
)

// ------------------------------------------------------------ الألوان
object BakeryColors {
    /** كهرمانيّ مخبوز — لونُ الهويّة الأساسيّ (ثابتٌ في الوضعين). */
    val Primary = Color(0xFFB45309)
    val PrimaryDark = Color(0xFF7C3A0B)
    val PrimaryContainer = Color(0xFFFFEDD5)
    /** ورقيّةٌ دافئة — خلفيّةُ الشاشات (الوضع الفاتح). */
    val Background = Color(0xFFFAF6F0)

    /**
     * الحالاتُ الأربع — في الوضع الفاتح درجاتُ الموك-أب حرفيًّا، وفي الوضع الغامق
     * تُعادُ خريطتُها إلى درجاتٍ فاتحةٍ وخلفيّاتٍ شفّافةٍ (١٦٪) فوق الأسطح الغامقة،
     * كي تبقى الرقائقُ واللافتاتُ والحوافُّ مقروءةً — getter تركيبيٌّ فتبقى المواضعُ
     * القديمةُ (`BakeryColors.Ok`…) تعملَ كما هي.
     */
    val Ok: Color
        @Composable get() = if (isSystemInDarkTheme()) Color(0xFF4ADE80) else Color(0xFF15803D)
    val OkBg: Color
        @Composable get() = if (isSystemInDarkTheme()) Color(0x294ADE80) else Color(0xFFDCFCE7)
    val Warn: Color
        @Composable get() = if (isSystemInDarkTheme()) Color(0xFFFBBF24) else Color(0xFF92400E)
    val WarnBg: Color
        @Composable get() = if (isSystemInDarkTheme()) Color(0x29FBBF24) else Color(0xFFFEF3C7)
    val Danger: Color
        @Composable get() = if (isSystemInDarkTheme()) Color(0xFFF87171) else Color(0xFFB91C1C)
    val DangerBg: Color
        @Composable get() = if (isSystemInDarkTheme()) Color(0x29F87171) else Color(0xFFFEE2E2)
    val Info: Color
        @Composable get() = if (isSystemInDarkTheme()) Color(0xFF93C5FD) else Color(0xFF1D4ED8)
    val InfoBg: Color
        @Composable get() = if (isSystemInDarkTheme()) Color(0x2993C5FD) else Color(0xFFDBEAFE)
    /** سطرُ فاصلٌ دافئٌ خفيف — أوضحُ قليلًا على الأسطح الغامقة. */
    val Hairline: Color
        @Composable get() = if (isSystemInDarkTheme()) Color(0x2EFBBF24) else Color(0x14B45309)
}

private val LightColors = lightColorScheme(
    primary = BakeryColors.Primary,
    onPrimary = Color.White,
    primaryContainer = BakeryColors.PrimaryContainer,
    onPrimaryContainer = BakeryColors.PrimaryDark,
    secondary = Color(0xFF92400E),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFFEEBC8),
    onSecondaryContainer = Color(0xFF92400E),
    tertiary = Color(0xFF0F766E),
    background = BakeryColors.Background,
    onBackground = Color(0xFF292524),
    surface = Color.White,
    onSurface = Color(0xFF292524),
    surfaceVariant = Color(0xFFF5EDE3),
    onSurfaceVariant = Color(0xFF78716C),
    outline = Color(0xFFD6CFC5),
    error = Color(0xFFB91C1C),
    onError = Color.White,
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFFBBF24),
    onPrimary = Color(0xFF451A03),
    primaryContainer = BakeryColors.PrimaryDark,
    onPrimaryContainer = Color(0xFFFFEDD5),
    secondary = Color(0xFFFCD34D),
    tertiary = Color(0xFF5EEAD4),
    background = Color(0xFF171210),
    surface = Color(0xFF211A16),
    surfaceVariant = Color(0xFF332A24),
    error = Color(0xFFF87171),
)

/** الاستدارةُ القياسيّة: ٢٦ للبطاقات والحاويات. */
val ShapeCard = RoundedCornerShape(26.dp)
val ShapeDialog = RoundedCornerShape(26.dp)
val ShapeField = RoundedCornerShape(14.dp)
val ShapeChip = RoundedCornerShape(50)

private val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(18.dp),
    large = ShapeCard,
    extraLarge = ShapeDialog,
)

// ------------------------------------------------------------ الخطوط
private val AppTypography = Typography(
    displaySmall = TextStyle(fontFamily = Tajawal, fontWeight = FontWeight.ExtraBold, fontSize = 34.sp),
    headlineMedium = TextStyle(fontFamily = Tajawal, fontWeight = FontWeight.Bold, fontSize = 26.sp),
    headlineSmall = TextStyle(fontFamily = Tajawal, fontWeight = FontWeight.Bold, fontSize = 22.sp),
    titleLarge = TextStyle(fontFamily = Tajawal, fontWeight = FontWeight.Bold, fontSize = 20.sp),
    titleMedium = TextStyle(fontFamily = Tajawal, fontWeight = FontWeight.Bold, fontSize = 16.sp),
    titleSmall = TextStyle(fontFamily = Tajawal, fontWeight = FontWeight.Medium, fontSize = 14.sp),
    bodyLarge = TextStyle(fontFamily = Tajawal, fontWeight = FontWeight.Normal, fontSize = 16.sp),
    bodyMedium = TextStyle(fontFamily = Tajawal, fontWeight = FontWeight.Normal, fontSize = 14.sp),
    bodySmall = TextStyle(fontFamily = Tajawal, fontWeight = FontWeight.Normal, fontSize = 12.sp),
    labelLarge = TextStyle(fontFamily = Tajawal, fontWeight = FontWeight.Bold, fontSize = 15.sp),
    labelMedium = TextStyle(fontFamily = Tajawal, fontWeight = FontWeight.Medium, fontSize = 13.sp),
    labelSmall = TextStyle(fontFamily = Tajawal, fontWeight = FontWeight.Medium, fontSize = 11.sp),
)

@Composable
fun BakeryTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = AppTypography,
        shapes = AppShapes,
        content = content,
    )
}
