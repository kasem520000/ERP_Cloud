package com.erpcloud.bakery.ui

import android.app.Application
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.erpcloud.bakery.AppContainer
import com.erpcloud.bakery.BakeryApp
import com.erpcloud.bakery.data.ActionResult
import com.erpcloud.bakery.data.BakeryRepository
import com.erpcloud.bakery.data.api.ApiException
import com.erpcloud.bakery.data.api.DashboardDto
import com.erpcloud.bakery.data.api.ItemOptionDto
import com.erpcloud.bakery.data.api.MeResponse
import com.erpcloud.bakery.data.api.NotificationDto
import com.erpcloud.bakery.data.api.PartyDto
import com.erpcloud.bakery.data.api.ReportsPayloadDto
import com.erpcloud.bakery.data.api.SalesmanCardDto
import com.erpcloud.bakery.data.api.ShortagePolicyDto
import com.erpcloud.bakery.data.api.WarehouseOptionDto
import com.erpcloud.bakery.data.api.AccountDto
import com.erpcloud.bakery.data.api.AdjustmentDto
import com.erpcloud.bakery.data.api.AdjustmentTypeDto
import com.erpcloud.bakery.data.api.BomDto
import com.erpcloud.bakery.data.api.BranchDto
import com.erpcloud.bakery.data.api.CashLocationDto
import com.erpcloud.bakery.data.api.CatalogItemDto
import com.erpcloud.bakery.data.api.CatalogItemDto
import com.erpcloud.bakery.data.api.CategoryDto
import com.erpcloud.bakery.data.api.DepartmentDto
import com.erpcloud.bakery.data.api.EmployeeDto
import com.erpcloud.bakery.data.api.EmployeeStatementDto
import com.erpcloud.bakery.data.api.ItemCardDto
import com.erpcloud.bakery.data.api.JobDto
import com.erpcloud.bakery.data.api.MembershipDto
import com.erpcloud.bakery.data.api.PayrollRunDto
import com.erpcloud.bakery.data.api.PermissionDto
import com.erpcloud.bakery.data.api.PosCheckoutReceiptDto
import com.erpcloud.bakery.data.api.PosOfflineDataDto
import com.erpcloud.bakery.data.api.PartyBalanceDto
import com.erpcloud.bakery.data.api.PurchaseInvoiceDto
import com.erpcloud.bakery.data.api.ReportCatalogEntryDto
import com.erpcloud.bakery.data.api.ReportResultDto
import com.erpcloud.bakery.data.api.RoleDto
import com.erpcloud.bakery.data.api.SalaryPaymentDto
import com.erpcloud.bakery.data.api.SalesRegistryDto
import com.erpcloud.bakery.data.api.StockAdjustmentDto
import com.erpcloud.bakery.data.api.StockLevelDto
import com.erpcloud.bakery.data.api.StockMovementDto
import com.erpcloud.bakery.data.api.StockVoucherDto
import com.erpcloud.bakery.data.api.TreasuryVoucherDto
import com.erpcloud.bakery.data.api.UnitDto
import com.erpcloud.bakery.data.offline.SavedCredentials
import com.erpcloud.bakery.data.offline.SessionState
import com.erpcloud.bakery.ui.components.Notice
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import java.io.IOException

/**
 * حالةُ الواجهةِ الواحدةُ المشتركة — لوحةُ الخدمة هي مصدرُ كلّ شاشة، والبحثُ
 * (الأصناف/المستودعات/العملاء) يُحمَّل مرّةً بعد الدخول ويُعاد عند الفشل فقط.
 */
