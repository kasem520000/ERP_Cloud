@file:OptIn(ExperimentalMaterial3Api::class)

package com.erpcloud.rep.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Login
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.erpcloud.rep.ui.AppViewModel
import com.erpcloud.rep.ui.components.ActionButton
import com.erpcloud.rep.ui.components.SectionCard
import kotlinx.coroutines.launch

/**
 * شاشةُ الدخول — الخادمُ (قابلٌ للتغيير دون إعادة البناء) + البريد + كلمة المرور +
 * رمز المنشأة + رمز التحقّق الاختياريّ.
 */
@Composable
fun LoginScreen(vm: AppViewModel) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()

    var server by rememberSaveable { mutableStateOf(state.session.serverUrl) }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var tenantCode by rememberSaveable { mutableStateOf("") }
    var mfaCode by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text("تسجيل الدخول — مندوب التوزيع") })
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SectionCard(title = "بياناتُ الخادم والحساب") {
                Column(Modifier.padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(
                        value = server,
                        onValueChange = { server = it },
                        label = { Text("عنوانُ الخادم") },
                        supportingText = { Text("مثال: http://192.168.1.10:3000 — يُلحق به /api/v1 تلقائيًّا") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
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
                        visualTransformation = PasswordVisualTransformation(),
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
                }
            }

            if (error != null) {
                Text(
                    error ?: "",
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }

            ActionButton(
                label = "دخول",
                icon = Icons.AutoMirrored.Filled.Login,
                loading = busy,
                enabled = server.isNotBlank() && email.isNotBlank() && password.isNotBlank() && tenantCode.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
                onClick = {
                    scope.launch {
                        busy = true
                        error = null
                        error = vm.login(server.trim(), email.trim(), password, tenantCode.trim(), mfaCode)
                        busy = false
                    }
                },
            )

            Spacer(Modifier.height(24.dp))
            Text(
                "الدخولُ إلى منشأتك من حساب المندوب الذي ربطه المحاسب — إن لم يكن حسابُك مرتبطًا " +
                    "ببطاقة مندوب فستظهر رسالةٌ تشرح ذلك بعد الدخول.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
