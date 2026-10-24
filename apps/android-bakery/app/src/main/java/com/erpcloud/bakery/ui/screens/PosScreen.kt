package com.erpcloud.bakery.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.data.api.PosCheckoutReceiptDto
import com.erpcloud.bakery.data.api.PosItemDto
import com.erpcloud.bakery.printing.posReceipt
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.EmptyState
import com.erpcloud.bakery.ui.components.InlineAction
import com.erpcloud.bakery.ui.components.KeyValue
import com.erpcloud.bakery.ui.components.PickerDialog
import com.erpcloud.bakery.ui.components.PickerItem
import com.erpcloud.bakery.ui.components.SearchField
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.components.StatusChip
import com.erpcloud.bakery.ui.theme.BakeryColors
import com.erpcloud.bakery.ui.theme.ShapeCard
import com.erpcloud.bakery.ui.theme.ShapeChip
import com.erpcloud.bakery.util.Dec
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.math.BigDecimal
import java.math.RoundingMode

/**
 * شاشةُ نقطة البيع (من تطبيق الطاقم) — بيعٌ فوريّ على الفرع:
 * أصنافُ `showInPos` من `pos/offline-data`، سلّةٌ بكميّاتٍ وأسعار، ثمّ
 * `pos/checkout` بطريقةِ دفعٍ (نقد/شبكة/تحويل/آجلٌ لعميلٍ مسجّل) مع
 * **نمطِ السعر** — شاملُ الضريبةِ أم قبلَها (`priceIncludesVat` كما في شاشة الويب) —
 * فتُعرضُ الإجمالياتُ الحقيقيّةُ (الصافي/الضريبة/الإجمالي) قبل الدفع.
 *
 * الإيصالُ يُطبعُ فور نجاح البيعة (ESC/POS بلوتوث أو طباعة النظام) —
 * ورقمُ الفاتورة من الخادم لا يُخترع، وبعدَ النجاحِ يُعرضُ ملخّصُ الإيصالِ
 * فلا يُخلطُ بين فشلِ طباعةٍ ونجاحِ البيعة.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PosScreen(vm: AppViewModel, onBack: () -> Unit) {
    val state by vm.uiState.collectAsState()
    val pos = state.staff.posData
    var search by remember { mutableStateOf("") }
    var categoryFilter by remember { mutableStateOf("") }
    var pickCategory by remember { mutableStateOf(false) }
    var showPay by remember { mutableStateOf(false) }
    // B5: مفتاحُ نيّةِ الشراءِ يُولَدُ مرّةً ويُحفَظُ (rememberSaveable) —
    // إعادةُ المحاولةِ بعد انقطاعٍ تُعيدُ المفتاحَ نفسَه فلا بيعةٌ مكرّرة.
    var posKey by rememberSaveable { mutableStateOf("") }
    // آخرُ إيصالٍ ناجحٍ يُحفَظُ لإعادةِ طباعتِه من قربِ ملخّصِ السلّة.
    var lastReceipt by remember { mutableStateOf<PosCheckoutReceiptDto?>(null) }
    var lastReceiptTotals by remember { mutableStateOf(BigDecimal.ZERO) }
    var editPriceFor by remember { mutableStateOf<PosCartLine?>(null) }
    var priceNotice by remember { mutableStateOf<String?>(null) }
    // نمطُ السعر: شاملُ الضريبةِ (افتراضيّ الخادم) أم قبلَها — كما في شاشة الويب.
    var priceIncludesVat by rememberSaveable { mutableStateOf(true) }
    // ملخّصُ الإيصالِ الناجحِ الذي يُعرضُ بعد الدفع (طباعة/مشاركة/إغلاق).
    var showReceipt by remember { mutableStateOf<PosCheckoutReceiptDto?>(null) }
    val cart = remember { mutableStateListOf<PosCartLine>() }
    val scope = androidx.compose.runtime.rememberCoroutineScope()

    LaunchedEffect(Unit) { vm.loadPos() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("نقطة البيع", fontWeight = FontWeight.ExtraBold) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
                },
            )
        },
    ) { padding ->
        if (state.staff.loadingKey == "pos") {
            CenterLoading("جارٍ تحميل أصناف نقطة البيع…", Modifier.padding(padding))
            return@Scaffold
        }
        if (pos == null) {
            EmptyState(
                state.staff.error
                    ?: if (!state.can("pos.view")) "حسابُك لا يحمل إذنَ pos.view — لن تفتح الشاشةُ عند الخادم."
                    else "تعذّر تحميل بيانات نقطة البيع.",
                Modifier.padding(padding),
            )
            return@Scaffold
        }

        // صفحةُ نقطة البيع كما في الموك-أب (03-pos.html): سلّةٌ أعلى الشاشة،
        // ثمّ إعادةُ طباعةِ آخرِ إيصال، فالبحثُ والمجموعةُ والرقائقُ، ثمّ شبكةُ
        // الأصنافِ عمودين — شبكةٌ واحدةٌ تُمرَّرُ تمريرًا واحدًا: البطاقاتُ العريضةُ
        // تمتدُّ عمودينِ (GridItemSpan(2)) وكلُّ صنفٍ خليّةٌ واحدة.
        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 10.dp, bottom = 24.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            // ------------------------------------------------ السلّة
            item(span = { GridItemSpan(2) }) {
                SectionCard(
                    title = "السلّة",
                    subtitle = if (cart.isEmpty()) "لم تُضَف أصنافٌ بعد" else "${cart.size} صنفًا",
                ) {
                    if (cart.isEmpty()) {
                        StatusChip("السلّةُ فارغة — اختر الأصناف من الأسفل", ChipTone.NEUTRAL)
                    } else {
                        cart.forEachIndexed { index, line ->
                            Column(Modifier.fillMaxWidth().padding(vertical = 5.dp)) {
                                Row(
                                    Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Column(Modifier.weight(1f)) {
                                        Text(
                                            line.item.nameAr,
                                            style = MaterialTheme.typography.bodyMedium,
                                            fontWeight = FontWeight.Bold,
                                        )
                                        if (!Dec.isPositive(line.price)) {
                                            // B24: صنفٌ دخلَ السلّةَ بلا سعرِ بيعٍ — سعرُه يُدخلُ هنا قبل الدفع.
                                            OutlinedTextField(
                                                value = line.price,
                                                onValueChange = { if (Dec.isValidInput(it)) line.price = it },
                                                label = { Text("سعرُ الوحدة (ر.س) *") },
                                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                                isError = true,
                                                modifier = Modifier.fillMaxWidth().padding(top = 2.dp),
                                            )
                                        } else {
                                            Text(
                                                "${Dec.money(line.qty)} × ${Dec.money(line.price)} ر.س = " +
                                                    Dec.money(
                                                        Dec.orZero(line.qty).multiply(Dec.orZero(line.price)).toPlainString(),
                                                    ) + " ر.س",
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                    }
                                    // أزرارُ الكميّةِ والتعديلِ والحذف — دوائرُ سطحٍ دافئ كما في الموك-أب.
                                    Row(
                                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        PosCircleButton("−") { line.dec() }
                                        Text(
                                            line.qty,
                                            style = MaterialTheme.typography.bodyMedium,
                                            fontWeight = FontWeight.Bold,
                                            textAlign = TextAlign.Center,
                                            modifier = Modifier.widthIn(min = 22.dp),
                                        )
                                        PosCircleButton("+") { line.inc() }
                                        PosCircleButton("✎") { editPriceFor = line }
                                        PosCircleButton("✕") { cart.removeAt(index) }
                                    }
                                }
                            }
                        }
                        Spacer(Modifier.height(6.dp))
                        // فاصلٌ متقطّعٌ قبل الإجماليات — كما في الموك-أب.
                        PosDashedDivider()
                        Spacer(Modifier.height(4.dp))
                        // الإجمالياتُ الحيّةُ بنمطِ السعرِ المختار — نفسُ حسابِ الخادم
                        // (invoice-math): شاملٌ ⇒ الضريبةُ تُستخرَجُ من الأسعار، وإلا فوقَها.
                        val totals = cartTotalsWithTax(cart, pos.taxes, priceIncludesVat)
                        KeyValue("الصافي قبل الضريبة", Dec.money(totals.net.toPlainString()) + " ر.س")
                        KeyValue("الضريبة المقدّرة", Dec.money(totals.tax.toPlainString()) + " ر.س")
                        KeyValue("الإجمالي المستحقّ", Dec.money(totals.total.toPlainString()) + " ر.س")
                        Row(
                            Modifier.fillMaxWidth().padding(top = 4.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text("السعرُ شاملُ الضريبة", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
                                Text(
                                    if (priceIncludesVat) "الضريبةُ داخلُ الأسعار المعروضة" else "الضريبةُ تُضافُ فوقَ الأسعار",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Switch(
                                checked = priceIncludesVat,
                                onCheckedChange = { priceIncludesVat = it },
                            )
                        }
                        if (priceNotice != null) {
                            Spacer(Modifier.height(6.dp))
                            StatusChip(priceNotice ?: "", ChipTone.DANGER)
                        }
                        if (state.can("pos.operate") && state.can("sales.invoice.post")) {
                            Spacer(Modifier.height(8.dp))
                            // زرُّ الدفع كما في الموك-أب: ممتلئٌ primary بعرضٍ كاملٍ وارتفاع 52.
                            Button(
                                onClick = {
                                    // B24: لا دفعَ بسطرٍ بلا سعر — أولُ سطرٍ ناقصٍ يُسمّى صريحًا.
                                    val missingPrice = cart.firstOrNull { !Dec.isPositive(it.price) }
                                    if (missingPrice != null) {
                                        priceNotice = "أدخل سعرًا للصنف «${missingPrice.item.nameAr}» قبل الدفع"
                                    } else {
                                        priceNotice = null
                                        showPay = true
                                    }
                                },
                                modifier = Modifier.fillMaxWidth().height(52.dp),
                                shape = ShapeCard,
                            ) { Text("إتمامُ البيعة والدفع", fontWeight = FontWeight.Bold) }
                        } else {
                            Spacer(Modifier.height(6.dp))
                            StatusChip("إتمامُ البيعة يحتاج إذنَي pos.operate و sales.invoice.post", ChipTone.WARN)
                        }
                    }
                }
            }

            // ------------------------------------------------ إعادةُ طباعة آخر إيصال
            item(span = { GridItemSpan(2) }) {
                InlineAction(
                    label = "إعادةُ طباعة آخر إيصال",
                    onClick = {
                        lastReceipt?.let { receipt ->
                            printReceiptAction(vm, state, scope, receipt, lastReceiptTotals)
                        }
                    },
                    enabled = lastReceipt != null,
                    tone = ChipTone.NEUTRAL,
                )
            }

            // ------------------------------------------------ البحث والمجموعة
            item(span = { GridItemSpan(2) }) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    SearchField(
                        value = search,
                        onValueChange = { search = it },
                        placeholder = "بحثٌ بالاسم/الباركود",
                        modifier = Modifier.weight(1f),
                    )
                    OutlinedButton(
                        onClick = { pickCategory = true },
                        modifier = Modifier.height(56.dp),
                    ) {
                        Text(
                            pos.categories.firstOrNull { it.id == categoryFilter }?.nameAr
                                ?: if (categoryFilter == "none") "بلا مجموعة" else "كلُّ المجموعات",
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }

            // ------------------------------------------------ رقائقُ التصفيةِ السريعة
            // نفسُ خياراتِ حوارِ المجموعات: «كلُّ المجموعات» تُفرِّغُ التصفية،
            // و«بلا مجموعة» تعرضُ غيرَ المصنَّف — والحوارُ (زرُّ المجموعة) يبقى كما هو.
            item(span = { GridItemSpan(2) }) {
                Row(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    PosFilterChip("كلُّ المجموعات", categoryFilter.isBlank()) { categoryFilter = "" }
                    pos.categories.forEach { category ->
                        PosFilterChip(category.nameAr, categoryFilter == category.id) { categoryFilter = category.id }
                    }
                    PosFilterChip("بلا مجموعة", categoryFilter == "none") { categoryFilter = "none" }
                }
            }

            // ------------------------------------------------ الأصناف
            val filtered = pos.items.filter { item ->
                (categoryFilter.isBlank() || (if (categoryFilter == "none") item.categoryId == null else item.categoryId == categoryFilter)) &&
                    (search.isBlank() ||
                        item.nameAr.contains(search.trim(), ignoreCase = true) ||
                        item.sku.contains(search.trim(), ignoreCase = true) ||
                        item.barcode?.contains(search.trim()) == true)
            }
            if (filtered.isEmpty()) {
                item(span = { GridItemSpan(2) }) { EmptyState("لا أصنافَ مطابقةً في نقطة البيع.") }
            } else {
                items(filtered, key = { it.id }) { item ->
                    PosItemCard(item) { addToCart(cart, item) }
                }
            }
        }
    }

    if (pickCategory) {
        PickerDialog(
            title = "مجموعةُ الأصناف",
            items = listOf(PickerItem("", "كلُّ المجموعات"), PickerItem("none", "بلا مجموعة")) +
                (pos?.categories ?: emptyList()).map { PickerItem(it.id, it.nameAr) },
            onDismiss = { pickCategory = false },
            onSelect = {
                categoryFilter = it.id
                pickCategory = false
            },
        )
    }
    if (showPay && pos != null) {
        PayDialog(
            vm = vm,
            cart = cart.toList(),
            pos = pos,
            priceIncludesVat = priceIncludesVat,
            onTaxModeChange = { priceIncludesVat = it },
            onConfirm = { method, partyId, cashLocationId, warehouseId ->
                showPay = false
                val checkoutBranchId = pos.defaults.branchId
                    ?: pos.branches.firstOrNull()?.id.orEmpty()
                val body = buildJsonObject {
                    put("branchId", checkoutBranchId)
                    // المستودعُ مطلوبٌ دائمًا — الخادمُ يرفضُ فاتورةً تصرفُ مخزونًا بدونه
                    // (SALES_WAREHOUSE_REQUIRED) مهما كان الإعداد الافتراضيّ.
                    put("warehouseId", warehouseId)
                    put("orderType", "pos")
                    // نمطُ السعرِ — كما في شاشة الويب: شاملٌ أم قبلَ الضريبة.
                    put("priceIncludesVat", priceIncludesVat)
                    if (partyId.isNotBlank()) put("partyId", partyId) else put("cashCustomerName", "عميل عام")
                    put(
                        "lines",
                        buildJsonArray {
                            cart.forEach { line ->
                                add(
                                    buildJsonObject {
                                        put("itemId", line.item.id)
                                        put("quantity", Dec.wire(line.qty))
                                        put("unitPrice", Dec.wire(line.price))
                                        // نسبةُ ضريبةِ الصنفِ من بيانات نقطة البيع —
                                        // بلا حقلٍ يحسبُها الخادمُ صفرًا (taxRate ?? '0').
                                        put(
                                            "taxRate",
                                            Dec.wire(
                                                pos.taxes.firstOrNull { it.id == line.item.taxGroupId }?.rate ?: "0",
                                            ),
                                        )
                                    }
                                )
                            }
                        },
                    )
                    put(
                        "payment",
                        buildJsonObject {
                            put("method", method)
                            if (method != "credit" && cashLocationId.isNotBlank()) {
                                put("cashLocationId", cashLocationId)
                            }
                        },
                    )
                }
                // B5: نيّةُ شراءٍ واحدةٌ مفتاحٌ واحد — المفتاحُ يُحفَظُ لا يُولَّدُ عند
                // كلِّ محاولةٍ، فإعادةُ الإرسالِ بعد مهلةِ شبكةٍ تُعيدُ المفتاحَ نفسَه.
                if (posKey.isBlank()) {
                    posKey = "bakery-pos-" + java.util.UUID.randomUUID().toString()
                }
                val withKey = vm.ensureIdempotencyKey("bakery-pos", body, posKey)
                vm.posCheckout(withKey) { receipt ->
                    if (receipt != null) {
                        // B5: نجحت البيعةُ بهذا المفتاح — البيعةُ التاليةُ تُفتحُ بمفتاحٍ جديد.
                        posKey = ""
                        // لقطةُ الإيصالِ الأخير للطباعةِ الإضافيّة.
                        lastReceipt = receipt
                        lastReceiptTotals = cartTotalsSnapshot(withKey)
                        cart.clear()
                        // البيعةُ نجحت — يُعرضُ ملخّصُ الإيصالِ فورًا حتى لا يُقرأَ
                        // فشلُ طباعةٍ لاحقٌ كفشلِ حفظ. ثمّ تُطبَعُ تلقائيًّا على IO.
                        showReceipt = receipt
                        printReceiptAction(vm, state, scope, receipt, cartTotalsSnapshot(withKey))
                    }
                }
            },
            onDismiss = { showPay = false },
        )
    }

    // B24: تعديلُ سعرِ أيِّ سطرٍ في السلّة عبر زرِّ القلم.
    editPriceFor?.let { line ->
        PosPriceDialog(
            line = line,
            onDismiss = { editPriceFor = null },
        )
    }

    // ------------------------------------------------ ملخّصُ الإيصالِ الناجح
    showReceipt?.let { receipt ->
        ReceiptSuccessDialog(
            receipt = receipt,
            onPrint = { printReceiptAction(vm, state, scope, receipt, lastReceiptTotals) },
            onShare = {
                scope.launch {
                    try {
                        val context = vm.androidContext()
                        // 🧾 ترويسةُ المنشأةِ وQR الزكاة على الصورةِ المُشارَكةِ أيضًا.
                        val qr = vm.receiptQrPayload(receipt)
                        val company = state.companyProfile
                        val bitmap = withContext(kotlinx.coroutines.Dispatchers.IO) {
                            posReceipt(receipt, lastReceiptTotals, qr, company?.nameAr ?: "", company?.taxNo ?: "")
                        }
                        com.erpcloud.bakery.printing.PrintKit.shareImage(
                            context, bitmap, "receipt-${receipt.number.ifBlank { "pos" }}.png",
                        )
                    } catch (error: Exception) {
                        vm.showPrintError(error.message ?: "تعذّرت مشاركةُ الإيصال")
                    }
                }
            },
            onDismiss = { showReceipt = null },
        )
    }
}

/** سطرُ سلّةٍ — الصنفُ والكميّةُ (نصٌّ دقيق) والسعرُ كما جاء من الكتالوج. */
private class PosCartLine(val item: PosItemDto) {
    var qty by mutableStateOf("1")
    var price by mutableStateOf(item.salePrice ?: "")
    fun inc() {
        val next = (Dec.orZero(qty).add(BigDecimal.ONE)).toPlainString()
        qty = next
    }
    fun dec() {
        val current = Dec.orZero(qty)
        if (current.signum() > 1) qty = current.subtract(BigDecimal.ONE).toPlainString()
    }
}

