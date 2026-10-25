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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
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
import com.erpcloud.bakery.ui.components.PickerTrigger
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.MissingPermissionHint
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
 * شاشةُ المستخدمين — عضويّاتُ المنشأة ودعوةُ مستخدمٍ جديد:
 * `GET/POST /memberships` بإذن `tenant.membership.manage`
 * (email + fullName + roleIds≥1 + نطاقُ الفروع branchScope)，
 * وتفعيل/تعطيلُ عضويّةٍ عبر `PATCH /memberships/{id}`.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UsersScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var showInvite by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        vm.loadUsers()
        vm.ensureBranches()
    }

    BackHandler(enabled = showInvite) { showInvite = false }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (showInvite) "دعوة مستخدم جديد" else "المستخدمون والعضويّات") },
                navigationIcon = {
                    IconButton(onClick = { if (showInvite) showInvite = false else onBack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع")
                    }
                },
            )
        },
        floatingActionButton = {
            if (!showInvite && state.can("tenant.membership.manage")) {
                FloatingActionButton(onClick = { showInvite = true }) {
                    Icon(Icons.Default.Add, contentDescription = "دعوة مستخدم")
                }
            }
        },
    ) { padding ->
        if (showInvite) {
            androidx.compose.foundation.layout.Box(Modifier.fillMaxSize().padding(padding)) {
                InviteUserForm(vm, onDone = { showInvite = false })
            }
            return@Scaffold
        }
        if (state.staff.loadingKey == "users") {
            CenterLoading("جارٍ تحميل المستخدمين…", Modifier.padding(padding))
            return@Scaffold
        }
        val memberships = state.staff.memberships
        Column(Modifier.fillMaxSize().padding(padding)) {
            if (!state.can("tenant.membership.manage")) {
                MissingPermissionHint(
                    "إضافة مستخدم",
                    "tenant.membership.manage",
                    Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                )
            }
            if (memberships.isEmpty()) {
                EmptyState(state.staff.error ?: "لا مستخدمينَ بعد.")
                return@Column
            }
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
            items(memberships, key = { it.id }) { membership ->
                val (statusText, tone) = Labels.membershipStatus(membership.status)
                SectionCard(
                    title = membership.displayName,
                    subtitle = if (membership.isOwner) "المالك" else "",
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        StatusChip(statusText, tone)
                        when (membership.kind) {
                            "user" -> StatusChip("مستخدمُ دخول", ChipTone.NEUTRAL)
                            "staff" -> StatusChip("موظفُ إدارة", ChipTone.NEUTRAL)
                            "rep" -> StatusChip("مندوب ميدانيّ", ChipTone.INFO)
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                    if (membership.roles.isNotEmpty()) {
                        KeyValue("الأدوار", membership.roles.joinToString(" · ") { it.name })
                    }
                    // فصلُ الأدوار: المندوبُ الميدانيُّ موطنُ عملِه تطبيقُ المناديبُ
                    // المستقلُّ — هذا التطبيقُ لإدارةِ المنشأة، فلا يُخلَطُ الدوران.
                    if (membership.kind == "rep") {
                        KeyValue(
                            "تطبيقُ العمل",
                            "تطبيقُ المناديبِ المستقلّ — البيعُ والعهدةُ والتحصيلُ والإقفالُ هناك، وهذا التطبيقُ للإدارة.",
                        )
                    }
                    membership.branchScope?.let { scope ->
                        val names = scope.mapNotNull { id -> state.staff.branches.firstOrNull { it.id == id }?.nameAr }
                        KeyValue("نطاقُ الفروع", if (names.isEmpty()) "كلُّ الفروع" else names.joinToString(" · "))
                    } ?: KeyValue("نطاقُ الفروع", "كلُّ الفروع")
                    if (state.can("tenant.membership.manage") && !membership.isOwner) {
                        Spacer(Modifier.height(8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (membership.status == "suspended") {
                                OutlinedButton(onClick = {
                                    vm.updateMembership(
                                        membership.id,
                                        kotlinx.serialization.json.buildJsonObject { put("status", "active") },
                                    ) { if (it is ActionResult.Synced) vm.loadUsers() }
                                }) { Text("تفعيل") }
                            } else if (membership.status == "active") {
                                OutlinedButton(onClick = {
                                    vm.updateMembership(
                                        membership.id,
                                        kotlinx.serialization.json.buildJsonObject { put("status", "suspended") },
                                    ) { if (it is ActionResult.Synced) vm.loadUsers() }
                                }) { Text("تعطيل") }
                            }
                        }
                    }
                }
            }
            }
        }
    }
}

