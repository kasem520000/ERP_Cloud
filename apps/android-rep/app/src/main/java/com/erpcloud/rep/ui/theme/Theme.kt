package com.erpcloud.rep.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** لوحةُ ألوان المخبز والتوزيع — دافئةٌ عاليةُ التباين للعمل في الوردية والشمس. */
private val BrandPrimary = Color(0xFFB45309)
private val BrandPrimaryDark = Color(0xFF7C3A0B)
private val BrandSecondary = Color(0xFF92400E)
private val BrandTeal = Color(0xFF0F766E)
private val BrandBackground = Color(0xFFFFFBF5)
private val BrandSurface = Color(0xFFFFFFFF)
private val BrandError = Color(0xFFB3261E)

private val LightColors = lightColorScheme(
    primary = BrandPrimary,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFFFEDD5),
    onPrimaryContainer = BrandPrimaryDark,
    secondary = BrandSecondary,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFFEEBC8),
    tertiary = BrandTeal,
    background = BrandBackground,
    surface = BrandSurface,
    surfaceVariant = Color(0xFFF5EDE3),
    error = BrandError,
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFFBBF24),
    onPrimary = Color(0xFF451A03),
    primaryContainer = BrandPrimaryDark,
    onPrimaryContainer = Color(0xFFFFEDD5),
    secondary = Color(0xFFFCD34D),
    tertiary = Color(0xFF5EEAD4),
    background = Color(0xFF171210),
    surface = Color(0xFF211A16),
    error = Color(0xFFF87171),
)

private val AppTypography = Typography(
    headlineSmall = TextStyle(fontWeight = FontWeight.Bold, fontSize = 22.sp),
    titleLarge = TextStyle(fontWeight = FontWeight.Bold, fontSize = 20.sp),
    titleMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 16.sp),
    bodyLarge = TextStyle(fontSize = 16.sp),
    bodyMedium = TextStyle(fontSize = 14.sp),
    labelLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 15.sp),
)

@Composable
fun RepTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = AppTypography,
        content = content,
    )
}