/** إجمالياتُ السلّة الحيّة — صافي/ضريبة/إجمالي. */
private data class PosTotals(val net: BigDecimal, val tax: BigDecimal, val total: BigDecimal)

/**
 * تقديرُ الإجمالياتِ في الجهاز — نفسُ منطقِ `calculateInvoiceTotals` في الخادم
 * (invoice-math): شاملُ الضريبةِ ⇒ تُستخرَجُ من الأسعار (base×rate÷(100+rate))،
 * وإلا تُضافُ فوقَها (base×rate÷100). النسبةُ من مجموعةِ ضريبةِ الصنفِ في
 * `pos/offline-data`، والخادمُ يبقى الحكمَ النهائيّ عند الترحيل.
 */
private fun cartTotalsWithTax(
    cart: List<PosCartLine>,
    taxes: List<com.erpcloud.bakery.data.api.PosTaxGroupDto>,
    priceIncludesVat: Boolean,
): PosTotals {
    var net = BigDecimal.ZERO
    var tax = BigDecimal.ZERO
    val hundred = BigDecimal(100)
    cart.forEach { line ->
        val base = Dec.orZero(line.qty).multiply(Dec.orZero(line.price))
        val ratePct = Dec.orZero(
            taxes.firstOrNull { it.id == line.item.taxGroupId }?.rate,
        )
        val lineTax = if (priceIncludesVat) {
            base.multiply(ratePct).divide(hundred.add(ratePct), 2, RoundingMode.HALF_UP)
        } else {
            base.multiply(ratePct).divide(hundred, 2, RoundingMode.HALF_UP)
        }
        tax = tax.add(lineTax)
        net = net.add(if (priceIncludesVat) base.subtract(lineTax) else base)
    }
    return PosTotals(net = net, tax = tax, total = net.add(tax))
}