/** دعوةُ مستخدم — email إلزاميّ + دورٌ واحدٌ على الأقلّ (الخادمُ يرفض بلا أدوار). */
@Composable
private fun InviteUserForm(vm: AppViewModel, onDone: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var email by remember { mutableStateOf("") }
    var fullName by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("") }
    var allBranches by remember { mutableStateOf(true) }
    val branchScope = remember { mutableStateListOf<String>() }
    var pickRoles by remember { mutableStateOf(false) }
    var pickBranches by remember { mutableStateOf(false) }
    val roleIds = remember { mutableStateListOf<String>() }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    SectionCard(
        title = "دعوةُ مستخدمٍ جديد",
        subtitle = "البريدُ إلزاميٌّ ودورٌ واحدٌ على الأقلّ — والدعوةُ تُرسَل للبريد",
        modifier = Modifier.padding(14.dp),
    ) {
        OutlinedTextField(value = email, onValueChange = { email = it }, label = { Text("البريدُ الإلكترونيّ *") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = fullName, onValueChange = { fullName = it }, label = { Text("الاسمُ الكامل") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = displayName, onValueChange = { displayName = it }, label = { Text("اسمُ العرض") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = if (roleIds.isEmpty()) "" else "مُختار: ${roleIds.size} دورًا",
            onValueChange = {},
            readOnly = true,
            interactionSource = rememberPickerInteractionSource { pickRoles = true },
            label = { Text("الأدوار * (واحدٌ على الأقلّ)") },
            modifier = Modifier.fillMaxWidth(),
            trailingIcon = { PickerTrigger(onClick = { pickRoles = true }) },
        )
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            androidx.compose.material3.Checkbox(checked = allBranches, onCheckedChange = { allBranches = it; if (it) branchScope.clear() })
            Text("كلُّ الفروع (بلا حصر)")
        }
        if (!allBranches) {
            OutlinedTextField(
                value = if (branchScope.isEmpty()) "" else "مُختار: ${branchScope.size} فرعًا",
                onValueChange = {},
                readOnly = true,
                interactionSource = rememberPickerInteractionSource { pickBranches = true },
                label = { Text("نطاقُ الفروع *") },
                modifier = Modifier.fillMaxWidth(),
                trailingIcon = { PickerTrigger(onClick = { pickBranches = true }) },
            )
        }
        if (error != null) {
            Spacer(Modifier.height(8.dp))
            StatusChip(error ?: "", ChipTone.DANGER)
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ActionButton(
                label = if (sending) "جارٍ الإرسال…" else "إرسالُ الدعوة",
                onClick = {
                    error = when {
                        email.isBlank() || !email.contains("@") -> "أدخل بريدًا إلكترونيًّا صالحًا."
                        roleIds.isEmpty() -> "اختر دورًا واحدًا على الأقلّ — الخادمُ يرفضُ عضويّةً بلا أدوار."
                        !allBranches && branchScope.isEmpty() -> "اختر فرعًا واحدًا على الأقلّ أو دعِ النطاقَ مفتوحًا."
                        else -> null
                    }
                    if (error != null) return@ActionButton
                    sending = true
                    val body = buildJsonObject {
                        put("email", email.trim())
                        if (fullName.isNotBlank()) put("fullName", fullName.trim())
                        if (displayName.isNotBlank()) put("displayName", displayName.trim())
                        if (!allBranches) put(
                            "branchScope",
                            buildJsonArray { branchScope.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) } },
                        )
                        put(
                            "roleIds",
                            buildJsonArray { roleIds.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) } },
                        )
                    }
                    vm.createMembership(body) { result ->
                        sending = false
                        if (result is ActionResult.Synced) {
                            vm.loadUsers()
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

    if (pickRoles) {
        MultiPickerDialog(
            title = "الأدوارُ المتاحة",
            items = state.staff.assignableRoles.map { role ->
                PickerItem(role.id, role.name, subtitle = if (role.isSystem) "دورٌ نظاميّ" else null)
            },
            selectedIds = roleIds.toSet(),
            onToggle = { id -> if (roleIds.contains(id)) roleIds.remove(id) else roleIds.add(id) },
            onDismiss = { pickRoles = false },
        )
    }
    if (pickBranches) {
        MultiPickerDialog(
            title = "نطاقُ الفروع",
            items = state.staff.branches.map { branch -> PickerItem(branch.id, branch.nameAr) },
            selectedIds = branchScope.toSet(),
            onToggle = { id -> if (branchScope.contains(id)) branchScope.remove(id) else branchScope.add(id) },
            onDismiss = { pickBranches = false },
        )
    }
}
