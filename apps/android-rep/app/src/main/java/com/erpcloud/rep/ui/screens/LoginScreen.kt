@file:OptIn(ExperimentalMaterial3Api::class)

package com.erpcloud.rep.ui.screens

import android.os.Build
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
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
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.erpcloud.rep.BuildConfig
import com.erpcloud.rep.R
import com.erpcloud.rep.ui.AppViewModel
import com.erpcloud.rep.ui.components.ActionButton
import com.erpcloud.rep.ui.components.ChipTone
import com.erpcloud.rep.ui.components.InfoCallout
import com.erpcloud.rep.ui.components.SectionCard
import com.erpcloud.rep.ui.theme.RepColors
import kotlinx.coroutines.launch

/**
 * شاشةُ الدخول — عنوانُ الخادم (قابلٌ للتغيير) + البريد + كلمة المرور + رمز المنشأة +
 * رمز التحقّق. «تذكّرني» يحفظ البيانات **مشفَّرةً في Android Keystore**، و«الدخول
 * بالبصمة/النمط» يفتح الجلسةَ بعد نجاح المصادقةِ البيومتريّةِ أو نمطِ الهاتف.
 */
@Composable
fun LoginScreen(vm: AppViewModel) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val saved = vm.savedCredentials
    var email by rememberSaveable { mutableStateOf(saved?.email ?: "") }
    var password by rememberSaveable { mutableStateOf(saved?.password ?: "") }
    var tenantCode by rememberSaveable { mutableStateOf(saved?.tenantCode ?: "") }
    var mfaCode by rememberSaveable { mutableStateOf("") }
    var rememberMe by rememberSaveable { mutableStateOf(true) }
    var useBiometric by rememberSaveable { mutableStateOf(vm.biometricEnabled) }
    var showPassword by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var biometricBusy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var showForgotDialog by remember { mutableStateOf(false) }
    var forgotMessage by remember { mutableStateOf<String?>(null) }

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
            error = vm.login(state.session.serverUrl, emailArg.trim(), passwordArg, tenantArg.trim(), mfaCode)
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
            .setSubtitle("استخدم بصمتك أو نمط الهاتف لفتح حساب المندوب")
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
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        brush = Brush.verticalGradient(listOf(RepColors.Primary, RepColors.PrimaryDark)),
                        shape = RoundedCornerShape(bottomStart = 28.dp, bottomEnd = 28.dp),
                    )
                    .padding(horizontal = 20.dp, vertical = 26.dp),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    BrandCrestLogo(size = 108.dp)
                    Spacer(Modifier.height(12.dp))
                    Text(
                        state.session.brandName.ifBlank { "سحاب المحاسبي" },
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.ExtraBold,
                        color = Color.White,
                    )
                    Spacer(Modifier.height(6.dp))
                    Surface(
                        shape = RoundedCornerShape(50),
                        color = Color.White.copy(alpha = 0.16f),
                        border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFFDE68A).copy(alpha = 0.7f)),
                    ) {
                        Text(
                            REP_EDITION_LABEL,
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFFFEF3C7),
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 5.dp),
                        )
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(
                        state.session.brandTagline.ifBlank { "البيع الميدانيّ · تحصيل الذمم · جرد العهدة" },
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color.White.copy(alpha = 0.88f),
                    )
                }
            }

            Column(
                Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {

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
                Spacer(Modifier.height(6.dp))
                Text(
                    "أو سجّل الدخول يدويًّا:",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(6.dp))
            }

            SectionCard(title = "تسجيلُ الدخول إلى حسابك") {
                Column(Modifier.padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(
                        value = email,
                        onValueChange = { email = it },
                        label = { Text("البريدُ الإلكترونيّ") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        label = { Text("كلمةُ المرور") },
                        singleLine = true,
                        visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                        trailingIcon = {
                            IconButton(onClick = { showPassword = !showPassword }) {
                                Icon(
                                    if (showPassword) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                                    contentDescription = if (showPassword) "إخفاء كلمة المرور" else "إظهار كلمة المرور",
                                )
                            }
                        },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = tenantCode,
                        onValueChange = { tenantCode = it },
                        label = { Text("رمزُ المنشأة") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = mfaCode,
                        onValueChange = { mfaCode = it },
                        label = { Text("رمزُ التحقّق الثنائيّ (اختياري)") },
                        singleLine = true,
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
                Spacer(Modifier.height(8.dp))
                InfoCallout(error ?: "", ChipTone.DANGER)
            }

            Spacer(Modifier.height(14.dp))
            ActionButton(
                label = "دخول",
                icon = Icons.AutoMirrored.Filled.Login,
                loading = busy,
                enabled = email.isNotBlank() && password.isNotBlank() && tenantCode.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
                onClick = { doLogin(email, password, tenantCode) },
            )

            TextButton(onClick = { forgotMessage = null; showForgotDialog = true }) {
                Text("نسيتُ كلمة المرور؟")
            }

            Spacer(Modifier.height(12.dp))
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        "الدخولُ بحساب مندوبٍ ربطه المحاسبُ ببطاقة توزيع.",
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

    if (showForgotDialog) {
        var resetBusy by remember { mutableStateOf(false) }
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { if (!resetBusy) showForgotDialog = false },
            title = { Text("استعادةُ كلمة المرور") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "أدخل بريدك الإلكتروني ورمز المنشأة لإرسال رابط إعادة التعيين.",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    OutlinedTextField(
                        value = email,
                        onValueChange = { email = it },
                        label = { Text("البريد الإلكترونيّ") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = tenantCode,
                        onValueChange = { tenantCode = it },
                        label = { Text("رمزُ المنشأة") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (forgotMessage != null) {
                        Text(forgotMessage ?: "", style = MaterialTheme.typography.bodyMedium)
                    }
                }
            },
            confirmButton = {
                TextButton(
                    enabled = !resetBusy && email.isNotBlank() && tenantCode.isNotBlank(),
                    onClick = {
                        resetBusy = true
                        forgotMessage = null
                        vm.forgotPassword(state.session.serverUrl, email.trim(), tenantCode.trim()) { res ->
                            resetBusy = false
                            forgotMessage = when (res) {
                                is com.erpcloud.rep.data.ActionResult.Synced ->
                                    "تم إرسال طلب استعادة كلمة المرور إن كان الحساب مسجّلًا — راجع بريدك أو تواصل مع المحاسب."
                                is com.erpcloud.rep.data.ActionResult.Refused -> res.messageAr
                                is com.erpcloud.rep.data.ActionResult.Blocked -> res.reasonsAr.joinToString(" · ")
                                is com.erpcloud.rep.data.ActionResult.StoredOffline -> res.messageAr
                            }
                        }
                    },
                ) {
                    Text(if (resetBusy) "جارٍ الإرسال…" else "إرسال الطلب")
                }
            },
            dismissButton = {
                TextButton(enabled = !resetBusy, onClick = { showForgotDialog = false }) {
                    Text("إغلاق")
                }
            },
        )
    }
}