/**
 * طباعةُ إيصالٍ واحدٌ من كلّ المسارات (نجاحُ البيعة/إعادةُ الطباعة/حوارُ الإيصال):
 * طابعةُ بلوتوثٍ مسجّلة ⇒ إيصالٌ نقطيٌّ ESC/POS بترويسةِ المنشأةِ وQR الزكاة؛
 * وإلا ⇒ إيصالُ الكاشيرِ الاحترافيُّ من الخادمِ (ورقٌ صغيرٌ 80mm) عبرَ طباعةِ
 * أندرويد — والاثنانِ يحملانِ رمزَ الفاتورةِ الإلكترونيّة.
 */
private fun printReceiptAction(
    vm: AppViewModel,
    state: com.erpcloud.bakery.ui.UiState,
    scope: kotlinx.coroutines.CoroutineScope,
    receipt: PosCheckoutReceiptDto,
    totals: BigDecimal,
) {
    scope.launch {
        try {
            val context = vm.androidContext()
            val mac = state.session.printerMac
            if (mac.isBlank()) {
                // 🖨️ بلا طابعةٍ مسجّلة: إيصالُ الكاشيرِ الاحترافيُّ من الخادمِ (ورقٌ صغيرٌ
                // 80mm بقالبِ الويبِ الرسميِّ وQR الزكاة) عبرَ طباعةِ أندرويد — أو «حفظ PDF».
                val html = vm.salesInvoicePrintHtml(receipt.invoiceId, paper = "small")
                com.erpcloud.bakery.printing.HtmlPrint.printViaSystem(
                    context, html, "إيصال ${receipt.number}",
                )
            } else {
                // 🖨️ طابعةُ بلوتوثٍ مسجّلة: الإيصالُ النقطيّ ESC/POS بترويسةِ المنشأةِ وQR الزكاة.
                val width = state.session.printerWidthDots
                val qr = vm.receiptQrPayload(receipt)
                val company = state.companyProfile
                withContext(kotlinx.coroutines.Dispatchers.IO) {
                    val rendered = posReceipt(
                        receipt, totals, qr,
                        company?.nameAr ?: "", company?.taxNo ?: "",
                    )
                    com.erpcloud.bakery.printing.EscPos.printBitmap(context, mac, width, rendered)
                }
            }
        } catch (error: Exception) {
            vm.showPrintError(error.message ?: "تعذّرت طباعةُ الإيصال")
        }
    }
}

