package com.erpcloud.bakery.ui.screens

import androidx.activity.compose.BackHandler
import com.erpcloud.bakery.ui.components.rememberPickerInteractionSource

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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import com.erpcloud.bakery.data.api.RoleDto
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.ActionButton
import com.erpcloud.bakery.ui.components.PickerTrigger
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.MissingPermissionHint
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.EmptyState
import com.erpcloud.bakery.ui.components.KeyValue
import com.erpcloud.bakery.ui.components.MultiPickerDialog
import com.erpcloud.bakery.ui.components.PickerItem
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.components.StatusChip
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * شاشةُ الأدوار والصلاحيات — إنشاءُ دورٍ وتعديلُ أذوناته:
 * `POST /roles` و`POST /roles/{id}/permissions` بإذن `tenant.role.manage`.
 * أسماءُ الأذونات بالعربية من [Labels.permission] — لا أكوادَ خادمٍ في الواجهة.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RolesScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var showCreate by remember { mutableStateOf(false) }
    var editTarget by remember { mutableStateOf<RoleDto?>(null) }

    LaunchedEffect(Unit) { vm.loadRoles() }

    val inSubView = showCreate || editTarget != null
    BackHandler(enabled = inSubView) {
        if (showCreate) showCreate = false else editTarget = null
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        when {
                            showCreate -> "دور جديد"
                            editTarget != null -> "صلاحيات الدور"
                            else -> "الأدوار والصلاحيات"
                        },
                    )
                },
                navigationIcon = {
                    IconButton(
                        onClick = {
                            if (showCreate) showCreate = false
                            else if (editTarget != null) editTarget = null
                            else onBack()
                        },
                    ) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
        floatingActionButton = {
            if (!showCreate && editTarget == null && state.can("tenant.role.manage")) {
                FloatingActionButton(onClick = { showCreate = true }) {
                    Icon(Icons.Default.Add, contentDescription = "دور جديد")
                }
            }
        },
    ) { padding ->
        if (showCreate) {
            androidx.compose.foundation.layout.Box(Modifier.fillMaxSize().padding(padding)) {
                RoleForm(vm, onDone = { showCreate = false })
            }
            return@Scaffold
        }
        val currentEdit = editTarget
        if (currentEdit != null) {
            androidx.compose.foundation.layout.Box(Modifier.fillMaxSize().padding(padding)) {
                RolePermissionsEditor(
                    vm = vm,
                    role = currentEdit,
                    onDone = { editTarget = null },
                )
            }
            return@Scaffold
        }
        if (state.staff.loadingKey == "roles") {
            CenterLoading("جارٍ تحميل الأدوار…", Modifier.padding(padding))
            return@Scaffold
        }
        val roles = state.staff.roles
        Column(Modifier.fillMaxSize().padding(padding)) {
            if (!state.can("tenant.role.manage")) {
                MissingPermissionHint(
                    "إنشاء دور",
                    "tenant.role.manage",
                    Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                )
            }
            if (roles.isEmpty()) {
                EmptyState(state.staff.error ?: "لا أدوارٍ بعد.")
                return@Column
            }
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
            items(roles, key = { it.id }) { role ->
                SectionCard(
                    title = role.name,
                    subtitle = role.description ?: "",
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (role.isSystem) StatusChip("دورٌ نظاميّ", ChipTone.INFO)
                        StatusChip("${role.permissionCodes.size} صلاحيّةً", ChipTone.NEUTRAL)
                    }
                    Spacer(Modifier.height(6.dp))
                    if (role.permissionCodes.isNotEmpty()) {
                        // أسماءٌ عربيّةٌ مقروءة — والزائدُ يُلخَّص بعدًّا.
                        val arabic = role.permissionCodes.map { Labels.permission(it) }
                        Text(
                            arabic.take(8).joinToString(" · ") +
                                if (arabic.size > 8) " … (+${arabic.size - 8})" else "",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else {
                        Text(
                            "بلا صلاحياتٍ بعد",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    // سياسةُ الخادمِ والويبِ نفسُها (AUD-02): دورُ «Owner» محميٌّ دائمًا
                    // حمايةً للحساب؛ وسائرُ الأدوارِ النظاميّةِ (المحاسب/الكاشير…) يعدّلُها
                    // **مالكُ الحسابِ نفسُه** — فلا يُحجَرُ عليه التخصيصُ كما كان قبلًا،
                    // بينما يُرفضُ غيرُ المالكِ من الخادمِ برمزٍ عربيٍّ واضح.
                    val isOwnerAccount = state.me?.membership?.isOwner == true
                    val isOwnerRole = role.name.trim().equals("owner", ignoreCase = true)
                    val canEditPermissions = state.can("tenant.role.manage") &&
                        !isOwnerRole &&
                        (!role.isSystem || isOwnerAccount)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(
                            onClick = { editTarget = role },
                            enabled = canEditPermissions,
                        ) { Text("تعديلُ الصلاحيات") }
                    }
                    if (isOwnerRole) {
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "دورُ مالكِ الحسابِ يمتلكُ كلَّ الصلاحياتِ تلقائيًّا ولا يُعدَّلُ حمايةً للحساب — أنشئ دورًا مخصّصًا لما دونه.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else if (role.isSystem && !isOwnerAccount) {
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "تعديلُ الأدوارِ النظاميّةِ متاحٌ لمالكِ الحسابِ فقط. يمكنكَ إنشاءُ أدوارٍ مخصّصةٍ وتعديلُها.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            }
        }
    }
}

/**
 * محرِّرُ صلاحيات دور — قائمةُ الخادم كاملةً بأسماءٍ عربيّةٍ مصنَّفةً بالوحدات،
 * والاختيارُ الحاليّ مُسبقًا من الدور، والحفظُ يستبدلُ الطقمَ كاملًا
 * (‏`POST /roles/{id}/permissions` — عقدُ rolePermissionsSchema الصارم).
 */
@Composable
private fun RolePermissionsEditor(vm: AppViewModel, role: RoleDto, onDone: () -> Unit) {
    val state by vm.uiState.collectAsState()
    val codes = remember(role.id) { mutableStateListOf<String>().apply { addAll(role.permissionCodes) } }
    var pickPermissions by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }

    if (confirm) {
        AlertDialog(
            onDismissRequest = { if (!sending) confirm = false },
            title = { Text("حفظُ صلاحيات «${role.name}»") },
            text = { Text("سيُستبدل طقمُ الصلاحيات الحاليّ بـ${codes.size} صلاحيّةً. هل تحفظ؟") },
            confirmButton = {
                TextButton(
                    onClick = {
                        sending = true
                        val body = buildJsonObject {
                            put(
                                "permissionCodes",
                                buildJsonArray { codes.forEach { add(JsonPrimitive(it)) } },
                            )
                        }
                        vm.updateRolePermissions(role.id, body) { result ->
                            sending = false
                            if (result is ActionResult.Synced) {
                                confirm = false
                                vm.loadRoles()
                                onDone()
                            }
                        }
                    },
                    enabled = !sending,
                ) { Text(if (sending) "جارٍ الحفظ…" else "حفظ") }
            },
            dismissButton = {
                TextButton(onClick = { if (!sending) confirm = false }, enabled = !sending) { Text("رجوع") }
            },
        )
    }

    LazyColumn(
        Modifier.fillMaxSize().padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            SectionCard(
                title = "صلاحياتُ «${role.name}»",
                subtitle = "مُختار: ${codes.size} صلاحيّةً — تُصنَّفُ بالوحدات",
            ) {
                OutlinedTextField(
                    value = if (codes.isEmpty()) "" else "مُختار: ${codes.size} صلاحيّةً",
                    onValueChange = {},
                    readOnly = true,
                    interactionSource = rememberPickerInteractionSource { pickPermissions = true },
                    label = { Text("الصلاحيات") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { PickerTrigger(onClick = { pickPermissions = true }) },
                )
                Spacer(Modifier.height(8.dp))
                KeyValue("الدور", role.name)
                KeyValue("عددُ الصلاحيات", codes.size.toString())
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ActionButton(
                        label = if (sending) "جارٍ الحفظ…" else "حفظُ الصلاحيات",
                        onClick = { confirm = true },
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
            title = "كلُّ الصلاحيات",
            items = state.staff.permissions
                .sortedWith(compareBy({ Labels.permissionModule(it.code) }, { Labels.permission(it.code) }))
                .map { permission ->
                    PickerItem(
                        permission.code,
                        Labels.permission(permission.code),
                        subtitle = "${Labels.permissionModule(permission.code)} · ${permission.code}",
                    )
                },
            selectedIds = codes.toSet(),
            onToggle = { code -> if (codes.contains(code)) codes.remove(code) else codes.add(code) },
            onDismiss = { pickPermissions = false },
        )
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
            SectionCard(title = "دورٌ جديد", subtitle = "الأذوناتُ من فهرس الخادم — بأسمائها العربية") {
                OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("اسمُ الدور *") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = description, onValueChange = { description = it }, label = { Text("الوصف") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = if (codes.isEmpty()) "" else "مُختار: ${codes.size} صلاحيّةً",
                    onValueChange = {},
                    readOnly = true,
                    interactionSource = rememberPickerInteractionSource { pickPermissions = true },
                    label = { Text("الأذونات") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { PickerTrigger(onClick = { pickPermissions = true }) },
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
                                    buildJsonArray { codes.forEach { add(JsonPrimitive(it)) } },
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
            title = "كلُّ الصلاحيات",
            items = state.staff.permissions
                .sortedWith(compareBy({ Labels.permissionModule(it.code) }, { Labels.permission(it.code) }))
                .map { permission ->
                    PickerItem(
                        permission.code,
                        Labels.permission(permission.code),
                        subtitle = "${Labels.permissionModule(permission.code)} · ${permission.code}",
                    )
                },
            selectedIds = codes.toSet(),
            onToggle = { code -> if (codes.contains(code)) codes.remove(code) else codes.add(code) },
            onDismiss = { pickPermissions = false },
        )
    }
}
