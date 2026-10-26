package com.erpcloud.bakery.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.data.ActionResult
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.ActionButton
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.EmptyState
import com.erpcloud.bakery.ui.components.KeyValue
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.components.StatusChip
import com.erpcloud.bakery.util.Dec
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * شاشةُ سياسة عجز العهدة — القراءةُ (van_sales.view) تُظهر **ما سيفعله الخادم
 * فعلًا**: `valuationSource` هو الحقيقة (سعرٌ صريحٌ يتقدّم على الأساس)، والكتابةُ
 * (van_sales.override.approve — قرارٌ ماليٌّ يغيّر مبلغَ ذمّة الموظف) دمجٌ لا
 * استبدال. و`allowInternalDeliveryWithoutTax` **لا يُكتب من هنا**: قرارٌ ضريبيّ
 * في موضعٍ آخر، فلا يُرسل أصلًا.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PolicyScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()

    var basis by rememberSaveable { mutableStateOf("") }
    var unitPrice by rememberSaveable { mutableStateOf("") }
    var preventSelfApproval by rememberSaveable { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    var localError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(state.policy) {
        state.policy?.let { policy ->
            basis = policy.shortageValuationBasis
            unitPrice = policy.shortageUnitPrice ?: ""
            preventSelfApproval = policy.preventSelfApproval
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("سياسةُ عجز العهدة") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            val policy = state.policy
            if (policy == null) {
                EmptyState("جارٍ قراءة السياسة…")
                LaunchedEffect(Unit) { vm.refreshPolicy() }
                return@Column
            }

            SectionCard(
                title = "ما سيفعله الخادمُ فعلًا",
                subtitle = "سعرٌ صريحٌ مكتوبٌ يتقدّمُ على الأساس — فالمصدرُ هو الحقيقةُ لا الأساسُ وحده",
            ) {
                KeyValue("مصدرُ التقييم الفعليّ", Labels.valuationSource(policy.valuationSource))
                KeyValue("أساسُ التقييم", Labels.shortageBasis(policy.shortageValuationBasis))
                if (policy.shortageUnitPrice != null) {
                    KeyValue("السعرُ الصريح", Dec.money(policy.shortageUnitPrice) + " ر.س/كجم")
                }
                KeyValue("منعُ الاعتماد الذاتيّ", if (policy.preventSelfApproval) "ممنوع" else "مسموح")
                if (!policy.configured) {
                    StatusChip("السياسةُ غير مضبوطة — لا يُحمَّل عجزٌ على المندوب قبل ضبطها", ChipTone.WARN)
                }
                val account = policy.chargeCreditAccount
                if (account != null) {
                    KeyValue("حسابُ تحميل العجز", "${account.name} (${account.code})")
                }
                val readiness = policy.salesmanReadiness
                if (readiness != null) {
                    KeyValue("جاهزيّةُ التحميل على المندوب", if (readiness.ready) "جاهزة" else "غير جاهزة")
                    if (readiness.blockingReason != null) {
                        StatusChip(readiness.blockingReason ?: "", ChipTone.WARN)
                    }
                }
            }

            if (state.can("van_sales.override.approve")) {
                SectionCard(
                    title = "تعديلُ السياسة",
                    subtitle = "دمجٌ لا استبدال — وسطرُ تدقيقٍ قبل/بعد يُكتب في الخادم",
                ) {
                    Text("أساسُ تقييم العجز:", fontWeight = FontWeight.SemiBold)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(
                            selected = basis == "unit_cost",
                            onClick = { basis = "unit_cost" },
                            label = { Text("بالتكلفة") },
                        )
                        FilterChip(
                            selected = basis == "selling_price",
                            onClick = { basis = "selling_price" },
                            label = { Text("بسعر البيع") },
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = unitPrice,
                        onValueChange = { if (Dec.isValidInput(it)) unitPrice = it },
                        label = { Text("سعرٌ صريحٌ (ر.س/كجم) — يتقدّم على الأساس إن كان موجبًا") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(8.dp))
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                    ) {
                        Text("منعُ اعتماد المندوبِ إقفالَه بنفسه", Modifier.weight(1f))
                        androidx.compose.material3.Switch(
                            checked = preventSelfApproval,
                            onCheckedChange = { preventSelfApproval = it },
                        )
                    }
                    if (localError != null) {
                        Spacer(Modifier.height(8.dp))
                        StatusChip(localError ?: "", ChipTone.DANGER)
                    }
                    Spacer(Modifier.height(12.dp))
                    ActionButton(
                        label = if (sending) "جارٍ الحفظ…" else "حفظُ السياسة",
                        onClick = {
                            val price = Dec.parse(unitPrice)
                            localError = when {
                                price != null && price.signum() < 0 -> "السعرُ الصريح موجبٌ أو فارغ."
                                basis != "unit_cost" && basis != "selling_price" -> "اختر أساسَ التقييم."
                                else -> null
                            }
                            if (localError != null) return@ActionButton
                            sending = true
                            vm.updatePolicy(
                                buildJsonObject {
                                    put("shortageValuationBasis", basis)
                                    if (unitPrice.isNotBlank()) put("shortageUnitPrice", Dec.wire(unitPrice))
                                    put("preventSelfApproval", preventSelfApproval)
                                },
                            ) { result ->
                                sending = false
                                if (result is ActionResult.Synced) vm.refreshPolicy()
                            }
                        },
                        enabled = !sending,
                        loading = sending,
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "لا يُكتب «التسليمُ الداخليّ بلا ضريبة» من هنا — قرارٌ ضريبيّ في موضعٍ آخر.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                SectionCard(title = "قراءةٌ فقط") {
                    Text(
                        "تعديلُ السياسة يحتاجُ إذنَ van_sales.override.approve — أساسُ تقييم العجز قرارٌ ماليٌّ يغيّر مبلغَ ذمّة الموظف.",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
    }
}