data class UiState(
    val sessionLoaded: Boolean = false,
    val session: SessionState = SessionState(),
    val me: MeResponse? = null,
    val dashboard: DashboardDto? = null,
    val loadingDashboard: Boolean = false,
    val dashboardError: String? = null,
    val salesmen: List<SalesmanCardDto> = emptyList(),
    val loadingSalesmen: Boolean = false,
    val items: List<ItemOptionDto> = emptyList(),
    val warehouses: List<WarehouseOptionDto> = emptyList(),
    val parties: List<PartyDto> = emptyList(),
    val lookupsError: String? = null,
    val policy: ShortagePolicyDto? = null,
    val reports: ReportsPayloadDto? = null,
    val loadingReports: Boolean = false,
    val reportsError: String? = null,
    val online: Boolean = true,
    val notifications: NotificationsState = NotificationsState(),
    /** وحداتُ «الطاقم» — كلُّ شاشةٍ تُحمَّل عند فتحها (لا مسبقًا) وتحفظ نتيجتها هنا. */
    val staff: StaffState = StaffState(),
) {
    fun can(permission: String): Boolean = me?.can(permission) == true

    /** شارةُ الجرس — من نافذة إشعارات المنشأة (tenant.notification.view). */
    val notificationsUnread: Int get() = notifications.unread

    /** هل يطلب الخادمُ من هذا الحساب تغييرَ كلمة مروره؟ */
    val mustChangePassword: Boolean get() = me?.user?.mustChangePassword == true

    /** المستودعُ الرئيسي كما تقوله اللوحة (لا يُخترع مستودع). */
    val mainWarehouse: WarehouseOptionDto?
        get() = warehouses.firstOrNull { it.id == dashboard?.mainWarehouseId }
            ?: warehouses.firstOrNull { it.isDefault == true }
}

/** حالةُ صندوق الإشعارات. */
data class NotificationsState(
    val loading: Boolean = false,
    val unreadOnly: Boolean = false,
    val items: List<NotificationDto> = emptyList(),
    val unread: Int = 0,
    val total: Int = 0,
    val error: String? = null,
)

/**
 * حالةُ وحدات «الطاقم» (الكتالوج/المشتريات/السندات/نقطة البيع/الموارد البشريّة/
 * المنظّمة/التقارير) — شاشةٌ واحدة لكلّ وظيفة، وكلٌّ منها تحملُ تحميلها وخطأها.
 */
data class StaffState(
    // الكتالوج
    val categories: List<CategoryDto> = emptyList(),
    val units: List<UnitDto> = emptyList(),
    val catalogItems: List<CatalogItemDto> = emptyList(),
    // الفروع والخزائن والمورّدون
    val branches: List<BranchDto> = emptyList(),
    val cashLocations: List<CashLocationDto> = emptyList(),
    val suppliers: List<PartyDto> = emptyList(),
    // المشتريات
    val purchaseInvoices: List<PurchaseInvoiceDto> = emptyList(),
    // السندات المخزنيّة
    val vouchers: List<StockVoucherDto> = emptyList(),
    // نقطة البيع
    val posData: PosOfflineDataDto? = null,
    // قوائمُ الموادّ (BOM)
    val boms: List<BomDto> = emptyList(),
    // الموارد البشريّة
    val employees: List<EmployeeDto> = emptyList(),
    val departments: List<DepartmentDto> = emptyList(),
    val jobs: List<JobDto> = emptyList(),
    val adjustmentTypes: List<AdjustmentTypeDto> = emptyList(),
    val adjustments: List<AdjustmentDto> = emptyList(),
    val payrollRuns: List<PayrollRunDto> = emptyList(),
    val salaryPayments: List<SalaryPaymentDto> = emptyList(),
    // المنظّمة
    val salesRegistry: List<SalesRegistryDto> = emptyList(),
    val memberships: List<MembershipDto> = emptyList(),
    val assignableRoles: List<RoleDto> = emptyList(),
    val roles: List<RoleDto> = emptyList(),
    val permissions: List<PermissionDto> = emptyList(),
    // التقارير
    val reportCatalog: List<ReportCatalogEntryDto> = emptyList(),
    // نتيجةُ آخر كشف حساب موظف / تشغيل تقرير (تُقرأ عند الطلب)
    val employeeStatement: EmployeeStatementDto? = null,
    val reportResult: ReportResultDto? = null,
    // الخزينة والمصروفات
    val treasuryVouchers: List<TreasuryVoucherDto> = emptyList(),
    val accounts: List<AccountDto> = emptyList(),
    // المخزون والأرصدة
    val stockLevels: List<StockLevelDto> = emptyList(),
    val stockMovements: List<StockMovementDto> = emptyList(),
    val itemCard: ItemCardDto? = null,
    val countAdjustments: List<StockAdjustmentDto> = emptyList(),
    // الأطراف (عملاء/موردون حسب المرشّح)
    val parties: List<PartyDto> = emptyList(),
    val partyBalance: PartyBalanceDto? = null,
    // حالةُ التحميل والخطأ المشتركة (شاشةٌ تُحمَّل في كلّ مرة تُفتح)
    val loadingKey: String? = null,
    val error: String? = null,
)