/**
 * حوارُ نجاحِ البيعة — يُقطعُ اللبسَ الذي أظلمَ تجربةَ الكاشير: البيعةُ نُفِّذت
 * عند الخادم (رقمُ الفاتورةِ والإجمالياتُ من الردّ) وطباعتُها اختياريّةٌ
 * تُعادُ من هنا. فشلُ الطباعةِ لا يعني فشلَ الحفظ.
 */
@Composable
private fun ReceiptSuccessDialog(
    receipt: PosCheckoutReceiptDto,
    onPrint: () -> Unit,
    onShare: () -> Unit,
    onDismiss: () -> Unit,
) {
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("تمّت البيعة بنجاح ✓") },
        text = {
            Column {
                KeyValue("رقمُ الفاتورة", receipt.number.ifBlank { "—" })
                receipt.subtotal?.let { KeyValue("الصافي قبل الضريبة", Dec.money(it) + " ر.س") }
                receipt.taxTotal?.let { KeyValue("الضريبة", Dec.money(it) + " ر.س") }
                receipt.total?.let { KeyValue("الإجماليُّ المستحقّ", Dec.money(it) + " ر.س") }
                receipt.paidTotal?.let { KeyValue("المدفوع", Dec.money(it) + " ر.س") }
                receipt.change?.takeIf { Dec.isPositive(it) }?.let { KeyValue("الباقي للعميل", Dec.money(it) + " ر.س") }
                Spacer(Modifier.height(8.dp))
                Text(
                    "نُفِّذت عند الخادم وحُفِظت — فشلُ الطباعةِ (إن حدث) لا يُلغي البيعة، ويمكنُ إعادتُها الآن.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = {
            androidx.compose.material3.TextButton(onClick = onPrint) { Text("طباعةُ الإيصال") }
        },
        dismissButton = {
            androidx.compose.material3.TextButton(
                onClick = {
                    onShare()
                    onDismiss()
                },
            ) { Text("مشاركة") }
        },
    )
}

