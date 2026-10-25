@file:OptIn(ExperimentalMaterial3Api::class)

package com.erpcloud.bakery.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.erpcloud.bakery.data.ActionResult
import com.erpcloud.bakery.data.api.AiConversationRowDto
import com.erpcloud.bakery.data.api.AiSettingsDto
import com.erpcloud.bakery.data.api.AiSuggestionDto
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.InfoCallout
import com.erpcloud.bakery.ui.components.KeyValue
import com.erpcloud.bakery.ui.components.PickerDialog
import com.erpcloud.bakery.ui.components.PickerItem
import com.erpcloud.bakery.ui.components.PickerTrigger
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.components.StatusChip
import com.erpcloud.bakery.ui.components.rememberPickerInteractionSource
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private data class UiChatTurn(
    val id: String,
    val role: String,
    val content: String,
)

private val QUICK_PROMPTS = listOf(
    "ملخّص مبيعات اليوم",
    "الأصناف منخفضة المخزون",
    "العملاء المتأخّرون في السداد",
    "كيف أُنشئ فاتورة مشتريات؟",
)

private val AI_PROVIDERS = listOf(
    "" to "الافتراضيّ للمنصّة",
    "openai" to "OpenAI (GPT)",
    "anthropic" to "Anthropic (Claude)",
    "gemini" to "Google Gemini",
    "custom" to "مزوّد متوافق مع OpenAI (Custom URL)",
    "local" to "محرّك المنشأة المحلّي الآمن (Local)",
)

private val MODEL_SUGGESTIONS = mapOf(
    "openai" to listOf("gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"),
    "anthropic" to listOf("claude-3-5-haiku-latest", "claude-3-5-sonnet-latest"),
    "gemini" to listOf("gemini-2.0-flash", "gemini-1.5-pro"),
    "custom" to listOf("gpt-4o-mini", "deepseek-chat", "llama-3.3-70b-instruct"),
    "local" to listOf("local-grounded"),
)

/**
 * شاشةُ المساعد الذكيّ (AI) + شاشةُ إعدادات الذكاء الاصطناعيّ المدمجة.
 *
 * @param startInSettings عند الفتح من عنصر «إعدادات المساعد الذكي» يبدأ في وضع الإعدادات.
 */