/**
 * نموذجُ العرضِ الواحد — القاعدةُ: بعد أيّ إجراءٍ ناجحٍ تُعاد قراءةُ اللوحة
 * (لا أرقامَ تُحسب في العميل)، ورسائلُ الرفع حرفيّةٌ من الخادم.
 */
class AppViewModel(application: Application) : AndroidViewModel(application) {

    // AndroidViewModel.application خاصٌّ — الوصولُ الرسميّ عبر getApplication<Application>().
    private val container: AppContainer
        get() = (getApplication<Application>() as BakeryApp).container
    private val repo: BakeryRepository get() = container.repository
    private val appContext: Application get() = getApplication()

    private val _uiState = MutableStateFlow(UiState())
    val uiState: StateFlow<UiState> = _uiState

    private val _notice = MutableStateFlow<Notice?>(null)
    val notice: StateFlow<Notice?> = _notice

    private var lastLoggedIn: Boolean = false
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    init {
        viewModelScope.launch {
            container.sessionStore.state.collect { session ->
                val becameLoggedIn = session.loggedIn && !lastLoggedIn
                lastLoggedIn = session.loggedIn
                _uiState.update { it.copy(session = session, sessionLoaded = true) }
                if (becameLoggedIn) bootstrap()
            }
        }
        viewModelScope.launch {
            container.sessionEvents.expired.collect {
                _notice.value = Notice.warn("انتهت الجلسة — سجّل الدخول من جديد.")
            }
        }
        registerOnlineWatcher()
    }

    // ------------------------------------------------------------ الشبكة

    private fun registerOnlineWatcher() {
        val manager =
            getApplication<Application>().getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                ?: return
        fun currentOnline(): Boolean = manager.activeNetwork != null
        _uiState.update { it.copy(online = currentOnline()) }
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                _uiState.update { it.copy(online = currentOnline()) }
            }