/**
 * حوارُ تعديلِ سعرِ سطرٍ في السلّة (B24) — متاحٌ لكلِّ السطورِ عبر زرِّ القلم:
 * السعرُ رقمٌ موجبٌ فقط، فلا تُرحَّلُ بيعةٌ بسعرِ صفرٍ أو فراغ.
 */
@Composable
private fun PosPriceDialog(line: PosCartLine, onDismiss: () -> Unit) {
    var value by remember(line) { mutableStateOf(if (Dec.isPositive(line.price)) line.price else "") }
    var error by remember { mutableStateOf<String?>(null) }
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            androidx.compose.material3.TextButton(
                onClick = {
                    val parsed = Dec.parse(value)
                    if (parsed == null || parsed.signum() <= 0) {
                        error = "أدخل سعرًا موجبًا أكبر من صفر."
                        return@TextButton
                    }
                    line.price = value.trim()
                    onDismiss()
                },
            ) { Text("حفظُ السعر") }
        },
        dismissButton = {
            androidx.compose.material3.TextButton(onClick = onDismiss) { Text("رجوع") }
        },
        title = { Text("تعديلُ سعر «${line.item.nameAr}»") },
        text = {
            Column {
                Text(
                    "السعرُ الذي سيُرحَّلُ مع سطرِ البيعةِ بالريال السعوديّ — لا يُقبلُ صفرٌ ولا فراغ.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = value,
                    onValueChange = { if (Dec.isValidInput(it)) value = it },
                    label = { Text("سعرُ الوحدة (ر.س) *") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    isError = error != null,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (error != null) {
                    Spacer(Modifier.height(6.dp))
                    StatusChip(error ?: "", ChipTone.DANGER)
                }
            }
        },
    )
}