@Composable
fun AiAssistantScreen(
    vm: AppViewModel,
    onBack: () -> Unit,
    startInSettings: Boolean = false,
) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val canManageSettings = state.can("ai.settings.manage")

    var showSettings by rememberSaveable { mutableStateOf(startInSettings && canManageSettings) }
    var showHistoryPicker by remember { mutableStateOf(false) }

    val greeting = "مرحبًا بك في المساعد الذكيّ — اسألني عن مبيعات اليوم، أرصدة المخزون، الذمم المتأخّرة، أو خطوات العمل في أيّ شاشة."
    val messages = remember {
        mutableStateListOf(UiChatTurn("welcome", "assistant", greeting))
    }
    var conversationId by rememberSaveable { mutableStateOf<String?>(null) }
    var draft by rememberSaveable { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }

    var suggestions by remember { mutableStateOf<List<AiSuggestionDto>>(emptyList()) }
    var conversations by remember { mutableStateOf<List<AiConversationRowDto>>(emptyList()) }

    // حقول إعدادات الذكاء الاصطناعي
    var settingsDto by remember { mutableStateOf<AiSettingsDto?>(null) }
    var loadingSettings by remember { mutableStateOf(false) }
    var aiEnabled by rememberSaveable { mutableStateOf(true) }
    var provider by rememberSaveable { mutableStateOf("") }
    var model by rememberSaveable { mutableStateOf("") }
    var baseUrl by rememberSaveable { mutableStateOf("") }
    var apiKey by rememberSaveable { mutableStateOf("") }
    var tokenLimit by rememberSaveable { mutableStateOf("") }
    var costLimit by rememberSaveable { mutableStateOf("") }
    var pickProvider by remember { mutableStateOf(false) }
    var savingSettings by remember { mutableStateOf(false) }
    var testingSettings by remember { mutableStateOf(false) }
    var testSummary by remember { mutableStateOf<String?>(null) }

    fun loadSettingsState() {
        scope.launch {
            loadingSettings = true
            try {
                val s = vm.aiSettings()
                settingsDto = s
                aiEnabled = s.enabled
                provider = s.provider.orEmpty()
                model = s.model.orEmpty()
                baseUrl = s.baseUrl.orEmpty()
                apiKey = ""
                tokenLimit = s.monthlyTokenLimit?.toString().orEmpty()
                costLimit = s.monthlyCostLimit.orEmpty()
            } catch (e: Exception) {
                vm.showNoticeDanger(vm.friendlyError(e))
            } finally {
                loadingSettings = false
            }
        }
    }

    LaunchedEffect(Unit) {
        runCatching { suggestions = vm.aiSuggestions() }
        runCatching { conversations = vm.aiConversations() }
        if (showSettings) loadSettingsState()
    }

    LaunchedEffect(showSettings) {
        if (showSettings && settingsDto == null) loadSettingsState()
    }

    fun sendPrompt(text: String) {
        val clean = text.trim()
        if (clean.isEmpty() || sending) return
        draft = ""
        messages.add(UiChatTurn("u-${System.currentTimeMillis()}", "user", clean))
        sending = true
        scope.launch {
            try {
                val res = vm.aiChat(clean, conversationId)
                if (res.conversationId.isNotBlank()) conversationId = res.conversationId
                messages.add(
                    UiChatTurn(
                        "a-${System.currentTimeMillis()}",
                        "assistant",
                        res.text.ifBlank { "لم يصل نصّ إجابةٍ من المزوّد." },
                    ),
                )
                runCatching { conversations = vm.aiConversations() }
            } catch (e: Exception) {
                val msg = vm.friendlyError(e)
                messages.add(UiChatTurn("err-${System.currentTimeMillis()}", "assistant", "تعذّر إكمال الإجابة: $msg"))
            } finally {
                sending = false
            }
        }
    }

    // رجوعٌ سليم: من شاشة الإعدادات يعود إلى المحادثة إن فُتح من داخلها.
    BackHandler(enabled = showSettings && !startInSettings) {
        showSettings = false
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            if (showSettings) "إعدادات المساعد الذكي" else "المساعد الذكي AI",
                            fontWeight = FontWeight.ExtraBold,
                        )
                        if (!showSettings) {
                            Text(
                                "تحليلٌ فوريّ لمجاميع منشأتك وإرشادُ الاستخدام",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(
                        onClick = {
                            if (showSettings && !startInSettings) showSettings = false
                            else onBack()
                        },
                    ) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع")
                    }
                },
                actions = {
                    if (!showSettings) {
                        IconButton(
                            onClick = {
                                conversationId = null
                                messages.clear()
                                messages.add(UiChatTurn("welcome", "assistant", greeting))
                            },
                        ) {
                            Icon(Icons.Default.Add, contentDescription = "محادثة جديدة")
                        }
                        if (conversations.isNotEmpty()) {
                            IconButton(onClick = { showHistoryPicker = true }) {
                                Icon(Icons.Default.History, contentDescription = "المحادثات السابقة")
                            }
                        }
                        if (canManageSettings) {
                            IconButton(onClick = { showSettings = true }) {
                                Icon(Icons.Default.Settings, contentDescription = "إعدادات الذكاء الاصطناعي")
                            }
                        }
                    }
                },
            )
        },
    ) { padding ->
        if (showSettings) {
            Column(
                Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (loadingSettings && settingsDto == null) {
                    CenterLoading("جارٍ قراءة إعدادات الذكاء الاصطناعي…")
                } else {
                    settingsDto?.let { current ->
                        if (current.platformSuspended) {
                            InfoCallout("أوقف مشغّلُ المنصّة خدمةَ الذكاء الاصطناعيّ مؤقّتًا لهذه المنشأة.", ChipTone.WARN)
                        }
                        SectionCard(title = "حالة الخدمة والاستهلاك الشهريّ") {
                            KeyValue("المزوّد الفعّال حاليًّا", current.effectiveProvider)
                            KeyValue("النموذج الفعّال حاليًّا", current.effectiveModel)
                            KeyValue(
                                "استهلاك الشهر (${current.usage.period.ifBlank { "الحالي" }})",
                                "${current.usage.tokens} توكن · ${current.usage.spent} $",
                            )
                            if (current.hasTenantApiKey) {
                                StatusChip("مفتاح API خاصّ بالمنشأة محفوظ (${current.apiKeyMasked ?: "••••"})", ChipTone.OK)
                            } else if (current.hasPlatformKey) {
                                StatusChip("يعمل بمفتاح المنصّة الافتراضيّ", ChipTone.INFO)
                            }
                        }
                    }

                    SectionCard(title = "ربط المزوّد والنموذج (AI API)") {
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text("تفعيل المساعد الذكيّ في المنشأة", fontWeight = FontWeight.Bold)
                                Text(
                                    "إتاحة المحادثة والتنبيهات الذكيّة للمستخدمين المخوّلين",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Switch(checked = aiEnabled, onCheckedChange = { aiEnabled = it })
                        }
                        Spacer(Modifier.height(10.dp))
                        val providerLabel = AI_PROVIDERS.firstOrNull { it.first == provider }?.second ?: provider
                        OutlinedTextField(
                            value = providerLabel,
                            onValueChange = {},
                            readOnly = true,
                            interactionSource = rememberPickerInteractionSource { pickProvider = true },
                            label = { Text("مزوّد الذكاء الاصطناعي") },
                            trailingIcon = { PickerTrigger(onClick = { pickProvider = true }) },
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Spacer(Modifier.height(8.dp))
                        OutlinedTextField(
                            value = model,
                            onValueChange = { model = it },
                            label = { Text("اسم النموذج (Model) — اتركه فارغًا للافتراضيّ") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        val activeProvKey = provider.ifBlank { settingsDto?.effectiveProvider ?: "openai" }
                        val suggested = MODEL_SUGGESTIONS[activeProvKey].orEmpty()
                        if (suggested.isNotEmpty()) {
                            Spacer(Modifier.height(6.dp))
                            Row(
                                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                suggested.forEach { m ->
                                    FilterChip(
                                        selected = model == m,
                                        onClick = { model = m },
                                        label = { Text(m) },
                                    )
                                }
                            }
                        }
                        if (provider == "custom") {
                            Spacer(Modifier.height(8.dp))
                            OutlinedTextField(
                                value = baseUrl,
                                onValueChange = { baseUrl = it },
                                label = { Text("رابط الخدمة المتوافقة مع OpenAI (Base URL)") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        Spacer(Modifier.height(8.dp))
                        OutlinedTextField(
                            value = apiKey,
                            onValueChange = { apiKey = it },
                            label = { Text("مفتاح API جديد (اتركه فارغًا للإبقاء على المحفوظ)") },
                            visualTransformation = PasswordVisualTransformation(),
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        if (settingsDto?.hasTenantApiKey == true) {
                            TextButton(
                                onClick = {
                                    savingSettings = true
                                    scope.launch {
                                        val body = buildJsonObject {
                                            put("enabled", aiEnabled)
                                            if (provider.isBlank()) put("provider", JsonNull) else put("provider", provider)
                                            if (model.isBlank()) put("model", JsonNull) else put("model", model.trim())
                                            put("clearApiKey", true)
                                        }
                                        when (val res = vm.updateAiSettings(body)) {
                                            is ActionResult.Synced -> {
                                                vm.showNoticeOk("حُذف مفتاح API الخاصّ بالمنشأة.")
                                                loadSettingsState()
                                            }
                                            is ActionResult.Refused -> vm.showNoticeDanger(res.messageAr)
                                            is ActionResult.Offline -> vm.showNoticeWarn(res.messageAr)
                                        }
                                        savingSettings = false
                                    }
                                },
                            ) {
                                Text("حذف مفتاح API المحفوظ للمنشأة", color = MaterialTheme.colorScheme.error)
                            }
                        }
                    }

                    SectionCard(title = "سقف الاستهلاك الشهريّ (اختياري)") {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(
                                value = tokenLimit,
                                onValueChange = { tokenLimit = it.filter { ch -> ch.isDigit() } },
                                label = { Text("الحدّ الشهري للتوكن") },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                singleLine = true,
                                modifier = Modifier.weight(1f),
                            )
                            OutlinedTextField(
                                value = costLimit,
                                onValueChange = { costLimit = it },
                                label = { Text("سقف التكلفة ($)") },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                singleLine = true,
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }

                    if (testSummary != null) {
                        InfoCallout(testSummary.orEmpty(), ChipTone.OK)
                    }

                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilledTonalButton(
                            onClick = {
                                testingSettings = true
                                testSummary = null
                                scope.launch {
                                    try {
                                        val res = vm.testAiSettings()
                                        testSummary = "نجح فحص الاتصال (${res.provider} · ${res.model} · ${res.latencyMs}ms): ${res.reply}"
                                    } catch (e: Exception) {
                                        vm.showNoticeDanger(vm.friendlyError(e))
                                    } finally {
                                        testingSettings = false
                                    }
                                }
                            },
                            enabled = !testingSettings && !savingSettings,
                            modifier = Modifier.weight(1f).height(50.dp),
                        ) {
                            Text(if (testingSettings) "جارٍ الفحص…" else "فحص الاتصال")
                        }
                        Button(
                            onClick = {
                                savingSettings = true
                                scope.launch {
                                    val body = buildJsonObject {
                                        put("enabled", aiEnabled)
                                        if (provider.isBlank()) put("provider", JsonNull) else put("provider", provider)
                                        if (model.trim().isBlank()) put("model", JsonNull) else put("model", model.trim())
                                        if (baseUrl.trim().isBlank()) put("baseUrl", JsonNull) else put("baseUrl", baseUrl.trim())
                                        if (apiKey.trim().isNotBlank()) put("apiKey", apiKey.trim())
                                        val parsedTokens = tokenLimit.trim().toLongOrNull()
                                        if (parsedTokens == null) put("monthlyTokenLimit", JsonNull) else put("monthlyTokenLimit", parsedTokens)
                                        if (costLimit.trim().isBlank()) put("monthlyCostLimit", JsonNull) else put("monthlyCostLimit", costLimit.trim())
                                    }
                                    when (val res = vm.updateAiSettings(body)) {
                                        is ActionResult.Synced -> {
                                            vm.showNoticeOk("حُفظت إعدادات المساعد الذكيّ بنجاح.")
                                            loadSettingsState()
                                        }
                                        is ActionResult.Refused -> vm.showNoticeDanger(res.messageAr)
                                        is ActionResult.Offline -> vm.showNoticeWarn(res.messageAr)
                                    }
                                    savingSettings = false
                                }
                            },
                            enabled = !savingSettings,
                            modifier = Modifier.weight(1.3f).height(50.dp),
                        ) {
                            Text(if (savingSettings) "جارٍ الحفظ…" else "حفظ الإعدادات", fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
            if (pickProvider) {
                PickerDialog(
                    title = "اختر مزوّد الذكاء الاصطناعي",
                    items = AI_PROVIDERS.map { (id, label) -> PickerItem(id, label) },
                    onDismiss = { pickProvider = false },
                    onSelect = { provider = it.id; pickProvider = false },
                )
            }
            return@Scaffold
        }

        Column(Modifier.fillMaxSize().padding(padding)) {
            // شريط الاقتراحات والأسئلة السريعة
            Row(
                Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                QUICK_PROMPTS.forEach { prompt ->
                    FilterChip(
                        selected = false,
                        onClick = { sendPrompt(prompt) },
                        leadingIcon = {
                            Icon(Icons.Default.AutoAwesome, contentDescription = null, Modifier.size(16.dp))
                        },
                        label = { Text(prompt) },
                    )
                }
                if (canManageSettings) {
                    OutlinedButton(onClick = { showSettings = true }) {
                        Icon(Icons.Default.Settings, contentDescription = null, Modifier.size(16.dp))
                        Spacer(Modifier.size(4.dp))
                        Text("الإعدادات")
                    }
                }
            }
            HorizontalDivider()

            LazyColumn(
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = PaddingValues(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (suggestions.isNotEmpty() && messages.size <= 1) {
                    item {
                        SectionCard(title = "تنبيهات واقتراحات ذكيّة لمنشأتك") {
                            suggestions.take(3).forEach { s ->
                                Text(s.title, fontWeight = FontWeight.ExtraBold)
                                Text(
                                    s.body,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Spacer(Modifier.height(6.dp))
                            }
                        }
                    }
                }

                items(messages, key = { it.id }) { turn ->
                    val isUser = turn.role == "user"
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = if (isUser) Arrangement.Start else Arrangement.End,
                    ) {
                        Surface(
                            shape = RoundedCornerShape(16.dp),
                            color = if (isUser) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.7f)
                            },
                            border = if (isUser) null else BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                            modifier = Modifier.fillMaxWidth(0.92f),
                        ) {
                            Column(Modifier.padding(13.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(
                                    if (isUser) "أنت" else "المساعد الذكي AI",
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.ExtraBold,
                                    color = if (isUser) MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.85f)
                                    else MaterialTheme.colorScheme.primary,
                                )
                                Text(
                                    turn.content,
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = if (isUser) MaterialTheme.colorScheme.onPrimary
                                    else MaterialTheme.colorScheme.onSurface,
                                )
                            }
                        }
                    }
                }

                if (sending) {
                    item {
                        StatusChip("المساعد الذكيّ يحلّل البيانات ويكتب الإجابة…", ChipTone.INFO)
                    }
                }
            }

            HorizontalDivider()
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    placeholder = { Text("اسأل المساعد الذكي عن المبيعات أو المخزون أو النظام…") },
                    modifier = Modifier.weight(1f),
                    maxLines = 4,
                )
                Button(
                    onClick = { sendPrompt(draft) },
                    enabled = !sending && draft.trim().isNotEmpty(),
                    modifier = Modifier.height(54.dp),
                ) {
                    Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "إرسال")
                }
            }
        }
    }

    if (showHistoryPicker) {
        PickerDialog(
            title = "المحادثات السابقة",
            items = conversations.map {
                PickerItem(
                    id = it.id,
                    title = it.title.ifBlank { "محادثة سابقة" },
                    subtitle = (it.updatedAt ?: it.updated_at)?.take(16)?.replace('T', ' '),
                )
            },
            onDismiss = { showHistoryPicker = false },
            onSelect = { picked ->
                showHistoryPicker = false
                scope.launch {
                    try {
                        val stored = vm.aiConversation(picked.id)
                        conversationId = stored.id
                        messages.clear()
                        stored.messages
                            .filter { it.role == "user" || it.role == "assistant" }
                            .forEachIndexed { idx, m ->
                                messages.add(UiChatTurn("h-$idx", m.role, m.content))
                            }
                        if (messages.isEmpty()) {
                            messages.add(UiChatTurn("welcome", "assistant", greeting))
                        }
                    } catch (e: Exception) {
                        vm.showNoticeDanger(vm.friendlyError(e))
                    }
                }
            },
        )
    }
}
