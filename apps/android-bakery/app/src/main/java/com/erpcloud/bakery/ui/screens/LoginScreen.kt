@file:OptIn(ExperimentalMaterial3Api::class)

package com.erpcloud.bakery.ui.screens

import android.os.Build
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Login
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.erpcloud.bakery.BuildConfig
import com.erpcloud.bakery.R
import com.erpcloud.bakery.data.ActionResult
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.ActionButton
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.theme.BakeryColors
import com.erpcloud.bakery.ui.theme.ShapeField
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * شاشةُ الدخول — عنوانُ الخادم (قابلٌ للتغيير) + البريد + كلمة المرور + رمز المنشأة +
 * رمز التحقّق. «تذكّرني» يحفظ البيانات **مشفَّرةً في Android Keystore**، و«الدخول
 * بالبصمة/النمط» يفتح الجلسةَ بعد نجاح المصادقةِ البيومتريّةِ أو نمطِ الهاتف.
 *
 * الطبقةُ البصريّة (كما الموك-أب `01-login.html`): ترويسةٌ كهرمانيّةٌ متدرّجةٌ
 * (Primary → PrimaryDark) بزوايا ٢٦ سفليّةٍ تحملُ شعارًا دائريًّا كبيرًا، ثمّ
 * بطاقةٌ بيضاءُ واحدةٌ (٢٦) لكلّ الحقول، وزرُّ دخولٍ مملوءٌ بعرضٍ كاملٍ (٥٢dp).
 */