private fun addToCart(cart: androidx.compose.runtime.snapshots.SnapshotStateList<PosCartLine>, item: PosItemDto) {
    val existing = cart.firstOrNull { it.item.id == item.id }
    if (existing != null) existing.inc() else cart.add(PosCartLine(item))
}

private fun cartSubtotal(cart: List<PosCartLine>): BigDecimal {
    var total = BigDecimal.ZERO
    cart.forEach { line ->
        total = total.add(Dec.orZero(line.qty).multiply(Dec.orZero(line.price)))
    }
    return total
}

/** لقطةُ إجمالياتِ السلّة للطباعة — تُحسب من الجسم المُرسَل نفسه لا من واجهةٍ أخرى. */
private fun cartTotalsSnapshot(body: kotlinx.serialization.json.JsonObject): BigDecimal {
    var total = BigDecimal.ZERO
    val lines = body["lines"] as? kotlinx.serialization.json.JsonArray ?: return BigDecimal.ZERO
    lines.forEach { element ->
        val obj = element as? kotlinx.serialization.json.JsonObject ?: return@forEach
        val qty = Dec.orZero((obj["quantity"] as? kotlinx.serialization.json.JsonPrimitive)?.content)
        val price = Dec.orZero((obj["unitPrice"] as? kotlinx.serialization.json.JsonPrimitive)?.content)
        total = total.add(qty.multiply(price))
    }
    return total
}

/**
 * بطاقةُ صنفٍ في شبكة نقطة البيع — «.item» في الموك-أب (03-pos): اسمٌ عريضٌ،
 * SKUٌ رماديٌّ صغيرٌ، سعرٌ كهرمانيٌّ غامقٌ كبير، وزرُّ إضافةٍ ممتلئٌ بعرضِ
 * البطاقةِ كاملًا. الصنفُ بلا سعرِ بيعٍ يظهرُ تحذيرُهُ بالأحمرِ كما كان.
 */
@Composable
private fun PosItemCard(item: PosItemDto, onAdd: () -> Unit) {
    SectionCard(title = null) {
        Text(
            item.nameAr,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.ExtraBold,
        )
        Text(
            "SKU: ${item.sku.ifBlank { "—" }}",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(6.dp))
        val priceText = item.salePrice?.let { Dec.money(it) + " ر.س" }
        if (priceText != null) {
            Text(
                priceText,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.ExtraBold,
                color = BakeryColors.PrimaryDark,
            )
        } else {
            Text(
                "بلا سعرِ بيعٍ — يُدخل يدويًّا",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.error,
            )
        }
        Spacer(Modifier.height(8.dp))
        FilledTonalButton(
            onClick = onAdd,
            modifier = Modifier.fillMaxWidth(),
            shape = ShapeChip,
        ) {
            Text("+ للسلّة", fontWeight = FontWeight.Bold)
        }
    }
}