            override fun onLost(network: Network) {
                _uiState.update { it.copy(online = currentOnline()) }
            }
        }
        networkCallback = callback
        try {
            manager.registerNetworkCallback(
                NetworkRequest.Builder()
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .build(),
                callback,
            )
        } catch (_: Exception) {
            // بعضُ الأجهزة بلا شبكةٍ أصلًا — يبقى الوضعُ الأخير.
        }
    }

    override fun onCleared() {
        val manager =
            getApplication<Application>().getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        networkCallback?.let { callback ->
            try {
                manager?.unregisterNetworkCallback(callback)
            } catch (_: Exception) {
                // تجاهُل.
            }
        }
        super.onCleared()
    }

    // ------------------------------------------------------------ الدخول والجلسة

    /** يُرجعُ نصَّ الخطأ أو null عند النجاح. */
    suspend fun login(server: String, email: String, password: String, tenantCode: String, mfaCode: String): String? {
        return try {
            repo.login(server, email, password, tenantCode, mfaCode)
            null
        } catch (error: ApiException) {
            error.userMessage
        } catch (error: IOException) {
            "تعذّر الوصول إلى الخادم — تحقّق من العنوان والشبكة"
        } catch (error: Exception) {
            error.message ?: "تعذّر تسجيل الدخول"
        }
    }

    val savedCredentials: SavedCredentials?
        get() = container.credentialStore.credentials

    var biometricEnabled: Boolean
        get() = container.credentialStore.biometricEnabled
        set(value) {
            container.credentialStore.biometricEnabled = value
        }

    fun rememberCredentials(email: String, tenantCode: String, password: String, remember: Boolean) {
        if (remember) {
            container.credentialStore.save(SavedCredentials(email, tenantCode, password))
        } else {
            container.credentialStore.clear()
        }
    }

    suspend fun loginSaved(): String? {
        val saved = savedCredentials ?: return "لا بياناتِ دخولٍ محفوظة — سجّل الدخول يدويًّا مرّةً واحدة."
        return login(
            server = _uiState.value.session.serverUrl,
            email = saved.email,
            password = saved.password,
            tenantCode = saved.tenantCode,
            mfaCode = "",
        )
    }

    fun forgetSavedAccount() {
        container.credentialStore.clear()
    }

    fun changePassword(current: String, new: String, onDone: (ActionResult) -> Unit) {
        viewModelScope.launch {
            val result = repo.changePassword(current, new)
            if (result is ActionResult.Synced) {
                if (savedCredentials != null) container.credentialStore.updatePassword(new)
                repo.logout()
                _notice.value = Notice.ok("غُيّرت كلمةُ المرور وأُبطلت كلُّ الجلسات — سجّل الدخول بكلمتك الجديدة.")
            }
            onDone(result)
        }
    }

    fun logout() {
        viewModelScope.launch {
            repo.logout()
        }
    }

    // ------------------------------------------------------------ التهيئة بعد الدخول

    /** الهويّةُ ثمّ اللوحةُ والمناديبُ والبحثُ — كلٌّ على حدة، فشلُ أحدها لا يُسقط البقية. */
    fun bootstrap() {
        viewModelScope.launch {
            try {
                val me = repo.me()
                _uiState.update { it.copy(me = me) }
                if (!me.can("van_sales.view")) {
                    _notice.value = Notice.warn(
                        "حسابُك لا يحمل إذنَ van_sales.view — لوحةُ التوزيع لن تفتح لك حتى يمنحَه المحاسب."
                    )
                }
            } catch (error: Exception) {
                _notice.value = Notice.warn(friendly(error))
            }
        }
        refreshDashboard()
        refreshSalesmen()
        refreshLookups()
    }

    // ------------------------------------------------------------ القراءات

    /** لوحةُ الخطّ — تُعاد بعد كلّ إجراءٍ ناجح فلا رقمَ يُحسب في العميل. */
    fun refreshDashboard() {
        viewModelScope.launch {
            _uiState.update { it.copy(loadingDashboard = true, dashboardError = null) }
            try {
                val dashboard = repo.dashboard()
                _uiState.update { it.copy(dashboard = dashboard, loadingDashboard = false) }
            } catch (error: Exception) {
                _uiState.update { it.copy(loadingDashboard = false, dashboardError = friendly(error)) }
            }
        }
    }

    fun refreshSalesmen() {
        viewModelScope.launch {
            _uiState.update { it.copy(loadingSalesmen = true) }
            try {
                val salesmen = repo.salesmen()
                _uiState.update { it.copy(salesmen = salesmen, loadingSalesmen = false) }
            } catch (error: Exception) {
                _uiState.update { it.copy(loadingSalesmen = false) }
                // ليست قاتلة: شاشةُ المناديب تُظهر خطأها عند فتحها.
            }
        }
    }

    /** البحثُ المشترك: أصنافٌ ومستودعاتٌ وعملاء — مرّةً واحدة، وصامتُ الأخطاء يُقال في شاشاته. */
    fun refreshLookups() {
        viewModelScope.launch {
            try {
                val items = repo.catalogItems()
                _uiState.update { it.copy(items = items) }
            } catch (_: Exception) {
            }
        }
        viewModelScope.launch {
            try {
                val warehouses = repo.warehouses()
                _uiState.update { it.copy(warehouses = warehouses) }
            } catch (_: Exception) {
            }
        }
        viewModelScope.launch {
            try {
                val parties = repo.parties()
                _uiState.update { it.copy(parties = parties) }
            } catch (_: Exception) {
            }
        }
    }

    fun refreshPolicy(salesmanId: String? = null) {
        viewModelScope.launch {
            try {
                val policy = repo.policy(salesmanId)
                _uiState.update { it.copy(policy = policy) }
            } catch (error: Exception) {
                _notice.value = Notice.warn(friendly(error))
            }
        }
    }

    fun refreshReports(salesmanId: String?, fromDate: String?, toDate: String?) {
        viewModelScope.launch {
            _uiState.update { it.copy(loadingReports = true, reportsError = null) }
            try {
                val reports = repo.reports(salesmanId, fromDate, toDate)
                _uiState.update { it.copy(reports = reports, loadingReports = false) }
            } catch (error: Exception) {
                _uiState.update { it.copy(loadingReports = false, reportsError = friendly(error)) }
            }
        }
    }

    // ------------------------------------------------------------ الإجراءات

    /**
     * قاعدةُ كلّ إجراء: يُنفَّذ، ثمّ عند النجاح تُعاد قراءةُ اللوحة (والمناديب
     * عند إجراءاتهم)، والنتيجةُ تُعرض كما هي — رسالةُ الخادم حرفيًّا.
     */
    private fun runAction(
        action: suspend () -> ActionResult,
        refreshSalesmen: Boolean = false,
        onDone: (ActionResult) -> Unit = {},
    ) {
        viewModelScope.launch {
            val result = action()
            if (result is ActionResult.Synced) {
                refreshDashboard()
                if (refreshSalesmen) refreshSalesmen()
            }
            when (result) {
                is ActionResult.Synced -> _notice.value = Notice.ok(result.messageAr)
                is ActionResult.Refused -> _notice.value = Notice.danger(result.messageAr)
                is ActionResult.Offline -> _notice.value = Notice.warn(result.messageAr)
            }
            onDone(result)
        }
    }

    fun createProductionBatch(body: JsonObject, onDone: (ActionResult) -> Unit = {}) =
        runAction({ repo.createProductionBatch(body) }, onDone = onDone)

    fun createLoadOrder(body: JsonObject, onDone: (ActionResult) -> Unit = {}) =
        runAction({ repo.createLoadOrder(body) }, refreshSalesmen = true, onDone = onDone)

    fun upsertCustomerPrice(body: JsonObject, onDone: (ActionResult) -> Unit = {}) =
        runAction({ repo.upsertCustomerPrice(body) }, onDone = onDone)

    fun collectCustomerDebt(body: JsonObject, onDone: (ActionResult) -> Unit = {}) =
        runAction({ repo.collectCustomerDebt(body) }, onDone = onDone)

    fun confirmReceipt(loadOrderId: String, body: JsonObject, onDone: (ActionResult) -> Unit = {}) =
        runAction({ repo.confirmReceipt(loadOrderId, body) }, refreshSalesmen = true, onDone = onDone)

    fun rejectReceipt(loadOrderId: String, body: JsonObject, onDone: (ActionResult) -> Unit = {}) =
        runAction({ repo.rejectReceipt(loadOrderId, body) }, refreshSalesmen = true, onDone = onDone)

    fun cancelLoadOrder(loadOrderId: String, body: JsonObject, onDone: (ActionResult) -> Unit = {}) =
        runAction({ repo.cancelLoadOrder(loadOrderId, body) }, refreshSalesmen = true, onDone = onDone)

    fun closeTransitDifference(loadOrderId: String, body: JsonObject, onDone: (ActionResult) -> Unit = {}) =
        runAction({ repo.closeTransitDifference(loadOrderId, body) }, onDone = onDone)

    fun submitClosing(loadOrderId: String, body: JsonObject, onDone: (ActionResult) -> Unit = {}) =
        runAction({ repo.submitClosing(loadOrderId, body) }, onDone = onDone)

    fun approveClosing(loadOrderId: String, body: JsonObject, onDone: (ActionResult) -> Unit = {}) =
        runAction({ repo.approveClosing(loadOrderId, body) }, refreshSalesmen = true, onDone = onDone)

    fun settleStock(loadOrderId: String, body: JsonObject, onDone: (ActionResult) -> Unit = {}) =
        runAction({ repo.settleStock(loadOrderId, body) }, refreshSalesmen = true, onDone = onDone)

    fun updatePolicy(body: JsonObject, onDone: (ActionResult) -> Unit = {}) =
        runAction({ repo.updatePolicy(body) }, onDone = onDone)

    /** ربطُ المندوب بحساب دخول — إيصالُ الخادم يُعرض كما هو. */
    fun linkSalesmanAccount(salesmanId: String, body: JsonObject, onDone: (String?) -> Unit) {
        viewModelScope.launch {
            try {
                val receipt = repo.linkSalesmanAccount(salesmanId, body)
                refreshSalesmen()
                _notice.value = Notice.ok(
                    "رُبط حسابُ ${receipt.salesmanName} بالبريد ${receipt.email}" +
                        (if (receipt.activationRequired) " — الحسابُ جديدٌ: أُرسل رابطُ التفعيل وبكلمةٍ مؤقّتة يُطلب تغييرها." else ".")
                )
                onDone(null)
            } catch (error: Exception) {
                onDone(friendly(error))
            }
        }
    }

    /** مفتاحُ النيّة — نيّةٌ واحدةٌ مفتاحٌ واحد (يُحفظ نصًّا في الشاشة). */
    fun ensureIdempotencyKey(prefix: String, body: JsonObject, existingKey: String?): JsonObject =
        repo.ensureIdempotencyKey(prefix, body, existingKey)

    // ============================================================ وحدات «الطاقم»

    /**
     * قاعدةُ تحميل شاشات الطاقم: تُحمَّل عند الفتح (لا مسبقًا)، والخطأُ يبقى في
     * الشاشة نفسها — فشلُ شاشةٍ لا يُسقط غيرها.
     */
    private fun loadStaff(key: String, update: suspend (StaffState) -> StaffState) {
        viewModelScope.launch {
            _uiState.update { it.copy(staff = it.staff.copy(loadingKey = key, error = null)) }
            try {
                val patched = update(_uiState.value.staff)
                _uiState.update { it.copy(staff = patched.copy(loadingKey = null)) }
            } catch (error: Exception) {
                _uiState.update {
                    it.copy(staff = it.staff.copy(loadingKey = null, error = friendly(error)))
                }
            }
        }
    }

    fun loadCatalog() = loadStaff("catalog") { s ->
        s.copy(
            categories = repo.catalogCategories(),
            units = repo.catalogUnits(),
            catalogItems = repo.catalogItemsFull(),
        )
    }

    fun loadPurchases() = loadStaff("purchases") { s ->
        s.copy(
            purchaseInvoices = repo.purchaseInvoices(),
            suppliers = repo.parties("supplier"),
            branches = if (s.branches.isEmpty()) repo.branches() else s.branches,
        )
    }

    fun loadVouchers(kind: String? = null) = loadStaff("vouchers") { s ->
        s.copy(
            vouchers = repo.stockVouchers(kind),
            branches = if (s.branches.isEmpty()) repo.branches() else s.branches,
        )
    }

    fun loadPos() = loadStaff("pos") { s ->
        s.copy(posData = repo.posOfflineData())
    }

    fun loadBoms() = loadStaff("boms") { s ->
        s.copy(boms = repo.boms())
    }

    fun loadEmployees() = loadStaff("employees") { s ->
        s.copy(
            employees = repo.employees(),
            departments = repo.departments(),
            jobs = repo.jobs(),
            branches = if (s.branches.isEmpty()) repo.branches() else s.branches,
        )
    }

    fun loadAdjustments() = loadStaff("adjustments") { s ->
        s.copy(
            adjustments = repo.adjustments(),
            adjustmentTypes = repo.adjustmentTypes(),
            employees = if (s.employees.isEmpty()) repo.employees() else s.employees,
        )
    }

    fun loadPayroll() = loadStaff("payroll") { s ->
        s.copy(
            payrollRuns = repo.payrollRuns(),
            branches = if (s.branches.isEmpty()) repo.branches() else s.branches,
            cashLocations = if (s.cashLocations.isEmpty()) repo.cashLocations() else s.cashLocations,
        )
    }

    fun loadSalaryPayments() = loadStaff("salary-payments") { s ->
        s.copy(salaryPayments = repo.salaryPayments())
    }

    fun loadSalesRegistry() = loadStaff("sales-registry") { s ->
        s.copy(salesRegistry = repo.salesRegistry())
    }

    fun loadUsers() = loadStaff("users") { s ->
        s.copy(
            memberships = repo.memberships(),
            assignableRoles = repo.assignableRoles(),
        )
    }

    fun loadRoles() = loadStaff("roles") { s ->
        s.copy(
            roles = repo.roles(),
            permissions = if (s.permissions.isEmpty()) repo.permissions() else s.permissions,
        )
    }

    fun loadReportCatalog() = loadStaff("report-catalog") { s ->
        s.copy(reportCatalog = repo.reportCatalog())
    }

    // ------------------------------------------------------------ إجراءات الطاقم

    private fun staffAction(label: String, action: suspend () -> ActionResult, onDone: (ActionResult) -> Unit = {}) {
        viewModelScope.launch {
            val result = action()
            when (result) {
                is ActionResult.Synced -> _notice.value = Notice.ok(result.messageAr)
                is ActionResult.Refused -> _notice.value = Notice.danger(result.messageAr)
                is ActionResult.Offline -> _notice.value = Notice.warn(result.messageAr)
            }
            onDone(result)
        }
    }

    fun createSupplier(body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("supplier", { repo.createParty(body) }, onDone)
    }

    fun createCategory(body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("category", { repo.createCategory(body) }, onDone)
    }

    fun createUnit(body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("unit", { repo.createUnit(body) }, onDone)
    }

    fun createCatalogItem(body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("item", { repo.createCatalogItem(body) }, onDone)
    }

    fun createPurchaseInvoice(body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("purchase", { repo.createPurchaseInvoice(body) }, onDone)
    }

    fun postPurchaseInvoice(id: String, body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("purchase-post", { repo.postPurchaseInvoice(id, body) }, onDone)
    }

    fun createStockVoucher(body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("voucher", { repo.createStockVoucher(body) }, onDone)
    }

    fun postStockVoucher(id: String, body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("voucher-post", { repo.postStockVoucher(id, body) }, onDone)
    }

    /** إتمامُ بيعة نقطة البيع — يُرجعُ الإيصالَ أو خطأً نصيًّا. */
    fun posCheckout(body: JsonObject, onDone: (PosCheckoutReceiptDto?) -> Unit) {
        viewModelScope.launch {
            try {
                val receipt = repo.posCheckout(body)
                _notice.value = Notice.ok("تمّت البيعة — فاتورة ${receipt.number}.")
                onDone(receipt)
            } catch (error: Exception) {
                _notice.value = Notice.danger(friendly(error))
                onDone(null)
            }
        }
    }

    fun createEmployee(body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("employee", { repo.createEmployee(body) }, onDone)
    }

    fun createAdjustment(body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("adjustment", { repo.createAdjustment(body) }, onDone)
    }

    fun approveAdjustment(id: String, onDone: (ActionResult) -> Unit) {
        staffAction("adjustment-approve", { repo.approveAdjustment(id) }, onDone)
    }

    fun createPayrollRun(body: JsonObject, onDone: (ActionResult) -> Unit) {
        viewModelScope.launch {
            try {
                val run = repo.createPayrollRun(body)
                _notice.value = Notice.ok("أُنشئ مسيّر رواتب ${run.yearMonth} (${run.status}).")
                onDone(ActionResult.Synced("created"))
            } catch (error: Exception) {
                _notice.value = Notice.danger(friendly(error))
                onDone(ActionResult.Refused(friendly(error)))
            }
        }
    }

    fun postPayrollRun(id: String, body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("payroll-post", { repo.postPayrollRun(id, body) }, onDone)
    }

    fun payPayrollRun(id: String, body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("payroll-pay", { repo.payPayrollRun(id, body) }, onDone)
    }

    fun createSalaryPayment(body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("salary-payment", { repo.createSalaryPayment(body) }, onDone)
    }

    fun createSalesRegistry(body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("salesman", { repo.createSalesRegistry(body) }, onDone)
    }

    fun createMembership(body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("membership", { repo.inviteMembership(body) }, onDone)
    }

    fun createRole(body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("role", { repo.createRole(body) }, onDone)
    }

    /** كشفُ حساب موظف — يُحمَّل في `staff.employeeStatement` (الفترةُ الكاملة تجعلُ من/إلى تُهملان). */
    fun employeeStatement(employeeId: String, from: String, to: String, fullPeriod: Boolean) =
        loadStaff("employee-statement") { s ->
            s.copy(employeeStatement = repo.employeeStatement(employeeId, from, to, fullPeriod))
        }

    /** تشغيلُ تقريرٍ بمدخلاته — النتيجةُ في `staff.reportResult` والخطأُ في `staff.error`. */
    fun runReport(key: String, params: JsonObject) = loadStaff("report-$key") { s ->
        s.copy(reportResult = repo.runReport(key, params))
    }

    // ---------------------------------------------- الخزينة والمصروفات

    fun loadTreasury() = loadStaff("treasury") { s ->
        s.copy(
            treasuryVouchers = repo.treasuryVouchers(),
            cashLocations = if (s.cashLocations.isEmpty()) repo.cashLocations() else s.cashLocations,
            branches = if (s.branches.isEmpty()) repo.branches() else s.branches,
        )
    }

    fun loadAccounts() = loadStaff("accounts") { s ->
        s.copy(accounts = repo.accounts())
    }

    fun createTreasuryVoucher(body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("voucher", { repo.createTreasuryVoucher(body) }, onDone)
    }

    fun postTreasuryVoucher(id: String, body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("voucher-post", { repo.postTreasuryVoucher(id, body) }, onDone)
    }

    // ---------------------------------------------- المخزون والأرصدة

    fun loadStockLevels(warehouseId: String? = null) = loadStaff("levels") { s ->
        s.copy(stockLevels = repo.stockLevels(warehouseId))
    }

    fun loadStockMovements(itemId: String?, warehouseId: String?, from: String?, to: String?) =
        loadStaff("movements") { s ->
            s.copy(stockMovements = repo.stockMovements(itemId, warehouseId, from, to))
        }

    fun loadItemCard(itemId: String, warehouseId: String?, from: String?, to: String?) =
        loadStaff("item-card") { s ->
            s.copy(itemCard = repo.itemCard(itemId, warehouseId, from, to))
        }

    fun loadCountAdjustments() = loadStaff("counts") { s ->
        s.copy(
            countAdjustments = repo.stockAdjustments(),
            branches = if (s.branches.isEmpty()) repo.branches() else s.branches,
        )
    }

    fun createStockAdjustment(body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("count", { repo.createStockAdjustment(body) }, onDone)
    }

    fun postStockAdjustment(id: String, body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("count-post", { repo.postStockAdjustment(id, body) }, onDone)
    }

    // ---------------------------------------------- الأطراف وكشوفها

    /** قائمةُ الأطراف — kind: customer أو supplier. */
    fun loadParties(kind: String = "customer") = loadStaff("parties") { s ->
        s.copy(parties = repo.parties(kind))
    }

    /** رصيدُ طرفٍ وقيودُه المفتوحة — عند الطلب (لمرةٍ لكلّ طرفٍ مفتوح). */
    fun loadPartyBalance(partyId: String) = loadStaff("party-balance") { s ->
        s.copy(partyBalance = repo.partyBalance(partyId))
    }

    fun createParty(body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("party", { repo.createParty(body) }, onDone)
    }

    // ------------------------------------------------------------ الإشعارات

    fun refreshNotifications(unreadOnly: Boolean) {
        viewModelScope.launch {
            _uiState.update { it.copy(notifications = it.notifications.copy(loading = true, unreadOnly = unreadOnly, error = null)) }
            try {
                val page = repo.notifications(unreadOnly)
                _uiState.update {
                    it.copy(
                        notifications = it.notifications.copy(
                            loading = false,
                            items = page.data,
                            unread = page.meta.unread,
                            total = page.meta.total,
                        )
                    )
                }
            } catch (error: Exception) {
                _uiState.update {
                    it.copy(
                        notifications = it.notifications.copy(
                            loading = false,
                            error = friendly(error),
                        )
                    )
                }
            }
        }
    }

    fun markNotificationRead(id: String) {
        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    notifications = it.notifications.copy(
                        items = it.notifications.items.map { n ->
                            if (n.id == id) n.copy(readAt = n.readAt ?: "local") else n
                        },
                        unread = (it.notifications.unread - 1).coerceAtLeast(0),
                    )
                )
            }
            repo.markNotificationRead(id)
        }
    }

    fun markAllNotificationsRead() {
        val unread = _uiState.value.notifications.items.filter { !it.isRead }
        if (unread.isEmpty()) return
        unread.forEach { markNotificationRead(it.id) }
    }

    // ------------------------------------------------------------ أدوات

    fun setPrinter(mac: String, widthDots: Int) {
        viewModelScope.launch {
            container.sessionStore.setPrinter(mac, widthDots)
            _notice.value = Notice.ok("حُفظت الطابعة.")
        }
    }

    fun consumeNotice() {
        _notice.value = null
    }

    /** سياقُ التطبيق للطباعة والإشعارات (ESC/POS يحتاج Context). */
    fun androidContext(): Application = getApplication()

    /** خطأُ طباعةٍ يُقال كما هو (بلوتوث/اتصال/جهاز). */
    fun showPrintError(messageAr: String) {
        _notice.value = Notice.danger(messageAr)
    }

    private fun friendly(error: Exception): String = when (error) {
        is ApiException -> error.userMessage
        is IOException -> "لم يصل الطلب إلى الخادم — تحقّق من الشبكة وعنوان الخادم"
        else -> error.message ?: "تعذّر إكمال الطلب"
    }
}