@Composable
fun LoginScreen(vm: AppViewModel) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val saved = vm.savedCredentials
    var server by rememberSaveable { mutableStateOf(state.session.serverUrl) }
    var email by rememberSaveable { mutableStateOf(saved?.email ?: "") }
    var password by rememberSaveable { mutableStateOf(saved?.password ?: "") }
    var tenantCode by rememberSaveable { mutableStateOf(saved?.tenantCode ?: "") }
    var mfaCode by rememberSaveable { mutableStateOf("") }
    var rememberMe by rememberSaveable { mutableStateOf(true) }
    var useBiometric by rememberSaveable { mutableStateOf(vm.biometricEnabled) }
    var busy by remember { mutableStateOf(false) }
    var biometricBusy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var showForgot by remember { mutableStateOf(false) }

    // البصمةُ أو نمطُ الهاتف: على ١١+ معًا؛ وما قبلها بصمةٌ فقط (قيدُ المكتبة).
    val authenticators = if (Build.VERSION.SDK_INT >= 30) {
        BiometricManager.Authenticators.BIOMETRIC_WEAK or
            BiometricManager.Authenticators.DEVICE_CREDENTIAL
    } else {
        BiometricManager.Authenticators.BIOMETRIC_WEAK
    }
    val biometricAvailable = remember {
        try {
            BiometricManager.from(context).canAuthenticate(authenticators) ==
                BiometricManager.BIOMETRIC_SUCCESS
        } catch (_: Exception) {
            false
        }
    }

    fun doLogin(emailArg: String, passwordArg: String, tenantArg: String) {
        scope.launch {
            busy = true
            error = null
            error = vm.login(server.trim(), emailArg.trim(), passwordArg, tenantArg.trim(), mfaCode)
            if (error == null) {
                // نجح الدخول: حفظُ البيانات أو نسيانُها + خيارُ البصمة.
                vm.rememberCredentials(emailArg.trim(), tenantArg.trim(), passwordArg, rememberMe)
                vm.biometricEnabled = rememberMe && useBiometric && biometricAvailable
            }
            busy = false
        }
    }

    fun showBiometricPrompt() {
        val activity = context as? FragmentActivity ?: return
        val executor = ContextCompat.getMainExecutor(activity)
        val prompt = BiometricPrompt(
            activity,
            executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    scope.launch {
                        biometricBusy = true
                        error = vm.loginSaved()
                        biometricBusy = false
                    }
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    biometricBusy = false
                    // خطأُ المستخدم (إلغاءٌ مثلًا) ليس خطأً — يعود للنموذج اليدويّ.
                }
            },
        )
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle("الدخول إلى حسابك")
            .setSubtitle("استخدم بصمتك أو نمط الهاتف لفتح حساب الإدارة")
            .setAllowedAuthenticators(authenticators)
            .apply {
                if (authenticators and BiometricManager.Authenticators.DEVICE_CREDENTIAL == 0) {
                    setNegativeButtonText("استخدام كلمة المرور")
                }
            }
            .build()
        try {
            prompt.authenticate(info)
        } catch (_: Exception) {
            // النشاطُ لم يستأنف بعد (نداءٌ مبكرٌ جدًّا) — الزرُّ اليدويّ بديلٌ دائمًا.
        }
    }

    // حسابٌ محفوظٌ والبصمةُ مفعَّلة؟ اعرض المصادقةَ فورَ فتح التطبيق.
    LaunchedEffect(Unit) {
        if (saved != null && vm.biometricEnabled && biometricAvailable) {
            showBiometricPrompt()
        }
    }

    Scaffold { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // ———————————————————————————————— الترويسةُ الكهرمانيّة المتدرّجة
            // بطاقةُ الهويّةِ أعلى الشاشة: تدرّجٌ من Primary إلى PrimaryDark بزوايا
            // ٢٦ سفليّة، وداخلها الشعارُ الدائريُّ الكبيرُ بحدٍّ أبيضَ يفصلُه عن التدرّج.
            Box(
                Modifier
                    .fillMaxWidth()
                    .background(
                        Brush.verticalGradient(
                            listOf(BakeryColors.Primary, BakeryColors.PrimaryDark),
                        ),
                        RoundedCornerShape(bottomStart = 26.dp, bottomEnd = 26.dp),
                    ),
            ) {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .padding(start = 20.dp, end = 20.dp, top = 30.dp, bottom = 26.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Surface(
                        shape = CircleShape,
                        color = BakeryColors.Primary,
                        border = BorderStroke(3.dp, Color.White),
                        modifier = Modifier.shadow(
                            elevation = 10.dp,
                            shape = CircleShape,
                            ambientColor = BakeryColors.PrimaryDark.copy(alpha = 0.30f),
                            spotColor = BakeryColors.PrimaryDark.copy(alpha = 0.38f),
                        ),
                    ) {
                        Box(Modifier.size(112.dp), contentAlignment = Alignment.Center) {
                            Image(
                                painter = painterResource(R.drawable.ic_launcher_foreground),
                                contentDescription = "شعار التطبيق",
                                modifier = Modifier.size(82.dp),
                            )
                        }
                    }
                    Spacer(Modifier.height(14.dp))
                    Text(
                        "إدارة المخابز",
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.ExtraBold,
                        color = Color.White,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "تطبيقُ مناديب التوزيع — البيعُ والتحصيلُ والعهدة",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color.White.copy(alpha = 0.92f),
                        textAlign = TextAlign.Center,
                    )
                }
            }

            // ———————————————————————————————— نموذجُ الدخول
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Spacer(Modifier.height(20.dp))

                // الدخولُ السريع بالبصمة/النمط — للحساب المحفوظ
                if (saved != null && biometricAvailable) {
                    SectionCard(title = "أهلًا بعودتك، ${saved.email.substringBefore('@')}") {
                        ActionButton(
                            label = if (biometricBusy) "جارٍ فتح الجلسة…" else "الدخول بالبصمة / نمط الهاتف",
                            icon = Icons.Default.Fingerprint,
                            loading = biometricBusy,
                            modifier = Modifier.fillMaxWidth(),
                            onClick = { showBiometricPrompt() },
                        )
                        if (Build.VERSION.SDK_INT < 30) {
                            Text(
                                "على هذا الإصدار من أندرويد يدعمُ التطبيقُ البصمةَ فقط (النمطُ متاحٌ من أندرويد ١١).",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Spacer(Modifier.height(6.dp))
                        TextButton(onClick = { vm.forgetSavedAccount() }) { Text("نسيانُ هذا الحساب والحفظ من جديد") }
                    }
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "أو سجّل الدخول يدويًّا:",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(10.dp))
                }

                // بطاقةٌ بيضاءُ واحدةٌ (٢٦) تحوي كلَّ الحقول — كما الموك-أب.
                SectionCard(title = "بياناتُ الخادم والحساب") {
                    Column(Modifier.padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedTextField(
                            value = server,
                            onValueChange = { server = it },
                            label = { Text("عنوانُ الخادم") },
                            supportingText = { Text("مثال: http://192.168.1.10:3000 — يُلحق به /api/v1 تلقائيًّا") },
                            singleLine = true,
                            shape = ShapeField,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        OutlinedTextField(
                            value = email,
                            onValueChange = { email = it },
                            label = { Text("البريدُ الإلكترونيّ") },
                            singleLine = true,
                            shape = ShapeField,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                            modifier = Modifier.fillMaxWidth(),
                        )
                        OutlinedTextField(
                            value = password,
                            onValueChange = { password = it },
                            label = { Text("كلمةُ المرور") },
                            singleLine = true,
                            shape = ShapeField,
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                            modifier = Modifier.fillMaxWidth(),
                        )
                        OutlinedTextField(
                            value = tenantCode,
                            onValueChange = { tenantCode = it },
                            label = { Text("رمزُ المنشأة") },
                            singleLine = true,
                            shape = ShapeField,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        OutlinedTextField(
                            value = mfaCode,
                            onValueChange = { mfaCode = it },
                            label = { Text("رمزُ التحقّق الثنائيّ (اختياري)") },
                            singleLine = true,
                            shape = ShapeField,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            modifier = Modifier.fillMaxWidth(),
                        )

                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text("تذكّرني", style = MaterialTheme.typography.bodyLarge)
                                Text(
                                    "حفظُ البريد ورمز المنشأة وكلمة المرور — مشفَّرةً في هذا الجهاز",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Switch(checked = rememberMe, onCheckedChange = { rememberMe = it })
                        }
                        if (rememberMe && biometricAvailable) {
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text("الدخولُ بالبصمة / نمط الهاتف", style = MaterialTheme.typography.bodyLarge)
                                    Text(
                                        "افتح الجلسةَ في المرّات القادمة ببصمتك أو نمط هاتفك",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                Switch(checked = useBiometric, onCheckedChange = { useBiometric = it })
                            }
                        }
                    }
                }

                if (error != null) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        error ?: "",
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }

                Spacer(Modifier.height(16.dp))
                ActionButton(
                    label = "دخول",
                    icon = Icons.AutoMirrored.Filled.Login,
                    loading = busy,
                    enabled = server.isNotBlank() && email.isNotBlank() && password.isNotBlank() && tenantCode.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                    onClick = { doLogin(email, password, tenantCode) },
                )

                Spacer(Modifier.height(6.dp))
                TextButton(onClick = { showForgot = true }) { Text("نسيت كلمة المرور؟") }

                Spacer(Modifier.height(28.dp))
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            "الدخولُ بحسابٍ إداريٍّ — تظهر لك الشاشاتُ بحسب صلاحياتك.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            "الإصدار ${BuildConfig.VERSION_NAME}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }

    if (showForgot) {
        ForgotPasswordDialog(
            vm = vm,
            initialEmail = email,
            initialTenantCode = tenantCode,
            onDismiss = { showForgot = false },
        )
    }
}


/** استعادةُ كلمة المرور — `POST /auth/forgot-password` (البريد + رمز المنشأة، بلا جلسة). */
@Composable
private fun ForgotPasswordDialog(
    vm: AppViewModel,
    initialEmail: String,
    initialTenantCode: String,
    onDismiss: () -> Unit,
) {
    var email by remember { mutableStateOf(initialEmail) }
    var tenantCode by remember { mutableStateOf(initialTenantCode) }
    var sending by remember { mutableStateOf(false) }
    var resultMessage by remember { mutableStateOf<String?>(null) }
    var resultSynced by remember { mutableStateOf(false) }

    // نجاحُ الطلب: تُعرضُ رسالةُ الخادم داخل النافذة ثمّ تُغلقُ بعد قليل.
    LaunchedEffect(resultSynced) {
        if (resultSynced) {
            delay(2600L)
            onDismiss()
        }
    }

    AlertDialog(
        onDismissRequest = { if (!sending) onDismiss() },
        title = {
            Text(
                "استعادةُ كلمة المرور",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.ExtraBold,
            )
        },
        text = {
            Column {
                Text(
                    "سيُرسل الخادمُ رابطَ إعادة التعيين إلى بريدك إن كان مسجّلًا.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("البريدُ الإلكترونيّ") },
                    singleLine = true,
                    shape = ShapeField,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = tenantCode,
                    onValueChange = { tenantCode = it },
                    label = { Text("رمزُ المنشأة") },
                    singleLine = true,
                    shape = ShapeField,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (resultMessage != null) {
                    Spacer(Modifier.height(10.dp))
                    Text(
                        resultMessage ?: "",
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (resultSynced) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.error,
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = !sending && email.isNotBlank() && tenantCode.isNotBlank(),
                onClick = {
                    sending = true
                    resultMessage = null
                    resultSynced = false
                    vm.forgotPassword(email.trim(), tenantCode.trim()) { result ->
                        sending = false
                        resultMessage = result.messageAr
                        resultSynced = result is ActionResult.Synced
                    }
                },
            ) { Text(if (sending) "جارٍ الإرسال…" else "إرسالُ الرابط") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !sending) { Text("إغلاق") }
        },
    )
}