/** زرُّ دائريٌّ صغيرٌ (− / + / ✎ / ✕) — «.cbtn» في الموك-أب: دائرةُ سطحٍ دافئ. */
@Composable
private fun PosCircleButton(label: String, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.size(30.dp),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(label, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
        }
    }
}

/** رقاقةُ تصفيةٍ أفقيّة — «.fchip/.fchip.sel» في الموك-أب: المحدّدةُ بـsecondaryContainer. */
@Composable
private fun PosFilterChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = ShapeChip,
        color = if (selected) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent,
        border = if (selected) null else BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Text(
            label,
            color = if (selected) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
        )
    }
}

/** فاصلٌ متقطّعٌ دافئٌ قبل إجماليات السلّة — «border-top: 1px dashed» في الموك-أب. */
@Composable
private fun PosDashedDivider() {
    val line = MaterialTheme.colorScheme.outline
    Canvas(Modifier.fillMaxWidth().height(2.dp)) {
        drawLine(
            color = line,
            start = Offset(0f, 0f),
            end = Offset(size.width, 0f),
            strokeWidth = 2.dp.toPx(),
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 4.dp.toPx())),
        )
    }
}

/**
 * حوارُ الدفع — كما في شاشة الويب: طريقةُ الدفع + العميلُ (للآجل) +
 * **المستودعُ المُصرفُ منه** (مطلوبٌ دائمًا — الخادمُ يرفضُ بدونه
 * SALES_WAREHOUSE_REQUIRED) + **خزينةُ الاستلام** لكلِّ طريقةٍ غيرِ الآجل
 * (نقديّ ⇒ صندوق safe · شبكة/تحويل ⇒ بنك bank).
 */
