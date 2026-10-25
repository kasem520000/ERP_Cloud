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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.SupportAgent
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.erpcloud.bakery.data.api.PublicFaqDto
import com.erpcloud.bakery.data.api.PublicHelpPostDto
import com.erpcloud.bakery.data.api.SupportTicketDto
import com.erpcloud.bakery.ui.AppViewModel
import com.erpcloud.bakery.ui.components.CenterLoading
import com.erpcloud.bakery.ui.components.ChipTone
import com.erpcloud.bakery.ui.components.EmptyState
import com.erpcloud.bakery.ui.components.InfoCallout
import com.erpcloud.bakery.ui.components.KeyValue
import com.erpcloud.bakery.ui.components.ListItemCard
import com.erpcloud.bakery.ui.components.PickerDialog
import com.erpcloud.bakery.ui.components.PickerItem
import com.erpcloud.bakery.ui.components.PickerTrigger
import com.erpcloud.bakery.ui.components.SearchField
import com.erpcloud.bakery.ui.components.SectionCard
import com.erpcloud.bakery.ui.components.StatusChip
import com.erpcloud.bakery.ui.components.rememberPickerInteractionSource
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private val SUPPORT_CATEGORIES = listOf(
    "محاسبة وقيود",
    "المخزون والمستودعات",
    "المبيعات ونقطة البيع (POS)",
    "الفوترة الإلكترونية (ZATCA)",
    "توزيع المناديب والمخابز",
    "الموارد البشرية وتطبيق الموظف",
    "استفسار عام / اقتراح",
)

private val PRIORITY_OPTIONS = listOf(
    "low" to "منخفضة",
    "normal" to "عادية",
    "high" to "عالية",
    "urgent" to "عاجلة",
)

private fun ticketStatusLabel(status: String): Pair<String, ChipTone> = when (status) {
    "open" -> "مفتوحة — بانتظار الدعم" to ChipTone.INFO
    "pending" -> "تم الرد — بانتظارك" to ChipTone.WARN
    "resolved" -> "تم الحل" to ChipTone.OK
    "closed" -> "مغلقة" to ChipTone.NEUTRAL
    else -> status to ChipTone.NEUTRAL
}

private fun priorityLabel(priority: String): Pair<String, ChipTone> = when (priority) {
    "urgent" -> "عاجلة" to ChipTone.DANGER
    "high" -> "عالية" to ChipTone.WARN
    "low" -> "منخفضة" to ChipTone.NEUTRAL
    else -> "عادية" to ChipTone.INFO
}

/**
 * شاشةُ طلب المساعدة والدعم الفنيّ — تذاكرُ الدعم مع المحادثات والردود،
 * ومقالاتُ مركز المساعدة، والأسئلةُ الشائعة.
 */
