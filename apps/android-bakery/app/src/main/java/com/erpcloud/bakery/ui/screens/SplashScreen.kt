package com.erpcloud.bakery.ui.screens

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BakeryDining
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.erpcloud.bakery.BuildConfig
import com.erpcloud.bakery.R
import com.erpcloud.bakery.ui.theme.BakeryColors

const val BAKERY_EDITION_LABEL = "نسخة المخابز والإنتاج"

/**
 * شعارٌ مؤسّسيٌّ احترافيّ متّحد — ميداليّةٌ متدرّجةٌ محاطةٌ بحلقةٍ ذهبيّةٍ وشارةِ السحابة،
 * يُستعمل في شاشة الترحيب (Splash) وفي ترويسة شاشة الدخول والقائمة الجانبيّة.
 */
@Composable
fun BrandCrestLogo(
    size: Dp = 118.dp,
    modifier: Modifier = Modifier,
) {
    Box(modifier = modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val r = this.size.minDimension / 2f
            drawCircle(
                color = Color.White.copy(alpha = 0.12f),
                radius = r,
            )
            drawCircle(
                brush = Brush.linearGradient(
                    listOf(
                        Color(0xFFFDE68A),
                        Color.White,
                        Color(0xFFF59E0B),
                    ),
                ),
                radius = r * 0.90f,
                style = Stroke(width = 3.dp.toPx()),
            )
        }
        Surface(
            shape = CircleShape,
            color = BakeryColors.PrimaryDark.copy(alpha = 0.55f),
            border = BorderStroke(2.dp, Color.White.copy(alpha = 0.85f)),
            modifier = Modifier
                .size(size * 0.82f)
                .shadow(16.dp, CircleShape),
        ) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(
                        Brush.radialGradient(
                            colors = listOf(
                                BakeryColors.Primary,
                                BakeryColors.PrimaryDark,
                            ),
                        ),
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Image(
                    painter = painterResource(R.drawable.ic_launcher_foreground),
                    contentDescription = "شعار النظام",
                    modifier = Modifier.size(size * 0.72f),
                )
            }
        }
        Surface(
            shape = CircleShape,
            color = Color(0xFFFEF3C7),
            border = BorderStroke(1.5.dp, BakeryColors.PrimaryDark),
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(4.dp)
                .size(size * 0.25f),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    Icons.Default.CloudDone,
                    contentDescription = null,
                    tint = BakeryColors.PrimaryDark,
                    modifier = Modifier.size(size * 0.15f),
                )
            }
        }
    }
}

/**
 * شاشةُ الترحيب (Splash Screen) الاحترافيّة:
 * تعرضُ الشعار المؤسّسيّ، واسمَ النظام القادم من الخادم (`public/site`)،
 * وشارة الإصدار «نسخة المخابز والإنتاج».
 */
@Composable
fun SplashScreen(
    systemName: String,
    taglineAr: String = "",
) {
    var visible by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { visible = true }

    val scale by animateFloatAsState(
        targetValue = if (visible) 1f else 0.86f,
        animationSpec = tween(durationMillis = 650, easing = FastOutSlowInEasing),
        label = "splash-scale",
    )
    val alpha by animateFloatAsState(
        targetValue = if (visible) 1f else 0f,
        animationSpec = tween(durationMillis = 550),
        label = "splash-alpha",
    )
    val pulseTransition = rememberInfiniteTransition(label = "splash-pulse")
    val haloScale by pulseTransition.animateFloat(
        initialValue = 0.94f,
        targetValue = 1.08f,
        animationSpec = infiniteRepeatable(
            animation = tween(1600, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "halo-scale",
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    colors = listOf(
                        BakeryColors.Primary,
                        BakeryColors.PrimaryDark,
                        Color(0xFF3B1806),
                    ),
                ),
            ),
    ) {
        // دوائرُ إضاءةٍ هندسيّة ناعمة في الخلفيّة
        Canvas(Modifier.fillMaxSize()) {
            drawCircle(
                color = Color.White.copy(alpha = 0.06f),
                radius = size.minDimension * 0.62f * haloScale,
                center = Offset(size.width * 0.85f, size.height * 0.16f),
            )
            drawCircle(
                color = Color(0xFFFBBF24).copy(alpha = 0.08f),
                radius = size.minDimension * 0.52f,
                center = Offset(size.width * 0.12f, size.height * 0.84f),
            )
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 28.dp, vertical = 42.dp)
                .alpha(alpha),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Spacer(Modifier.height(12.dp))

            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.scale(scale),
            ) {
                BrandCrestLogo(size = 132.dp)

                Spacer(Modifier.height(24.dp))

                Text(
                    text = systemName.ifBlank { "سحاب المحاسبي" },
                    style = MaterialTheme.typography.headlineLarge.copy(
                        fontSize = 30.sp,
                        letterSpacing = 0.2.sp,
                    ),
                    fontWeight = FontWeight.ExtraBold,
                    color = Color.White,
                    textAlign = TextAlign.Center,
                )

                Spacer(Modifier.height(12.dp))

                Surface(
                    shape = RoundedCornerShape(50),
                    color = Color.White.copy(alpha = 0.15f),
                    border = BorderStroke(1.dp, Color(0xFFFDE68A).copy(alpha = 0.75f)),
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 18.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.Default.BakeryDining,
                            contentDescription = null,
                            tint = Color(0xFFFDE68A),
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            text = BAKERY_EDITION_LABEL,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFFFEF3C7),
                        )
                    }
                }

                Spacer(Modifier.height(14.dp))

                Text(
                    text = taglineAr.ifBlank {
                        "منظومةُ الإدارة المحاسبيّة المتكاملة للإنتاج والمستودعات والتوزيع ونقطة البيع"
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color.White.copy(alpha = 0.86f),
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(0.92f),
                )
            }

            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                CircularProgressIndicator(
                    color = Color(0xFFFDE68A),
                    strokeWidth = 2.8.dp,
                    modifier = Modifier.size(28.dp),
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    text = "جارٍ تهيئةُ الاتصال السحابيّ الآمن…",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color.White.copy(alpha = 0.78f),
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    text = "الإصدار ${BuildConfig.VERSION_NAME}",
                    style = MaterialTheme.typography.labelSmall,
                    color = Color.White.copy(alpha = 0.55f),
                )
            }
        }
    }
}