@Composable
private fun PayDialog(
    vm: AppViewModel,
    cart: List<PosCartLine>,
    pos: com.erpcloud.bakery.data.api.PosOfflineDataDto,
    priceIncludesVat: Boolean,
    onTaxModeChange: (Boolean) -> Unit,
    onConfirm: (method: String, partyId: String, cashLocationId: String, warehouseId: String) -> Unit,
    onDismiss: () -> Unit,
) {
    val branchId = pos.defaults.branchId ?: pos.branches.firstOrNull()?.id.orEmpty()
    val branchWarehouses = remember(branchId) {
        pos.warehouses.filter { branchId.isBlank() || it.branchId == null || it.branchId == branchId }
    }
    val initialWarehouse =
        pos.defaults.warehouseId?.takeIf { dw -> branchWarehouses.any { it.id == dw } }
            ?: branchWarehouses.firstOrNull()?.id
            ?: pos.defaults.warehouseId
            ?: ""

    var method by remember { mutableStateOf("cash") }
    var partyId by remember { mutableStateOf("") }
    var partyLabel by remember { mutableStateOf("") }
    var warehouseId by remember { mutableStateOf(initialWarehouse) }
    var cashLocationId by remember { mutableStateOf(pos.defaults.cashLocationId ?: "") }
    var pickCustomer by remember { mutableStateOf(false) }
    var pickCash by remember { mutableStateOf(false) }
    var pickWarehouse by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    // خزائنُ الفرع حسب الطريقة: نقديّ ⇒ safe (والغائبُ يُفترَض safe كما في الويب)،
    // شبكة/تحويل ⇒ bank.
    val branchDrawers = remember(method, branchId) {
        val kind = if (method == "cash") "safe" else "bank"
        pos.cashLocations.filter { loc ->
            val locKind = loc.kind.takeIf { it.isNotBlank() } ?: "safe"
            locKind == kind && (branchId.isBlank() || loc.branchId == null || loc.branchId == branchId)
        }
    }
    LaunchedEffect(branchDrawers) {
        if (branchDrawers.none { it.id == cashLocationId }) {
            cashLocationId = branchDrawers.firstOrNull { it.isDefault }?.id
                ?: branchDrawers.firstOrNull()?.id ?: ""
        }
    }
    val warehouseLabel = branchWarehouses.firstOrNull { it.id == warehouseId }?.label ?: ""
    val cashLabel = branchDrawers.firstOrNull { it.id == cashLocationId }?.name ?: ""
    // الإجمالياتُ الحيّةُ داخلَ الحوار — تُحدَّثُ فورَ قلبِ نمطِ السعر.
    val payTotals = cartTotalsWithTax(cart, pos.taxes, priceIncludesVat)
    val uiState by vm.uiState.collectAsState()
    var shiftBusy by remember { mutableStateOf(false) }

    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("إتمامُ البيعة") },
        text = {
            Column {
                KeyValue("الإجماليُّ المستحقّ", Dec.money(payTotals.total.toPlainString()) + " ر.س")
                Text(
                    "تقديرٌ بنمطِ السعرِ المختار: صافي " +
                        Dec.money(payTotals.net.toPlainString()) + " + ضريبة " +
                        Dec.money(payTotals.tax.toPlainString()) + " ر.س — والحسابُ النهائيّ عند الخادم.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(
                    Modifier.fillMaxWidth().padding(top = 6.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                ) {
                    Text(
                        if (priceIncludesVat) "الأسعارُ شاملةُ الضريبة" else "الأسعارُ قبلَ الضريبة",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Switch(
                        checked = priceIncludesVat,
                        onCheckedChange = onTaxModeChange,
                    )
                }
                Spacer(Modifier.height(10.dp))
                listOf(
                    "cash" to "نقدي",
                    "card" to "شبكة",
                    "bank" to "تحويل بنكي",
                    "credit" to "آجل (عميلٌ مسجّل)",
                ).forEach { (value, labelAr) ->
                    Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                        androidx.compose.material3.RadioButton(
                            selected = method == value,
                            onClick = { method = value },
                        )
                        Text(labelAr)
                    }
                }
                // ورديةُ الكاشير: إن فعّلت المنشأةُ pos.requireShift رُفض البيعُ النقديُّ
                // بـPOS_SHIFT_REQUIRED — هذا الزرُّ هو المخرجُ (إذنُ treasury.shift.close).
                if (uiState.can("treasury.shift.close")) {
                    Spacer(Modifier.height(6.dp))
                    androidx.compose.material3.OutlinedButton(
                        onClick = {
                            shiftBusy = true
                            vm.openShift(branchId) { ok -> shiftBusy = false }
                        },
                        enabled = !shiftBusy,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            if (shiftBusy) "جارٍ فتح الوردية…"
                            else "فتحُ ورديةِ الكاشير لهذا الفرع",
                        )
                    }
                }
                Spacer(Modifier.height(6.dp))
                OutlinedTextField(
                    value = warehouseLabel,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("المستودعُ المُصرفُ منه *") },
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = { IconButton(onClick = { pickWarehouse = true }) { Text("اختر") } },
                )
                if (method == "credit") {
                    Spacer(Modifier.height(6.dp))
                    OutlinedTextField(
                        value = partyLabel,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("العميل * (الآجلُ يحتاج عميلًا مسجّلًا)") },
                        modifier = Modifier.fillMaxWidth(),
                        trailingIcon = { IconButton(onClick = { pickCustomer = true }) { Text("اختر") } },
                    )
                } else {
                    Spacer(Modifier.height(6.dp))
                    OutlinedTextField(
                        value = cashLabel,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text(if (method == "cash") "الصندوقُ الذي يستلمُ المبلغ *" else "الحسابُ البنكيّ الذي يستلمُ المبلغ *") },
                        modifier = Modifier.fillMaxWidth(),
                        trailingIcon = { IconButton(onClick = { pickCash = true }) { Text("اختر") } },
                    )
                }
                if (error != null) {
                    Spacer(Modifier.height(6.dp))
                    StatusChip(error ?: "", ChipTone.DANGER)
                }
            }
        },
        confirmButton = {
            androidx.compose.material3.TextButton(
                onClick = {
                    error = when {
                        branchId.isBlank() -> "لا يوجد فرعٌ مُعرّف — لا يمكن إتمامُ البيعة."
                        warehouseId.isBlank() -> "اختر المستودعَ الذي تُصرفُ منه الأصناف."
                        method == "credit" && partyId.isBlank() -> "البيعُ الآجل يحتاج عميلًا مسجّلًا."
                        method != "credit" && cashLocationId.isBlank() ->
                            if (method == "cash") "اختر الصندوقَ الذي يستلمُ المبلغ."
                            else "اختر الحسابَ البنكيّ الذي يستلمُ المبلغ."
                        else -> null
                    }
                    if (error != null) return@TextButton
                    onConfirm(method, partyId, cashLocationId, warehouseId)
                },
            ) { Text("دفعٌ وإتمام") }
        },
        dismissButton = {
            androidx.compose.material3.TextButton(onClick = onDismiss) { Text("إلغاء") }
        },
    )

    if (pickCustomer) {
        PickerDialog(
            title = "اختر العميل",
            items = pos.customers.map { PickerItem(it.id, it.name, trailing = it.mobile) },
            onDismiss = { pickCustomer = false },
            onSelect = { partyId = it.id; partyLabel = it.title; pickCustomer = false },
        )
    }
    if (pickCash) {
        PickerDialog(
            title = if (method == "cash") "اختر الصندوق" else "اختر الحساب البنكيّ",
            items = branchDrawers.map { PickerItem(it.id, it.name, trailing = if (it.isDefault) "افتراضيّة" else null) },
            onDismiss = { pickCash = false },
            onSelect = { cashLocationId = it.id; pickCash = false },
        )
    }
    if (pickWarehouse) {
        PickerDialog(
            title = "اختر المستودع",
            items = branchWarehouses.map { PickerItem(it.id, it.label, trailing = if (it.isDefault == true) "افتراضيّ" else null) },
            onDismiss = { pickWarehouse = false },
            onSelect = { warehouseId = it.id; pickWarehouse = false },
        )
    }
}