@Composable
fun SupportScreen(vm: AppViewModel, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()

    var tab by rememberSaveable { mutableStateOf("tickets") }
    var showCreate by rememberSaveable { mutableStateOf(false) }
    var selectedTicketId by rememberSaveable { mutableStateOf<String?>(null) }

    var tickets by remember { mutableStateOf<List<SupportTicketDto>>(emptyList()) }
    var selectedDetail by remember { mutableStateOf<SupportTicketDto?>(null) }
    var helpPosts by remember { mutableStateOf<List<PublicHelpPostDto>>(emptyList()) }
    var faqs by remember { mutableStateOf<List<PublicFaqDto>>(emptyList()) }
    var helpQuery by rememberSaveable { mutableStateOf("") }

    var loading by remember { mutableStateOf(true) }
    var loadingDetail by remember { mutableStateOf(false) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    // حقول إنشاء تذكرة جديدة
    var subject by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf(SUPPORT_CATEGORIES.first()) }
    var priority by rememberSaveable { mutableStateOf("normal") }
    var body by rememberSaveable { mutableStateOf("") }
    var pickCategory by remember { mutableStateOf(false) }
    var submitting by remember { mutableStateOf(false) }

    // حقل الرد على تذكرة قائمة
    var replyText by rememberSaveable { mutableStateOf("") }
    var sendingReply by remember { mutableStateOf(false) }

    fun reloadAll() {
        scope.launch {
            loading = true
            errorMsg = null
            try {
                tickets = vm.supportTickets()
            } catch (e: Exception) {
                errorMsg = vm.friendlyError(e)
            }
            runCatching { helpPosts = vm.publicHelp(helpQuery.takeIf { it.isNotBlank() }) }
            runCatching { faqs = vm.publicFaq() }
            loading = false
        }
    }

    LaunchedEffect(Unit) { reloadAll() }

    LaunchedEffect(selectedTicketId) {
        val id = selectedTicketId
        if (id == null) {
            selectedDetail = null
            return@LaunchedEffect
        }
        loadingDetail = true
        try {
            selectedDetail = vm.supportTicketDetail(id)
        } catch (e: Exception) {
            vm.showNoticeDanger(vm.friendlyError(e))
        } finally {
            loadingDetail = false
        }
    }

    // رجوعٌ متدرّج سليم: النموذج/التفصيل يعود إلى قائمة التذاكر لا إلى الرئيسيّة.
    val inSubView = showCreate || selectedTicketId != null
    BackHandler(enabled = inSubView) {
        if (showCreate) showCreate = false
        else selectedTicketId = null
    }

    val topTitle = when {
        showCreate -> "فتح تذكرة دعم جديدة"
        selectedTicketId != null -> "تفاصيل تذكرة الدعم"
        else -> "طلب المساعدة والدعم"
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(topTitle, fontWeight = FontWeight.ExtraBold) },
                navigationIcon = {
                    IconButton(
                        onClick = {
                            when {
                                showCreate -> showCreate = false
                                selectedTicketId != null -> selectedTicketId = null
                                else -> onBack()
                            }
                        },
                    ) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع")
                    }
                },
                actions = {
                    if (!inSubView) {
                        IconButton(onClick = { reloadAll() }) {
                            Icon(Icons.Default.Refresh, contentDescription = "تحديث")
                        }
                    }
                },
            )
        },
        floatingActionButton = {
            if (!inSubView && tab == "tickets") {
                FloatingActionButton(onClick = { showCreate = true }) {
                    Icon(Icons.Default.Add, contentDescription = "تذكرة جديدة")
                }
            }
        },
    ) { padding ->
        if (showCreate) {
            Column(
                Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                InfoCallout(
                    "اشرح المشكلة أو الاستفسار بوضوح، وسيصلك ردّ فريق الدعم الفني في نفس التذكرة.",
                    ChipTone.INFO,
                )
                SectionCard(title = "بيانات طلب المساعدة") {
                    OutlinedTextField(
                        value = subject,
                        onValueChange = { subject = it },
                        label = { Text("عنوان المشكلة أو الطلب *") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = category,
                        onValueChange = {},
                        readOnly = true,
                        interactionSource = rememberPickerInteractionSource { pickCategory = true },
                        label = { Text("التصنيف *") },
                        trailingIcon = { PickerTrigger(onClick = { pickCategory = true }) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(10.dp))
                    Text("الأولوية", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                    Row(
                        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        PRIORITY_OPTIONS.forEach { (code, label) ->
                            FilterChip(
                                selected = priority == code,
                                onClick = { priority = code },
                                label = { Text(label) },
                            )
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = body,
                        onValueChange = { body = it },
                        label = { Text("تفاصيل المشكلة أو الاستفسار *") },
                        minLines = 5,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = { showCreate = false },
                        modifier = Modifier.weight(1f).height(50.dp),
                    ) { Text("رجوع") }
                    Button(
                        onClick = {
                            if (subject.trim().length < 3 || body.trim().length < 5) {
                                vm.showNoticeDanger("يرجى كتابة عنوان واضح وتفاصيل كافية للطلب.")
                                return@Button
                            }
                            submitting = true
                            scope.launch {
                                try {
                                    val payload = buildJsonObject {
                                        put("subject", subject.trim())
                                        put("category", category)
                                        put("priority", priority)
                                        put("body", body.trim())
                                    }
                                    val created = vm.createSupportTicket(payload)
                                    subject = ""
                                    body = ""
                                    showCreate = false
                                    vm.showNoticeOk("تم إرسال تذكرة الدعم بنجاح.")
                                    reloadAll()
                                    if (created.id.isNotBlank()) selectedTicketId = created.id
                                } catch (e: Exception) {
                                    vm.showNoticeDanger(vm.friendlyError(e))
                                } finally {
                                    submitting = false
                                }
                            }
                        },
                        enabled = !submitting,
                        modifier = Modifier.weight(1.4f).height(50.dp),
                    ) {
                        Text(if (submitting) "جارٍ الإرسال…" else "إرسال طلب الدعم", fontWeight = FontWeight.Bold)
                    }
                }
            }
            if (pickCategory) {
                PickerDialog(
                    title = "اختر تصنيف الطلب",
                    items = SUPPORT_CATEGORIES.map { PickerItem(it, it) },
                    onDismiss = { pickCategory = false },
                    onSelect = { category = it.title; pickCategory = false },
                )
            }
            return@Scaffold
        }

        if (selectedTicketId != null) {
            val detail = selectedDetail
            Column(
                Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (loadingDetail && detail == null) {
                    CenterLoading("جارٍ تحميل المحادثة…")
                } else if (detail == null) {
                    EmptyState("تعذّر تحميل تفاصيل التذكرة.")
                } else {
                    val (stLabel, stTone) = ticketStatusLabel(detail.status)
                    val (prLabel, prTone) = priorityLabel(detail.priority)
                    SectionCard(title = detail.subject) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            StatusChip(stLabel, stTone)
                            StatusChip("الأولوية: $prLabel", prTone)
                        }
                        Spacer(Modifier.height(6.dp))
                        detail.category?.takeIf { it.isNotBlank() }?.let { KeyValue("التصنيف", it) }
                        KeyValue("تاريخ الفتح", detail.createdAt.take(16).replace('T', ' '))
                    }

                    LazyColumn(
                        modifier = Modifier.weight(1f).fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(detail.messages, key = { it.id.ifBlank { it.createdAt + it.body.hashCode() } }) { msg ->
                            val isSupport = msg.authorKind == "operator" || msg.authorKind == "system"
                            Surface(
                                shape = RoundedCornerShape(14.dp),
                                color = if (isSupport) {
                                    MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.55f)
                                } else {
                                    MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f)
                                },
                                border = BorderStroke(
                                    1.dp,
                                    if (isSupport) MaterialTheme.colorScheme.primary.copy(alpha = 0.35f)
                                    else MaterialTheme.colorScheme.outlineVariant,
                                ),
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Row(
                                        Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Text(
                                            msg.authorLabel?.takeIf { it.isNotBlank() }
                                                ?: if (isSupport) "فريق الدعم الفني" else "أنت",
                                            style = MaterialTheme.typography.labelLarge,
                                            fontWeight = FontWeight.ExtraBold,
                                            color = if (isSupport) MaterialTheme.colorScheme.primary
                                            else MaterialTheme.colorScheme.onSurface,
                                        )
                                        Text(
                                            msg.createdAt.take(16).replace('T', ' '),
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                    Text(msg.body, style = MaterialTheme.typography.bodyMedium)
                                }
                            }
                        }
                    }

                    if (detail.status != "closed") {
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            OutlinedTextField(
                                value = replyText,
                                onValueChange = { replyText = it },
                                placeholder = { Text("اكتب ردًّا أو توضيحًا…") },
                                modifier = Modifier.weight(1f),
                                maxLines = 4,
                            )
                            Button(
                                onClick = {
                                    val clean = replyText.trim()
                                    if (clean.isEmpty()) return@Button
                                    sendingReply = true
                                    scope.launch {
                                        try {
                                            val updated = vm.replySupportTicket(
                                                detail.id,
                                                buildJsonObject { put("body", clean) },
                                            )
                                            replyText = ""
                                            selectedDetail = updated
                                            vm.showNoticeOk("أُرسل ردّك بنجاح.")
                                        } catch (e: Exception) {
                                            vm.showNoticeDanger(vm.friendlyError(e))
                                        } finally {
                                            sendingReply = false
                                        }
                                    }
                                },
                                enabled = !sendingReply && replyText.trim().isNotEmpty(),
                                modifier = Modifier.height(54.dp),
                            ) {
                                Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "إرسال")
                            }
                        }
                    }
                }
            }
            return@Scaffold
        }

        Column(Modifier.fillMaxSize().padding(padding)) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                FilterChip(
                    selected = tab == "tickets",
                    onClick = { tab = "tickets" },
                    label = { Text("تذاكر الدعم (${tickets.size})") },
                )
                FilterChip(
                    selected = tab == "help",
                    onClick = { tab = "help" },
                    label = { Text("أدلّة الاستخدام") },
                )
                FilterChip(
                    selected = tab == "faq",
                    onClick = { tab = "faq" },
                    label = { Text("الأسئلة الشائعة") },
                )
            }
            HorizontalDivider()

            when (tab) {
                "tickets" -> {
                    LazyColumn(
                        Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(14.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        item {
                            Button(
                                onClick = { showCreate = true },
                                modifier = Modifier.fillMaxWidth().height(50.dp),
                            ) {
                                Icon(Icons.Default.SupportAgent, contentDescription = null, Modifier.size(20.dp))
                                Spacer(Modifier.size(8.dp))
                                Text("فتح طلب مساعدة جديد", fontWeight = FontWeight.ExtraBold)
                            }
                        }
                        if (errorMsg != null) {
                            item { InfoCallout(errorMsg.orEmpty(), ChipTone.DANGER) }
                        }
                        if (loading && tickets.isEmpty()) {
                            item { CenterLoading("جارٍ جلب تذاكر الدعم…") }
                        } else if (tickets.isEmpty()) {
                            item { EmptyState("لا تذاكر دعمٍ مفتوحة بعد — اضغط «فتح طلب مساعدة جديد» للتواصل مع الدعم.") }
                        } else {
                            items(tickets, key = { it.id }) { ticket ->
                                val (stLabel, stTone) = ticketStatusLabel(ticket.status)
                                val (prLabel, prTone) = priorityLabel(ticket.priority)
                                ListItemCard(onClick = { selectedTicketId = ticket.id }) {
                                    Row(
                                        Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Text(
                                            ticket.subject,
                                            style = MaterialTheme.typography.titleMedium,
                                            fontWeight = FontWeight.ExtraBold,
                                            modifier = Modifier.weight(1f),
                                        )
                                        StatusChip(stLabel, stTone)
                                    }
                                    Spacer(Modifier.height(4.dp))
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        ticket.category?.takeIf { it.isNotBlank() }?.let {
                                            StatusChip(it, ChipTone.NEUTRAL)
                                        }
                                        StatusChip("الأولوية: $prLabel", prTone)
                                    }
                                    Spacer(Modifier.height(4.dp))
                                    KeyValue("آخر تحديث", ticket.updatedAt.take(16).replace('T', ' '))
                                }
                            }
                        }
                    }
                }

                "help" -> {
                    Column(Modifier.fillMaxSize().padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        SearchField(
                            value = helpQuery,
                            onValueChange = { q ->
                                helpQuery = q
                                scope.launch {
                                    runCatching { helpPosts = vm.publicHelp(q.takeIf { it.isNotBlank() }) }
                                }
                            },
                            placeholder = "ابحث في مقالات المساعدة…",
                        )
                        LazyColumn(
                            Modifier.fillMaxSize(),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            if (helpPosts.isEmpty()) {
                                item { EmptyState("لا مقالات مطابقة حاليًّا — يمكنك فتح تذكرة دعم مباشر.") }
                            } else {
                                items(helpPosts, key = { it.slug.ifBlank { it.titleAr } }) { post ->
                                    SectionCard(title = post.titleAr) {
                                        post.category?.takeIf { it.isNotBlank() }?.let {
                                            StatusChip(it, ChipTone.INFO)
                                            Spacer(Modifier.height(6.dp))
                                        }
                                        Text(
                                            post.summaryAr?.takeIf { it.isNotBlank() } ?: "دليل إرشاديّ من مركز المساعدة.",
                                            style = MaterialTheme.typography.bodyMedium,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                "faq" -> {
                    LazyColumn(
                        Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(14.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        if (faqs.isEmpty()) {
                            item { EmptyState("لا أسئلة شائعة منشورة بعد.") }
                        } else {
                            items(faqs, key = { it.slug.ifBlank { it.question } }) { faq ->
                                SectionCard(title = faq.question) {
                                    Text(faq.answer, style = MaterialTheme.typography.bodyMedium)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
