package com.erpcloud.bakery.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.data.api.SalesmanCardDto
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.EmptyState
import com.erpcloud.bakery.ui.components.KeyValue
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.components.StatusChip
import com.erpcloud.bakery.util.Dec
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * شاشةُ المناديب — بطاقةُ كلّ مندوب بعهدته الحيّة وجاهزيته (كما يحسبها الخادم)،
 * وربطُ بطاقةٍ بحساب دخول (إذنُ sales.salesman.manage): الحسابُ يُنشأ أو يُعاد
 * استعماله، ويُوضع على دور المندوب، ويُقصَّر على مستودع سيارته.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SalesmenScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    var linking by remember { mutableStateOf<SalesmanCardDto?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("المناديب") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
    ) { padding ->
        if (state.loadingSalesmen && state.salesmen.isEmpty()) {
            CenterLoading("جارٍ تحميل بطاقات المناديب…", Modifier.padding(padding))
            return@Scaffold
        }
        if (state.salesmen.isEmpty()) {
            EmptyState("لا بطاقاتِ مناديبَ — تُنشأ البطاقاتُ من شاشة المبيعات الرسميّة.", Modifier.padding(padding))
            return@Scaffold
        }
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(state.salesmen, key = { it.id }) { card ->
                SalesmanCard(vm = vm, card = card, onLink = { linking = card })
            }
        }
    }

    linking?.let { card ->
        LinkAccountDialog(
            card = card,
            onDismiss = { linking = null },
            onSend = { email, fullName, restrict, onResult ->
                vm.linkSalesmanAccount(
                    card.id,
                    buildJsonObject {
                        put("email", email.trim())
                        put("fullName", fullName.trim())
                        put("restrictToVanWarehouse", restrict)
                    },
                ) { error -> onResult(error) }
            },
        )
    }
}

/** بطاقةُ مندوبٍ واحدة — عهدةٌ حيّةٌ وجاهزيّةٌ كما قالها الخادم. */
@Composable
private fun SalesmanCard(vm: AppViewModel, card: SalesmanCardDto, onLink: () -> Unit) {
    val state by vm.uiState.collectAsState()
    SectionCard(
        title = card.name,
        subtitle = listOfNotNull(
            card.warehouseName,
            card.vehiclePlate,
        ).joinToString(" · ").ifBlank { "لا مستودعَ سيارةٍ في بطاقته" },
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (!card.active) StatusChip("موقوف", ChipTone.DANGER)
            val readiness = card.readiness
            val missing = listOfNotNull(
                if (!readiness.hasEmployee) "بطاقةُ موظف" else null,
                if (!readiness.hasLoginAccount) "حسابُ دخول" else null,
                if (readiness.hasLoginAccount && !readiness.loginActive) "تنشيطُ الحساب" else null,
                if (!readiness.hasVanWarehouse) "مستودعُ السيارة" else null,
                if (!readiness.hasVanSalesPermissions) "صلاحياتُ التوزيع" else null,
            )
            if (missing.isEmpty()) StatusChip("جاهزٌ للعمل", ChipTone.OK) else StatusChip("ينقص: ${missing.joinToString("، ")}", ChipTone.WARN)
        }
        Spacer(Modifier.height(6.dp))
        KeyValue("أوامرٌ مفتوحة", card.custody.openLoadOrders.toString())
        KeyValue("عهدتُه الحيّة (كجم)", Dec.kg(card.custody.custodyQty))
        KeyValue("نقدٌ متوقّعٌ لم يُحصَّل", Dec.money(card.custody.outstandingCash) + " ر.س")
        if (card.custody.pendingClosings > 0) KeyValue("وردياتٌ بانتظار الإقفال", card.custody.pendingClosings.toString())
        card.custody.items.forEach { item ->
            KeyValue("· ${item.itemName}", "${Dec.kg(item.quantity)} كجم · ${item.warehouseName}")
        }
        if (card.mobile != null || card.tel != null) {
            KeyValue("جوال", card.mobile ?: card.tel ?: "—")
        }
        if (card.userEmail != null) KeyValue("حسابُ الدخول", card.userEmail)
        if (state.can("sales.salesman.manage")) {
            Spacer(Modifier.height(8.dp))
            OutlinedButton(onClick = onLink) { Text(if (card.membershipId == null) "ربطُ حسابِ دخول" else "ربطُ حسابٍ آخر/تصحيح") }
        }
    }
}

/** حوارُ ربط حساب الدخول — الحسابُ الجديدُ يُنشأ بلا كلمة مرور (رابطُ تفعيلٍ رسميّ). */
@Composable
private fun LinkAccountDialog(
    card: SalesmanCardDto,
    onDismiss: () -> Unit,
    onSend: (email: String, fullName: String, restrict: Boolean, onResult: (String?) -> Unit) -> Unit,
) {
    var email by remember { mutableStateOf(card.userEmail ?: "") }
    var fullName by remember { mutableStateOf(card.employeeName ?: card.name) }
    var restrict by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(
                onClick = {
                    if (email.isBlank() || !email.contains("@")) {
                        error = "أدخل بريدًا صحيحًا."
                        return@TextButton
                    }
                    busy = true
                    onSend(email, fullName, restrict) { result ->
                        busy = false
                        if (result == null) onDismiss() else error = result
                    }
                },
                enabled = !busy,
            ) { Text(if (busy) "جارٍ…" else "ربطُ الحساب") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("رجوع") } },
        title = { Text("ربطُ حساب دخول — ${card.name}") },
        text = {
            Column {
                Text(
                    "يُنشأ الحسابُ (أو يُعاد استعمالُه إن وُجد بنفس البريد) ويُوضع على دور المندوب وتُربط بطاقةُ الموظف." +
                        " الحسابُ الجديدُ بلا كلمة مرور: يُرسل رابطُ تفعيلٍ رسميّ ويُطلب منه تغييرُها.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("البريد الإلكترونيّ") },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = fullName,
                    onValueChange = { fullName = it },
                    label = { Text("الاسمُ الكامل") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text("قصرُ الدخول على مستودع سيارته", modifier = Modifier.weight(1f))
                    androidx.compose.material3.Switch(checked = restrict, onCheckedChange = { restrict = it })
                }
                if (error != null) {
                    Spacer(Modifier.height(8.dp))
                    StatusChip(error ?: "", ChipTone.DANGER)
                }
            }
        },
    )
}
