@file:OptIn(ExperimentalMaterial3Api::class)

package com.erpcloud.bakery.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Password
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.erpcloud.bakery.data.ActionResult
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.ActionButton
import com.erpcloud.bakery.ui.components.SectionCard

/**
 * تغييرُ كلمة المرور — `POST /auth/change-password` بجسم {current, new} حرفيًّا.
 * سياسةُ الخادم (password-policy.ts) مطبَّقةٌ هنا إرشادًا قبل الإرسال:
 * ‏١٢+ محرفًا، ٣ فئاتٍ من (صغير/كبير/رقم/رمز)، ولا تحتوي البريدَ أو الاسم.
 * النجاحُ 204 **ويُبطل كلَّ الجلسات** — فالتطبيقُ يعود إلى شاشة الدخول تلقائيًّا.
 */
@Composable
fun ChangePasswordScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val email = state.me?.user?.email ?: ""

    var current by rememberSaveable { mutableStateOf("") }
    var new by rememberSaveable { mutableStateOf("") }
    var confirm by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var localError by remember { mutableStateOf<String?>(null) }
    var done by remember { mutableStateOf(false) }

    // سياسةُ الخادم نفسُها — إرشادٌ حيٌّ لا تحققٌ نهائيّ (الخادمُ يحسم).
    val checks = remember(new, email) { passwordChecks(new, email) }
    val allPass = checks.all { it.ok } && new == confirm && current.isNotBlank()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("تغييرُ كلمة المرور") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SectionCard(
                title = "كلمةُ مرور جديدة",
                subtitle = "تُطبَّق سياسةُ المنشأة: ١٢ محرفًا فأكثر تجمعُ ٣ فئاتٍ من الحروف، ولا تحتوي بريدك أو اسمك.",
            ) {
                if (state.mustChangePassword) {
                    Text(
                        "الخادمُ يطلبُ منك تغييرَ كلمة المرور قبل المتابعة (mustChangePassword).",
                        color = MaterialTheme.colorScheme.tertiary,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                OutlinedTextField(
                    value = current,
                    onValueChange = { current = it },
                    label = { Text("كلمةُ المرور الحاليّة *") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = new,
                    onValueChange = { new = it },
                    label = { Text("كلمةُ المرور الجديدة *") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = confirm,
                    onValueChange = { confirm = it },
                    label = { Text("تأكيدُ كلمة المرور *") },
                    isError = confirm.isNotBlank() && confirm != new,
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth(),
                )

                Spacer4()
                checks.forEach { check ->
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 2.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Icon(
                            if (check.ok) Icons.Default.Check else Icons.Default.Close,
                            contentDescription = null,
                            tint = if (check.ok) {
                                MaterialTheme.colorScheme.tertiary
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                            modifier = Modifier.size(18.dp),
                        )
                        Text(
                            check.label,
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (check.ok) {
                                MaterialTheme.colorScheme.tertiary
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                        )
                    }
                }
            }

            SectionCard(title = "ماذا يحدث بعد التغيير؟") {
                Text(
                    "يُبطل الخادمُ **كلَّ جلساتك** على كلّ الأجهزة (سياسةُ أمانٍ عند تغيير كلمة المرور)، " +
                        "فتُسجَّل خروجًا هنا تلقائيًّا وتعيد الدخول بكلمتك الجديدة. " +
                        "إن كانت بياناتُك محفوظةً في هذا الجهاز فتُحدَّث كلمتُها أيضًا.",
                    style = MaterialTheme.typography.bodyMedium,
                )
            }

            if (localError != null) {
                Text(localError ?: "", color = MaterialTheme.colorScheme.error)
            }
            if (done) {
                Text(
                    "غُيّرت كلمةُ المرور — عُد إلى شاشة الدخول وسجّل الدخول بكلمتك الجديدة.",
                    color = MaterialTheme.colorScheme.tertiary,
                )
            }

            ActionButton(
                label = "تغييرُ كلمة المرور",
                icon = Icons.Default.Password,
                loading = busy,
                enabled = allPass && !done,
                modifier = Modifier.fillMaxWidth(),
                onClick = {
                    busy = true
                    localError = null
                    vm.changePassword(current, new) { result: ActionResult ->
                        busy = false
                        when (result) {
                            is ActionResult.Synced -> done = true
                            is ActionResult.Refused -> localError = result.messageAr
                            is ActionResult.Offline -> localError = result.messageAr
                        }
                    }
                },
            )
        }
    }
}

private data class PasswordCheck(val label: String, val ok: Boolean)

/** سياسةُ password-policy.ts في الخادم — ١٢+ محرفًا، ٣ فئات، لا بريد ولا اسم. */
private fun passwordChecks(new: String, email: String): List<PasswordCheck> {
    val classes = listOf(
        new.any { it.isLowerCase() },
        new.any { it.isUpperCase() },
        new.any { it.isDigit() },
        new.any { !it.isLetterOrDigit() },
    ).count { it }
    val emailToken = email.substringBefore('@').lowercase().takeIf { it.length >= 4 }
    return listOf(
        PasswordCheck("١٢ محرفًا فأكثر", new.length >= 12),
        PasswordCheck("٣ فئاتٍ من: حروفٌ صغيرة، كبيرة، أرقام، رموز", classes >= 3),
        PasswordCheck("لا تحتوي بريدك", emailToken == null || !new.lowercase().contains(emailToken)),
        PasswordCheck("٢٠٠ محرفًا فأقلّ", new.length <= 200),
    )
}

@Composable
private fun Spacer4() {
    androidx.compose.foundation.layout.Spacer(Modifier.padding(top = 4.dp))
}
