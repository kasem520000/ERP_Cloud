package com.erpcloud.bakery.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.data.ActionResult
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.ActionButton
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.EmptyState
import com.erpcloud.bakery.ui.components.KeyValue
import com.erpcloud.bakery.ui.components.MultiPickerDialog
import com.erpcloud.bakery.ui.components.PickerDialog
import com.erpcloud.bakery.ui.components.PickerItem
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.components.StatusChip
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * شاشةُ الأدوار والصلاحيّات (من تطبيق الطاقم) — `GET /iam/roles` /
 * `GET /iam/permissions` / `POST /iam/roles` بإذن `iam.role.manage`:
 * الأدوارُ الحاليّة + إنشاءُ دورٍ جديدٍ باختيارِ أذوناتٍ من الفهرس الرسميّ.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RolesScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var showCreate by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { vm.loadRoles() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("الأدوار والصلاحيّات") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
        floatingActionButton = {
            if (!showCreate && state.can("iam.role.manage")) {
                FloatingActionButton(onClick = { showCreate = true }) {
                    Icon(Icons.Default.Add, contentDescription = "دور جديد")
                }
            }
        },
    ) { padding ->
        if (showCreate) {
            RoleForm(vm, onDone = { showCreate = false })
            return@Scaffold
        }
        if (state.staff.loadingKey == "roles") {
            CenterLoading("جارٍ تحميل الأدوار…", Modifier.padding(padding))
            return@Scaffold
        }
        val roles = state.staff.roles
        if (roles.isEmpty()) {
            EmptyState(state.staff.error ?: "لا أدوارٍ بعد.", Modifier.padding(padding))
            return@Scaffold
        }
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(roles, key = { it.id }) { role ->
                SectionCard(
                    title = role.name,
                    subtitle = role.description ?: "",
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (role.isSystem) StatusChip("دورٌ نظاميّ — لا يُعدَّل", ChipTone.INFO)
                    }
                    Spacer(Modifier.height(6.dp))
                    KeyValue("عددُ الأذونات", role.permissionCodes.size.toString())
                    if (role.permissionCodes.isNotEmpty()) {
                        Text(
                            role.permissionCodes.take(12).joinToString(" · ") +
                                if (role.permissionCodes.size > 12) " … (+${role.permissionCodes.size - 12})" else "",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

/** إنشاءُ دور — name إلزاميّ + أذوناتٌ من فهرس الخادم (`permissionCodes`). */
@Composable
private fun RoleForm(vm: AppViewModel, onDone: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var name by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var pickPermissions by remember { mutableStateOf(false) }
    val codes = remember { mutableStateListOf<String>() }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    LazyColumn(
        Modifier.fillMaxSize().padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            SectionCard(title = "دورٌ جديد", subtitle = "الأذوناتُ من فهرس الخادم — لا تُخترع") {
                OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("اسمُ الدور *") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = description, onValueChange = { description = it }, label = { Text("الوصف") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = if (codes.isEmpty()) "" else "مُختار: ${codes.size} إذنًا",
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("الأذونات") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { IconButton(onClick = { pickPermissions = true }) { Text("اختر") } },
                )
                if (error != null) {
                    Spacer(Modifier.height(8.dp))
                    StatusChip(error ?: "", ChipTone.DANGER)
                }
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ActionButton(
                        label = if (sending) "جارٍ الحفظ…" else "حفظُ الدور",
                        onClick = {
                            error = when {
                                name.isBlank() -> "اسمُ الدور إلزاميّ."
                                else -> null
                            }
                            if (error != null) return@ActionButton
                            sending = true
                            val body = buildJsonObject {
                                put("name", name.trim())
                                if (description.isNotBlank()) put("description", description.trim())
                                put(
                                    "permissionCodes",
                                    buildJsonArray { codes.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) } },
                                )
                            }
                            vm.createRole(body) { result ->
                                sending = false
                                if (result is ActionResult.Synced) {
                                    vm.loadRoles()
                                    onDone()
                                }
                            }
                        },
                        enabled = !sending,
                        loading = sending,
                        modifier = Modifier.weight(1f),
                    )
                    ActionButton(label = "رجوع", onClick = onDone, enabled = !sending, modifier = Modifier.weight(1f))
                }
            }
        }
    }

    if (pickPermissions) {
        MultiPickerDialog(
            title = "فهرسُ الأذونات",
            items = state.staff.permissions.map { permission ->
                PickerItem(
                    permission.code,
                    permission.code,
                    subtitle = permission.description ?: permission.module,
                )
            },
            selectedIds = codes.toSet(),
            onToggle = { code -> if (codes.contains(code)) codes.remove(code) else codes.add(code) },
            onDismiss = { pickPermissions = false },
        )
    }
}
