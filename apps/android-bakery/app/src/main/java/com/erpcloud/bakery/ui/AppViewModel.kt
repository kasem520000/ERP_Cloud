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
import com.erpcloud.bakery.data.api.CompanyProfileDto
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
import com.erpcloud.bakery.data.api.PurchaseInvoiceDetailDto
import com.erpcloud.bakery.data.api.ReportCatalogEntryDto
import com.erpcloud.bakery.data.api.ReportResultDto
import com.erpcloud.bakery.data.api.RoleDto
import com.erpcloud.bakery.data.api.SalaryPaymentDto
import com.erpcloud.bakery.data.api.SalesInvoiceDto
import com.erpcloud.bakery.data.api.SalesInvoiceDetailDto
import com.erpcloud.bakery.data.api.SalesRegistryDto
import com.erpcloud.bakery.data.api.StockAdjustmentDto
import com.erpcloud.bakery.data.api.StockLevelDto
import com.erpcloud.bakery.data.api.StockMovementDto
import com.erpcloud.bakery.data.api.StockVoucherDto
import com.erpcloud.bakery.data.api.TaxGroupDto
import com.erpcloud.bakery.data.api.TreasuryVoucherDto
import com.erpcloud.bakery.data.api.UnitDto
import com.erpcloud.bakery.data.offline.SavedCredentials
import com.erpcloud.bakery.data.offline.SessionState
import com.erpcloud.bakery.ui.components.Notice
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.put
import java.io.IOException
import java.time.LocalDate

/**
 * مبيعاتُ المنشأةِ **اليوم** من كلِّ قنواتِ البيعِ (كاشيرُ نقطةِ البيع + الفواتيرُ
 * المكتبيّة + مبيعاتُ المناديبِ المرتبطةُ بفواتيرَ رسميّة) — كما تحسبُها بطاقاتُ
 * تقريرِ «فواتير المبيعات» عند الخادمِ من `sales_invoices` و`invoice_payments`
 * نفسِها، فلا تُشتقُّ في الجهازِ من نافذةٍ جزئيّة، وتتحدّثُ فورَ ترحيلِ أيّ بيعة.
 *
 * - [net]: الصافي (الإجماليُّ شاملُ الضريبة) — `s_net`.
 * - [cash]/[network]: ما حُصِّل اليومَ نقديًا/شبكةً — `s_cash`/`s_network`.
 * - [paid]: المدفوعُ من مبيعاتِ اليوم — `s_paid`؛ والآجلُ = net − paid.
 * - [daily]: سلسلةُ آخر ٧ أيّام (يوم ← إجمالي) من تقريرِ «مبيعات حسب اليوم».
 */
data class HomeSales(
    val net: java.math.BigDecimal,
    val cash: java.math.BigDecimal,
    val network: java.math.BigDecimal,
    val paid: java.math.BigDecimal,
    val daily: List<Pair<String, java.math.BigDecimal>> = emptyList(),
) {
    /** الذممُ الآجلةُ من مبيعاتِ اليوم — ما لم يُسدَّد بعدُ من صافيها. */
    val credit: java.math.BigDecimal get() = net.subtract(paid).max(java.math.BigDecimal.ZERO)
}

/**
 * حالةُ الواجهةِ الواحدةُ المشتركة — لوحةُ الخدمة هي مصدرُ كلّ شاشة، والبحثُ
 * (الأصناف/المستودعات/العملاء) يُحمَّل مرّةً بعد الدخول ويُعاد عند الفشل فقط.
 */
data class UiState(
    val sessionLoaded: Boolean = false,
    val splashDone: Boolean = false,
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
    val loadingLookups: Boolean = false,
    val lookupsError: String? = null,
    val policy: ShortagePolicyDto? = null,
    val reports: ReportsPayloadDto? = null,
    val loadingReports: Boolean = false,
    val reportsError: String? = null,
    val online: Boolean = true,
    val notifications: NotificationsState = NotificationsState(),
    /** وحداتُ «الطاقم» — كلُّ شاشةٍ تُحمَّل عند فتحها (لا مسبقًا) وتحفظ نتيجتها هنا. */
    val staff: StaffState = StaffState(),
    /** مبيعاتُ المنشأةِ اليوم (كلُّ القنوات: كاشير + فواتير + مناديب) — من تقارير الخادم. */
    val homeSales: HomeSales? = null,
    /** ملفُ المنشأة — الاسمُ والرقمُ الضريبيّ لوسومِ QR الزكاة (يُحمَّل مرّةً بعد الدخول). */
    val companyProfile: CompanyProfileDto? = null,
) {
    fun can(permission: String): Boolean = me?.can(permission) == true

    /** شارةُ الجرس — من نافذة إشعارات المنشأة (tenant.notification.view). */
    val notificationsUnread: Int get() = notifications.unread

    /** هل يطلب الخادمُ من هذا الحساب تغييرَ كلمة مروره؟ */
    val mustChangePassword: Boolean get() = me?.user?.mustChangePassword == true

    /**
     * قائمةُ الأصناف الموحّدة لكلّ منتقي أصناف في التطبيق — تدمج الكتالوج الكامل
     * (`staff.catalogItems`) و`items` وبيانات نقطة البيع (`posData`) وأرصدة اللوحة
     * الرسميّة (`officialStock`) بلا تكرار وبلا أصنافٍ محذوفة.
     */
    val effectiveItems: List<ItemOptionDto>
        get() = mergeItemOptionLists(
            staff.catalogItems.map { it.toItemOption() },
            items,
            staff.posData?.items?.map { it.toItemOption() }.orEmpty(),
            dashboard?.officialStock?.mapNotNull { row ->
                val id = row.itemId?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
                ItemOptionDto(id = id, nameAr = row.itemName)
            }.orEmpty(),
        )

    /** قائمةُ المستودعات الموحّدة عبر مختلف مصادر التطبيق. */
    val effectiveWarehouses: List<WarehouseOptionDto>
        get() {
            val map = LinkedHashMap<String, WarehouseOptionDto>()
            fun accept(w: WarehouseOptionDto) {
                if (w.id.isBlank() || !w.effectiveIsActive) return
                val prev = map[w.id]
                map[w.id] = if (prev == null) w else prev.copy(
                    code = prev.code ?: w.code,
                    name = prev.name ?: w.name,
                    nameAr = prev.nameAr ?: w.nameAr ?: w.nameArSnake,
                    isDefault = prev.isDefault ?: w.isDefault ?: w.isDefaultSnake,
                    branchId = prev.branchId ?: w.branchId ?: w.branchIdSnake,
                )
            }
            warehouses.forEach(::accept)
            staff.posData?.warehouses.orEmpty().forEach(::accept)
            dashboard?.officialStock?.forEach { row ->
                val wid = row.warehouseId?.takeIf { it.isNotBlank() } ?: return@forEach
                accept(WarehouseOptionDto(id = wid, nameAr = row.warehouseName))
            }
            return map.values.toList()
        }

    /** المستودعُ الرئيسي كما تقوله اللوحة (لا يُخترع مستودع). */
    val mainWarehouse: WarehouseOptionDto?
        get() = effectiveWarehouses.firstOrNull { it.id == dashboard?.mainWarehouseId }
            ?: effectiveWarehouses.firstOrNull { it.effectiveIsDefault }
}

internal fun mergeItemOptionLists(vararg lists: List<ItemOptionDto>): List<ItemOptionDto> {
    val map = LinkedHashMap<String, ItemOptionDto>()
    for (list in lists) {
        for (item in list) {
            if (!item.isUsable) continue
            val prev = map[item.id]
            map[item.id] = if (prev == null) item else prev.copy(
                sku = prev.sku?.takeIf { it.isNotBlank() } ?: item.sku,
                barcode = prev.barcode?.takeIf { it.isNotBlank() } ?: item.barcode,
                nameAr = prev.nameAr?.takeIf { it.isNotBlank() } ?: item.nameAr ?: item.nameArSnake,
                name = prev.name?.takeIf { it.isNotBlank() } ?: item.name,
                nameEn = prev.nameEn?.takeIf { it.isNotBlank() } ?: item.nameEn,
                kind = prev.kind?.takeIf { it.isNotBlank() } ?: item.kind,
                salePrice = prev.effectiveSalePrice ?: item.effectiveSalePrice,
                purchasePrice = prev.effectivePurchasePrice ?: item.effectivePurchasePrice,
                trackLot = prev.trackLot ?: item.trackLot,
                trackSerial = prev.trackSerial ?: item.trackSerial,
                taxGroupId = prev.effectiveTaxGroupId ?: item.effectiveTaxGroupId,
            )
        }
    }
    return map.values.toList()
}

internal fun mergeCatalogItemLists(
    existing: List<CatalogItemDto>,
    incoming: List<CatalogItemDto>,
): List<CatalogItemDto> {
    val map = LinkedHashMap<String, CatalogItemDto>()
    existing.forEach { if (it.id.isNotBlank() && it.deletedAt == null && it.active != false) map[it.id] = it }
    incoming.forEach {
        if (it.id.isBlank()) return@forEach
        if (it.deletedAt != null || it.active == false) {
            map.remove(it.id)
        } else {
            map[it.id] = it
        }
    }
    return map.values.toList()
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
    val taxGroups: List<TaxGroupDto> = emptyList(),
    val catalogItems: List<CatalogItemDto> = emptyList(),
    // الفروع والخزائن والمورّدون
    val branches: List<BranchDto> = emptyList(),
    val cashLocations: List<CashLocationDto> = emptyList(),
    val suppliers: List<PartyDto> = emptyList(),
    val customers: List<PartyDto> = emptyList(),
    // المشتريات
    val purchaseInvoices: List<PurchaseInvoiceDto> = emptyList(),
    val salesInvoices: List<SalesInvoiceDto> = emptyList(),
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
    // البطاقاتُ التفصيليّة للمستندات (المرحلة 2) — تُحمَّل عند الطلب وتُمسح عند الإغلاق
    val purchaseInvoiceDetail: PurchaseInvoiceDetailDto? = null,
    val salesInvoiceDetail: SalesInvoiceDetailDto? = null,
    val treasuryVoucherDetail: TreasuryVoucherDto? = null,
    val detailLoading: String? = null,
    val detailError: String? = null,
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
            val splashFloor = async { delay(1650L) }
            withTimeoutOrNull(2400L) { repo.fetchPublicSite() }
            splashFloor.await()
            _uiState.update { it.copy(splashDone = true) }
            // إن تأخّر الخادمُ عن مهلة الترحيب، أكمِل تحديثَ الاسم في الخلفيّة.
            repo.fetchPublicSite()
        }
        viewModelScope.launch {
            container.sessionStore.state.collect { session ->
                val becameLoggedIn = session.loggedIn && !lastLoggedIn
                val becameLoggedOut = !session.loggedIn && lastLoggedIn
                lastLoggedIn = session.loggedIn
                if (becameLoggedOut) {
                    _uiState.update {
                        UiState(
                            session = session,
                            sessionLoaded = true,
                            splashDone = it.splashDone,
                            online = it.online,
                        )
                    }
                } else {
                    _uiState.update { it.copy(session = session, sessionLoaded = true) }
                }
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
            "تعذّر الاتصال بالخدمة السحابية — تحقّق من اتصال الإنترنت وحاول مرّةً أخرى"
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
            var canVanSales = true
            try {
                val me = repo.me()
                _uiState.update { it.copy(me = me) }
                canVanSales = me.can("van_sales.view")
                // فصلُ الأدوار: عضويّةُ «مندوب ميدانيّ» (kind=rep) موطنُها تطبيقُ
                // المناديبِ المستقلُّ (android-rep) — عهدتُه وبيعُه وتحصيلُه وإقفالُه
                // هناك. هذا التطبيقُ لإدارةِ المخابز (مالك/محاسب/كاشير)؛ ندعو المندوبَ
                // إلى تطبيقه دون حجبِه (الخادمُ يفرضُ الأذونَ على كلّ مسارٍ على أيّ حال).
                if (me.membership.kind == "rep") {
                    _notice.value = Notice.warn(
                        "هذا حسابُ مندوبٍ ميدانيّ — عملُ اليوم (العهدةُ والبيعُ والتحصيلُ والإقفال) في تطبيقِ المناديبِ المستقلّ. تطبيقُ المخابز هذا لإدارةِ المنشأة."
                    )
                }
            } catch (error: Exception) {
                _notice.value = Notice.warn(friendly(error))
            }
            if (canVanSales) {
                refreshDashboard()
                refreshSalesmen()
            } else {
                refreshHomeSales()
            }
            refreshLookups()
            refreshNotificationBadge()
            loadCompanyProfile()
        }
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
        refreshHomeSales()
    }

    /**
     * مبيعاتُ المنشأةِ اليوم (نقدي/شبكة/آجل/الصافي) وسلسلةُ الأسبوع — من بطاقاتِ
     * تقريرِ الخادمِ الرسميِّ لا من نافذةٍ جزئيّة، فتدخلُ فيها بيعةُ الكاشيرِ
     * والفاتورةُ المكتبيّةُ ومبيعاتُ المندوبِ على السواء. تُستدعى مع اللوحةِ
     * وبعدَ كلّ إجراءِ بيعٍ ناجح (كاشير/فاتورة/مردود) فلا تنتظرُ سحبًا للتحديث.
     *
     * فشلُها **ليس قاتلًا** (كاشيرٌ بلا `reporting.view` مثلًا): تُعرضُ أرقامُ
     * التوزيعِ وحدها كما كانت.
     */
    fun refreshHomeSales() {
        viewModelScope.launch {
            try {
                val today = LocalDate.now().toString()
                val report = repo.runReport(
                    "sales-invoices-details",
                    kotlinx.serialization.json.buildJsonObject {
                        put("from", today)
                        put("to", today)
                        put("procType", "sale")
                    },
                )
                fun card(key: String) = com.erpcloud.bakery.util.Dec.orZero(
                    report.grandTotal.firstOrNull { it.key == key }?.amount,
                )
                val daily = try {
                    val week = repo.runReport(
                        "daily-sales",
                        kotlinx.serialization.json.buildJsonObject {
                            put("from", LocalDate.now().minusDays(6).toString())
                            put("to", today)
                        },
                    )
                    week.rows.mapNotNull { row ->
                        val day = row["day"]?.take(10)?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
                        val total = row["total"]?.let { com.erpcloud.bakery.util.Dec.parse(it) } ?: return@mapNotNull null
                        day to total
                    }
                } catch (_: Exception) {
                    emptyList()
                }
                _uiState.update {
                    it.copy(
                        homeSales = HomeSales(
                            net = card("s_net"),
                            cash = card("s_cash"),
                            network = card("s_network"),
                            paid = card("s_paid"),
                            daily = daily,
                        ),
                    )
                }
            } catch (_: Exception) {
                // بلا إذن التقارير أو خطأٍ عابر: تُعرض أرقامُ لوحةِ التوزيعِ كما كانت.
                _uiState.update { it.copy(homeSales = null) }
            }
        }
    }

    /** ملفُ المنشأة (اسمُ البائعِ ورقمُهُ الضريبيّ) — مرّةً واحدةً بعد الدخول، بصمتٍ عند الفشل. */
    fun loadCompanyProfile() {
        viewModelScope.launch {
            try {
                val profile = repo.companyProfile()
                _uiState.update { it.copy(companyProfile = profile) }
            } catch (_: Exception) {
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

    /** البحثُ المشترك: أصنافٌ ومستودعاتٌ وعملاء — يُحمَّل عند الدخول وعند الطلب في الشاشات. */
    fun refreshLookups() {
        ensureLookups(force = true)
    }

    /**
     * ضمانُ تحميل الأصناف والمستودعات والأطراف — مع مزامنةِ `items` و`staff.catalogItems`
     * والرجوعِ الاحتياطيّ إلى بيانات نقطة البيع إن تعذّر الكتالوج، وتسجيلِ رسالة الخطأ عند الفشل.
     */
    fun ensureLookups(force: Boolean = false) {
        val current = _uiState.value
        val needItems = force || current.effectiveItems.isEmpty()
        val needWarehouses = force || current.effectiveWarehouses.isEmpty()
        val needParties = force || current.parties.isEmpty()
        if (!needItems && !needWarehouses && !needParties) return

        viewModelScope.launch {
            _uiState.update { it.copy(loadingLookups = true, lookupsError = null) }
            var itemErr: String? = null
            if (needItems) {
                try {
                    val full = repo.catalogItemsFull()
                    _uiState.update { s ->
                        val mergedCatalog = mergeCatalogItemLists(s.staff.catalogItems, full)
                        val mergedOptions = mergeItemOptionLists(
                            mergedCatalog.map { it.toItemOption() },
                            s.items,
                            s.staff.posData?.items?.map { it.toItemOption() }.orEmpty(),
                        )
                        s.copy(
                            items = mergedOptions,
                            staff = s.staff.copy(catalogItems = mergedCatalog),
                        )
                    }
                } catch (error: Exception) {
                    itemErr = friendly(error)
                    // محاولةٌ احتياطيّةٌ من `pos/offline-data` إن كان الحساب يحمل `pos.view` فقط.
                    try {
                        val pos = repo.posOfflineData()
                        _uiState.update { s ->
                            s.copy(
                                items = mergeItemOptionLists(
                                    s.items,
                                    pos.items.map { it.toItemOption() },
                                ),
                                warehouses = if (s.warehouses.isEmpty()) pos.warehouses else s.warehouses,
                                staff = s.staff.copy(posData = s.staff.posData ?: pos),
                            )
                        }
                        if (pos.items.isNotEmpty()) itemErr = null
                    } catch (_: Exception) {
                    }
                }
            }
            if (needWarehouses) {
                try {
                    val warehouses = repo.warehouses()
                    _uiState.update { it.copy(warehouses = warehouses) }
                } catch (_: Exception) {
                }
            }
            if (needParties) {
                try {
                    val parties = repo.parties()
                    _uiState.update { it.copy(parties = parties) }
                } catch (_: Exception) {
                }
            }
            _uiState.update { s ->
                s.copy(
                    loadingLookups = false,
                    lookupsError = if (s.effectiveItems.isEmpty()) itemErr else null,
                )
            }
        }
    }

    /**
     * بحثٌ مباشرٌ في الخادم (`GET /organization/catalog/items?q=...`) لتجاوز سقف الـ 100 صنف
     * الأوّليّ في المنشآت كبيرة الكتالوج، مع دمج النتائج في `staff.catalogItems` و`items`.
     */
    fun searchItemsRemotely(rawQuery: String) {
        val q = rawQuery.trim()
        if (q.length < 2) return
        viewModelScope.launch {
            try {
                val matches = repo.catalogItemsFull(q)
                if (matches.isNotEmpty()) {
                    _uiState.update { s ->
                        val mergedCatalog = mergeCatalogItemLists(s.staff.catalogItems, matches)
                        val mergedOptions = mergeItemOptionLists(
                            mergedCatalog.map { it.toItemOption() },
                            s.items,
                            s.staff.posData?.items?.map { it.toItemOption() }.orEmpty(),
                        )
                        s.copy(
                            items = mergedOptions,
                            staff = s.staff.copy(catalogItems = mergedCatalog),
                        )
                    }
                }
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

    /** جلبُ فاتورةِ البيع للطباعة — نسختا العميل والمندوب كما في نافذة الويب. */
    fun fetchInvoiceForPrint(documentId: String, onReady: (com.erpcloud.bakery.data.api.PrintViewDto?) -> Unit) {
        viewModelScope.launch {
            val view = try {
                repo.printView(documentId)
            } catch (error: Exception) {
                _notice.value = Notice.danger(friendly(error))
                null
            }
            onReady(view)
        }
    }

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
                _uiState.update { prev ->
                    val syncedItems = mergeItemOptionLists(
                        patched.catalogItems.map { it.toItemOption() },
                        prev.items,
                        patched.posData?.items?.map { it.toItemOption() }.orEmpty(),
                    )
                    val syncedWarehouses = if (prev.warehouses.isEmpty() && patched.posData?.warehouses?.isNotEmpty() == true) {
                        patched.posData.warehouses
                    } else {
                        prev.warehouses
                    }
                    prev.copy(
                        items = syncedItems,
                        warehouses = syncedWarehouses,
                        lookupsError = if (syncedItems.isNotEmpty()) null else prev.lookupsError,
                        staff = patched.copy(loadingKey = null),
                    )
                }
            } catch (error: Exception) {
                _uiState.update {
                    it.copy(staff = it.staff.copy(loadingKey = null, error = friendly(error)))
                }
            }
        }
    }

    /** قائمةٌ مساعدةٌ اختياريّة — غيابُ إذنها (403) لا يُسقط الشاشةَ الأصليّة. */
    private suspend fun <T> optionalList(fallback: List<T>, block: suspend () -> List<T>): List<T> =
        try {
            block()
        } catch (_: Exception) {
            fallback
        }

    fun loadCatalog() = loadStaff("catalog") { s ->
        val me = _uiState.value.me
        s.copy(
            categories = if (me == null || me.can("catalog.category.view")) optionalList(s.categories) { repo.catalogCategories() } else s.categories,
            units = if (me == null || me.can("catalog.unit.view")) optionalList(s.units) { repo.catalogUnits() } else s.units,
            taxGroups = if (me == null || me.can("catalog.taxgroup.view")) optionalList(s.taxGroups) { repo.catalogTaxGroups() } else s.taxGroups,
            catalogItems = if (me == null || me.can("catalog.item.view")) repo.catalogItemsFull() else s.catalogItems,
        )
    }

    fun loadPurchases() {
        ensureLookups()
        loadStaff("purchases") { s ->
            s.copy(
                purchaseInvoices = repo.purchaseInvoices(),
                suppliers = optionalList(s.suppliers) { repo.parties("supplier") },
                branches = if (s.branches.isEmpty()) optionalList(s.branches) { repo.branches() } else s.branches,
                cashLocations = if (s.cashLocations.isEmpty()) optionalList(s.cashLocations) { repo.cashLocations() } else s.cashLocations,
                accounts = if (s.accounts.isEmpty()) optionalList(s.accounts) { repo.accounts() } else s.accounts,
                taxGroups = if (s.taxGroups.isEmpty()) optionalList(s.taxGroups) { repo.catalogTaxGroups() } else s.taxGroups,
                catalogItems = if (s.catalogItems.isEmpty()) optionalList(s.catalogItems) { repo.catalogItemsFull() } else s.catalogItems,
            )
        }
    }

    /** قراءةُ ركائزِ المنشأة — الفروعُ والخزائنُ في «الطاقم» والمستودعاتُ في جانبِ المخابز. */
    fun loadOrg() {
        loadStaff("org") { s ->
            val me = _uiState.value.me
            s.copy(
                branches = if (me == null || me.can("organization.branch.view")) optionalList(s.branches) { repo.branches() } else s.branches,
                cashLocations = if (me == null || me.can("organization.cashlocation.view")) optionalList(s.cashLocations) { repo.cashLocations() } else s.cashLocations,
            )
        }
        viewModelScope.launch {
            try {
                _uiState.update { it.copy(warehouses = repo.warehouses()) }
            } catch (_: Exception) {
            }
        }
    }

    fun loadSalesInvoices() {
        ensureLookups()
        loadStaff("sales-invoices") { s ->
            s.copy(
                salesInvoices = repo.salesInvoices(),
                customers = if (s.customers.isEmpty()) optionalList(s.customers) { repo.parties("customer") } else s.customers,
                branches = if (s.branches.isEmpty()) optionalList(s.branches) { repo.branches() } else s.branches,
                cashLocations = if (s.cashLocations.isEmpty()) optionalList(s.cashLocations) { repo.cashLocations() } else s.cashLocations,
                accounts = if (s.accounts.isEmpty()) optionalList(s.accounts) { repo.accounts() } else s.accounts,
                taxGroups = if (s.taxGroups.isEmpty()) optionalList(s.taxGroups) { repo.catalogTaxGroups() } else s.taxGroups,
                catalogItems = if (s.catalogItems.isEmpty()) optionalList(s.catalogItems) { repo.catalogItemsFull() } else s.catalogItems,
            )
        }
    }

    fun loadVouchers(kind: String? = null) {
        ensureLookups()
        loadStaff("vouchers") { s ->
            s.copy(
                vouchers = repo.stockVouchers(kind),
                branches = if (s.branches.isEmpty()) optionalList(s.branches) { repo.branches() } else s.branches,
                catalogItems = if (s.catalogItems.isEmpty()) optionalList(s.catalogItems) { repo.catalogItemsFull() } else s.catalogItems,
            )
        }
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
            departments = optionalList(s.departments) { repo.departments() },
            jobs = optionalList(s.jobs) { repo.jobs() },
            branches = if (s.branches.isEmpty()) optionalList(s.branches) { repo.branches() } else s.branches,
        )
    }

    fun loadAdjustments() = loadStaff("adjustments") { s ->
        s.copy(
            adjustments = repo.adjustments(),
            adjustmentTypes = optionalList(s.adjustmentTypes) { repo.adjustmentTypes() },
            employees = if (s.employees.isEmpty()) optionalList(s.employees) { repo.employees() } else s.employees,
            cashLocations = if (s.cashLocations.isEmpty()) optionalList(s.cashLocations) { repo.cashLocations() } else s.cashLocations,
        )
    }

    fun loadPayroll() = loadStaff("payroll") { s ->
        s.copy(
            payrollRuns = repo.payrollRuns(),
            salaryPayments = optionalList(s.salaryPayments) { repo.salaryPayments() },
            branches = if (s.branches.isEmpty()) optionalList(s.branches) { repo.branches() } else s.branches,
            cashLocations = if (s.cashLocations.isEmpty()) optionalList(s.cashLocations) { repo.cashLocations() } else s.cashLocations,
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
            assignableRoles = optionalList(s.assignableRoles) { repo.assignableRoles() },
        )
    }

    fun loadRoles() = loadStaff("roles") { s ->
        s.copy(
            roles = repo.roles(),
            permissions = if (s.permissions.isEmpty()) optionalList(s.permissions) { repo.permissions() } else s.permissions,
        )
    }

    fun loadReportCatalog() = loadStaff("report-catalog") { s ->
        s.copy(reportCatalog = repo.reportCatalog())
    }

    /** الفروعُ عند الطلب — لمحدِّدِ الفروع في التقارير والمستخدمين (لا تُحمَّل إلا مرّة). */
    fun ensureBranches() {
        if (_uiState.value.staff.branches.isNotEmpty()) return
        viewModelScope.launch {
            try {
                _uiState.update { it.copy(staff = it.staff.copy(branches = repo.branches())) }
            } catch (_: Exception) {
            }
        }
    }

    /** الخزائنُ عند الطلب — لصرف المنصرفات والرواتب وترحيل الفواتير نقدًا. */
    fun ensureCashLocations() {
        if (_uiState.value.staff.cashLocations.isNotEmpty()) return
        viewModelScope.launch {
            try {
                _uiState.update { it.copy(staff = it.staff.copy(cashLocations = repo.cashLocations())) }
            } catch (_: Exception) {
            }
        }
    }

    /** دليلُ الحسابات عند الطلب — للسندات وتسويات الجرد وترحيل الفواتير. */
    fun ensureAccounts() {
        if (_uiState.value.staff.accounts.isNotEmpty()) return
        viewModelScope.launch {
            try {
                _uiState.update { it.copy(staff = it.staff.copy(accounts = repo.accounts())) }
            } catch (_: Exception) {
            }
        }
    }

    /** الموظفون عند الطلب — لتفادي «بلا بطاقة موظفٍ مرتبطة» في سجلّ المناديب. */
    fun ensureEmployees() {
        if (_uiState.value.staff.employees.isNotEmpty()) return
        viewModelScope.launch {
            try {
                _uiState.update { it.copy(staff = it.staff.copy(employees = repo.employees())) }
            } catch (_: Exception) {
            }
        }
    }

    // ------------------------------------------------------------ بطاقات التفاصيل

    /**
     * قاعدةُ تحميل بطاقةٍ تفصيليّةٍ (المرحلة 2): تحميلُها وخطؤها خاصّان بها —
     * لا يشتركان في loadingKey/error الشاملين فلا يُسقط فشلُها قائمةً أخرى.
     */
    private fun loadDocument(key: String, update: suspend (StaffState) -> StaffState) {
        viewModelScope.launch {
            _uiState.update { it.copy(staff = it.staff.copy(detailLoading = key, detailError = null)) }
            try {
                val patched = update(_uiState.value.staff)
                _uiState.update { it.copy(staff = patched.copy(detailLoading = null)) }
            } catch (error: Exception) {
                _uiState.update {
                    it.copy(staff = it.staff.copy(detailLoading = null, detailError = friendly(error)))
                }
            }
        }
    }

    /** تفاصيلُ فاتورة مشتريات بسطورها — `GET /purchase-invoices/{id}`. */
    fun loadPurchaseInvoiceDetail(id: String) = loadDocument("purchase-$id") { s ->
        s.copy(purchaseInvoiceDetail = repo.purchaseInvoice(id))
    }

    /** تفاصيلُ فاتورة مبيعات بسطورها — `GET /sales/invoices/{id}`. */
    fun loadSalesInvoiceDetail(id: String) = loadDocument("sales-$id") { s ->
        s.copy(salesInvoiceDetail = repo.salesInvoice(id))
    }

    /** تفاصيلُ سند خزينة — `GET /vouchers/{id}`. */
    fun loadTreasuryVoucherDetail(id: String) = loadDocument("voucher-$id") { s ->
        s.copy(treasuryVoucherDetail = repo.treasuryVoucher(id))
    }

    /** إغلاقُ البطاقة التفصيليّة — تُمسح حالتُها كي لا تظهر لفاتورةٍ أخرى. */
    fun clearDocumentDetail() {
        _uiState.update {
            it.copy(
                staff = it.staff.copy(
                    purchaseInvoiceDetail = null,
                    salesInvoiceDetail = null,
                    treasuryVoucherDetail = null,
                    detailLoading = null,
                    detailError = null,
                )
            )
        }
    }

    // ------------------------------------------------------------ إجراءات الطاقم

    /**
     * قاعدةُ إجراءاتِ الطاقم — إجراءاتُ المالِ (فواتير/سندات/رواتب) تعيدُ قراءةَ
     * مبيعاتِ اليومِ الرسميّةِ فورَ نجاحِها، فتتحرّكُ أرقامُ اللوحةِ الرئيسيّةِ
     * (نقدي/شبكة/آجل) بلا انتظارِ سحبٍ للتحديث.
     */
    private fun staffAction(
        label: String,
        action: suspend () -> ActionResult,
        onDone: (ActionResult) -> Unit = {},
        refreshHome: Boolean = false,
    ) {
        viewModelScope.launch {
            val result = action()
            if (result is ActionResult.Synced && refreshHome) refreshHomeSales()
            when (result) {
                is ActionResult.Synced -> _notice.value = Notice.ok(result.messageAr)
                is ActionResult.Refused -> _notice.value = Notice.danger(result.messageAr)
                is ActionResult.Offline -> _notice.value = Notice.warn(result.messageAr)
            }
            onDone(result)
        }
    }

    fun createSupplier(body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("supplier", { repo.createParty(body) }, onDone = { result ->
            if (result is ActionResult.Synced) {
                viewModelScope.launch {
                    try {
                        val suppliers = repo.parties("supplier")
                        _uiState.update { it.copy(staff = it.staff.copy(suppliers = suppliers)) }
                    } catch (_: Exception) {
                    }
                }
            }
            onDone(result)
        })
    }

    fun createCategory(body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("category", { repo.createCategory(body) }, onDone)
    }

    fun createUnit(body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("unit", { repo.createUnit(body) }, onDone)
    }

    fun createCatalogItem(body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("item", { repo.createCatalogItem(body) }, onDone = { result ->
            if (result is ActionResult.Synced) ensureLookups(force = true)
            onDone(result)
        })
    }

    /**
     * إنشاءُ صنفٍ مع «الظهورِ في نقطة البيع» — مخططُ الإنشاءِ عند الخادمِ
     * يُسقطُ showInPos بصمت (zod)، فيُنشأ الصنفُ ثم يُرسَلُ العلمُ بتعديلٍ
     * لاحقٍ على المعرّفِ نفسِه مع فحص نتيجة التعديل فلا يظهرُ نجاحٌ كاذبٌ صامت.
     */
    fun createCatalogItemWithPos(body: JsonObject, showInPos: Boolean, onDone: (ActionResult) -> Unit) {
        viewModelScope.launch {
            var created = false
            val result = try {
                val id = repo.createCatalogItemReturningId(body)
                created = true
                if (showInPos) {
                    val patch = repo.updateCatalogItem(
                        id,
                        kotlinx.serialization.json.buildJsonObject { put("showInPos", true) },
                    )
                    when (patch) {
                        is ActionResult.Synced -> ActionResult.Synced("تمّ إنشاء الصنف — ويظهر في نقطة البيع.")
                        is ActionResult.Refused -> ActionResult.Refused(
                            "أُنشئ الصنف ولكن تعذّر تفعيل ظهوره في نقطة البيع: ${patch.messageAr}"
                        )
                        is ActionResult.Offline -> ActionResult.Offline(
                            "أُنشئ الصنف ولكن لم يصل تفعيلُ ظهوره في نقطة البيع — فعّله من تعديل الصنف."
                        )
                    }
                } else {
                    ActionResult.Synced("تمّ إنشاء الصنف.")
                }
            } catch (error: Exception) {
                ActionResult.Refused(friendly(error))
            }
            if (created) ensureLookups(force = true)
            _notice.value = when (result) {
                is ActionResult.Synced -> Notice.ok(result.messageAr)
                is ActionResult.Refused -> Notice.danger(result.messageAr)
                is ActionResult.Offline -> Notice.warn(result.messageAr)
            }
            onDone(result)
        }
    }

    fun createPurchaseInvoice(body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("purchase", { repo.createPurchaseInvoice(body) }, onDone)
    }

    fun postPurchaseInvoice(id: String, body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("purchase-post", { repo.postPurchaseInvoice(id, body) }, onDone)
    }

    fun createSalesInvoice(body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction(
            label = "sales-invoice",
            action = { repo.createSalesInvoice(body) },
            refreshHome = true,
            onDone = { result ->
                // المسودّةُ لا تُحتسبُ في مبيعاتِ اليومِ (نقدي/شبكة/آجل) حتى تُرحَّل — نقولها
                // صريحةً هنا حتى لا يُدهَشَ مستخدمٌ يرى أرقامَ اللوحةِ الرئيسيّةِ ثابتةً بعد الحفظ.
                if (result is ActionResult.Synced) {
                    _notice.value = Notice.ok("${result.messageAr} — المسودّةُ لا تدخلُ مبيعاتِ اليومِ حتى تُرحَّل.")
                }
                onDone(result)
            },
        )
    }

    fun postSalesInvoice(id: String, body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("sales-invoice", { repo.postSalesInvoice(id, body) }, refreshHome = true, onDone = onDone)
    }

    fun returnSalesInvoice(id: String, body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("sales-invoice", { repo.returnSalesInvoice(id, body) }, refreshHome = true, onDone = onDone)
    }

    /** تعديلُ مسودّة فاتورة المشتريات — `PATCH /purchase-invoices/{id}` (المرحلة 2). */
    fun updatePurchaseInvoice(id: String, body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("purchase-update", { repo.updatePurchaseInvoice(id, body) }, onDone)
    }

    /** إبطالُ فاتورة مشتريات — `POST /purchase-invoices/{id}/void` (بسببٍ إلزاميّ). */
    fun voidPurchaseInvoice(id: String, body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("purchase-void", { repo.voidPurchaseInvoice(id, body) }, onDone)
    }

    /** تعديلُ مسودّة فاتورة المبيعات — `PATCH /sales/invoices/{id}` (المرحلة 2). */
    fun updateSalesInvoice(id: String, body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("sales-invoice-update", { repo.updateSalesInvoice(id, body) }, onDone)
    }

    /** إبطالُ فاتورة مبيعات — `POST /sales/invoices/{id}/void` (بسببٍ إلزاميّ). */
    fun voidSalesInvoice(id: String, body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("sales-invoice-void", { repo.voidSalesInvoice(id, body) }, refreshHome = true, onDone = onDone)
    }

    /** تعديلُ سند خزينة (مسودّة) — `PATCH /vouchers/{id}` (المرحلة 2). */
    fun updateTreasuryVoucher(id: String, body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("voucher-update", { repo.updateTreasuryVoucher(id, body) }, onDone)
    }

    /** إبطالُ سند خزينة — `POST /vouchers/{id}/void`. */
    fun voidTreasuryVoucher(id: String, body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("voucher-void", { repo.voidTreasuryVoucher(id, body) }, onDone)
    }

    /** إبطالُ سندٍ مخزنيّ — `POST /inventory/vouchers/{id}/void`. */
    fun voidStockVoucher(id: String, body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("stock-voucher-void", { repo.voidStockVoucher(id, body) }, onDone)
    }

    /** تعديلُ مندوب مبيعات (العمولات/الجوال/المستودع) — `PATCH /sales/salesmen/{id}`. */
    fun updateSalesRegistry(id: String, body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("salesman-update", { repo.updateSalesRegistry(id, body) }, onDone)
    }

    /** تعديلُ مستودع — `PATCH /warehouses/{id}` (المرحلة 2). */
    fun updateWarehouse(id: String, body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("warehouse-update", { repo.updateWarehouse(id, body) }, onDone = { result ->
            if (result is ActionResult.Synced) ensureLookups(force = true)
            onDone(result)
        })
    }

    /** تعديلُ خزينة — `PATCH /cash-locations/{id}` (المرحلة 2). */
    fun updateCashLocation(id: String, body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("cash-location-update", { repo.updateCashLocation(id, body) }, onDone)
    }

    /** تعديلُ صنف — `PATCH /organization/catalog/items/{id}` (المرحلة 2). */
    fun updateCatalogItem(id: String, body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("item-update", { repo.updateCatalogItem(id, body) }, onDone = { result ->
            if (result is ActionResult.Synced) ensureLookups(force = true)
            onDone(result)
        })
    }

    /** تعديلُ مجموعة — `PATCH /organization/catalog/categories/{id}`. */
    fun updateCategory(id: String, body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("category-update", { repo.updateCategory(id, body) }, onDone)
    }

    /** تعديلُ وحدة قياس — `PATCH /organization/catalog/units/{id}`. */
    fun updateUnit(id: String, body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("unit-update", { repo.updateUnit(id, body) }, onDone)
    }

    /** تعديلُ موظف — `PATCH /hrm/employees/{id}` (المرحلة 2). */
    fun updateEmployee(id: String, body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("employee-update", { repo.updateEmployee(id, body) }, onDone)
    }

    /** تعديلُ طرفٍ (عميل/مورّد) — `PUT /parties/{id}` (المرحلة 2). */
    fun updateParty(id: String, body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("party-update", { repo.updateParty(id, body) }, onDone = { result ->
            if (result is ActionResult.Synced) ensureLookups(force = true)
            onDone(result)
        })
    }

    /** طلبُ استعادة كلمة المرور بالبريد — من شاشة الدخول (بلا جلسة). */
    fun forgotPassword(email: String, tenantCode: String, onDone: (ActionResult) -> Unit) {
        staffAction("forgot-password", { repo.forgotPassword(email, tenantCode) }, onDone)
    }

    fun createBranch(body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("branch", { repo.createBranch(body) }, onDone)
    }

    fun updateBranch(id: String, body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("branch", { repo.updateBranch(id, body) }, onDone)
    }

    fun createWarehouse(body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("warehouse", { repo.createWarehouse(body) }, onDone = { result ->
            if (result is ActionResult.Synced) ensureLookups(force = true)
            onDone(result)
        })
    }

    fun createCashLocation(body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("cash-location", { repo.createCashLocation(body) }, onDone)
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
                // البيعةُ مرحّلةٌ الآن: مبيعاتُ اليومِ الرسميّةُ (نقدي/شبكة/آجل) تُقرأُ
                // فورًا فتتحرّكَ اللوحةُ الرئيسيّةُ بلا سحبٍ للتحديث.
                refreshHomeSales()
                onDone(receipt)
            } catch (error: Exception) {
                _notice.value = Notice.danger(friendly(error))
                onDone(null)
            }
        }
    }

    // -------------------------------------------------- مساعدات الطباعة الاحترافية

    /** صفحةُ طباعةِ فاتورةِ مبيعاتٍ من الخادم — `paper=small` ⇒ إيصالُ كاشيرٍ 80mm. */
    suspend fun salesInvoicePrintHtml(id: String, paper: String? = null): String =
        repo.salesInvoicePrintHtml(id, paper)

    /** صفحةُ طباعةِ فاتورةِ مشتريات A4 من الخادم. */
    suspend fun purchaseInvoicePrintHtml(id: String): String = repo.purchaseInvoicePrintHtml(id)

    /** صفحةُ طباعةِ سندِ خزينة A4 من الخادم. */
    suspend fun treasuryVoucherPrintHtml(id: String): String = repo.treasuryVoucherPrintHtml(id)

    /** صفحةُ طباعةِ تقريرٍ A4 من الخادمِ بنفسِ مدخلاتِ تشغيله. */
    suspend fun reportPrintHtml(key: String, params: JsonObject): String = repo.reportPrintHtml(key, params)

    /**
     * حمولةُ QR لإيصالِ الكاشيرِ المحلّيّ: حمولةُ الخادمِ (`zatca_qr`) إن أصدرتها
     * وحدةُ الفوترةِ الإلكترونيّة، وإلا فالمرحلةُ الأولىُ تُبنى من تفاصيلِ الفاتورةِ
     * نفسِها وملفِ المنشأةِ (البائعُ والرقمُ الضريبيّ) — كما يفعلُ قالبُ الطباعةِ
     * الرسميُّ عند الخادمِ تمامًا. تُعيدُ null إن لم تكملِ البياناتُ (بلا رقمٍ
     * ضريبيّ مسجَّلٍ مثلًا) — فلا يُرسمُ مربّعٌ يفشلُ أيُّ ماسح.
     */
    suspend fun receiptQrPayload(receipt: PosCheckoutReceiptDto): String? {
        return try {
            val invId = receipt.resolvedId
            if (invId.isBlank()) return null
            val detail = repo.salesInvoice(invId)
            val issued = detail.effectiveQr
            if (issued != null) {
                issued
            } else {
                val profile = _uiState.value.companyProfile ?: repo.companyProfile()
                val vatNo = profile.taxNo?.takeIf { it.isNotBlank() } ?: return null
                val seller = profile.nameAr.takeIf { it.isNotBlank() } ?: return null
                val stamp = com.erpcloud.bakery.printing.ZatcaQr.normalizeTimestamp(detail.createdAt.orEmpty())
                if (stamp.isBlank()) return null
                com.erpcloud.bakery.printing.ZatcaQr.phase1Payload(
                    sellerName = seller,
                    vatNo = vatNo,
                    timestampIso = stamp,
                    grandTotal = com.erpcloud.bakery.util.Dec.orZero(detail.total ?: receipt.total)
                        .setScale(2, java.math.RoundingMode.HALF_UP).toPlainString(),
                    vatTotal = com.erpcloud.bakery.util.Dec.orZero(detail.taxTotal ?: receipt.taxTotal)
                        .setScale(2, java.math.RoundingMode.HALF_UP).toPlainString(),
                )
            }
        } catch (_: Exception) {
            null
        }
    }

    /**
     * فتحُ ورديةِ الكاشير للفرع — يستدعيه زرٌّ في حوارِ دفع نقطة البيع عند
     * رفضِ الخادمِ بـPOS_SHIFT_REQUIRED (إذنُ treasury.shift.close).
     */
    fun openShift(branchId: String, onDone: (Boolean) -> Unit = {}) {
        viewModelScope.launch {
            try {
                repo.openShift(branchId)
                _notice.value = Notice.ok("فُتحت ورديةُ الكاشير للفرع.")
                onDone(true)
            } catch (error: Exception) {
                _notice.value = Notice.danger(friendly(error))
                onDone(false)
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

    fun createSalesRegistry(body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("salesman", { repo.createSalesRegistry(body) }, onDone)
    }

    fun createMembership(body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("membership", { repo.inviteMembership(body) }, onDone)
    }

    fun createRole(body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("role", { repo.createRole(body) }, onDone)
    }

    /** استبدالُ أذونات دورٍ قائم — `POST /roles/{id}/permissions`. */
    fun updateRolePermissions(roleId: String, body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("role-permissions", { repo.updateRolePermissions(roleId, body) }, onDone)
    }

    /** تعديلُ عضويّة (تفعيل/تعطيل) — `PATCH /memberships/{id}`. */
    fun updateMembership(membershipId: String, body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("membership-update", { repo.updateMembership(membershipId, body) }, onDone)
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
            cashLocations = if (s.cashLocations.isEmpty()) optionalList(s.cashLocations) { repo.cashLocations() } else s.cashLocations,
            branches = if (s.branches.isEmpty()) optionalList(s.branches) { repo.branches() } else s.branches,
            accounts = if (s.accounts.isEmpty()) optionalList(s.accounts) { repo.accounts() } else s.accounts,
        )
    }

    fun loadAccounts() = loadStaff("accounts") { s ->
        s.copy(accounts = optionalList(s.accounts) { repo.accounts() })
    }

    fun createTreasuryVoucher(body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("voucher", { repo.createTreasuryVoucher(body) }, onDone)
    }

    fun postTreasuryVoucher(id: String, body: JsonObject, onDone: (ActionResult) -> Unit) {
        staffAction("voucher-post", { repo.postTreasuryVoucher(id, body) }, onDone)
    }

    // ---------------------------------------------- المخزون والأرصدة

    fun loadStockLevels(warehouseId: String? = null) {
        ensureLookups()
        loadStaff("levels") { s ->
            s.copy(stockLevels = repo.stockLevels(warehouseId))
        }
    }

    fun loadStockMovements(itemId: String?, warehouseId: String?, from: String?, to: String?) {
        ensureLookups()
        loadStaff("movements") { s ->
            s.copy(stockMovements = repo.stockMovements(itemId, warehouseId, from, to))
        }
    }

    fun loadItemCard(itemId: String, warehouseId: String?, from: String?, to: String?) {
        ensureLookups()
        loadStaff("item-card") { s ->
            s.copy(itemCard = repo.itemCard(itemId, warehouseId, from, to))
        }
    }

    fun loadCountAdjustments() {
        ensureLookups()
        loadStaff("counts") { s ->
            s.copy(
                countAdjustments = repo.stockAdjustments(),
                branches = if (s.branches.isEmpty()) optionalList(s.branches) { repo.branches() } else s.branches,
                accounts = if (s.accounts.isEmpty()) optionalList(s.accounts) { repo.accounts() } else s.accounts,
                catalogItems = if (s.catalogItems.isEmpty()) optionalList(s.catalogItems) { repo.catalogItemsFull() } else s.catalogItems,
            )
        }
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
        staffAction("party", { repo.createParty(body) }, onDone = { result ->
            if (result is ActionResult.Synced) ensureLookups(force = true)
            onDone(result)
        })
    }

    // ------------------------------------------------------------ الإشعارات

    fun refreshNotifications(unreadOnly: Boolean) {
        viewModelScope.launch {
            _uiState.update { it.copy(notifications = it.notifications.copy(loading = true, unreadOnly = unreadOnly, error = null)) }
            try {
                val page = repo.notifications(unreadOnly = unreadOnly)
                val visibleItems = page.data.filter { it.isManagementRelevant }
                val filteredOutUnread = page.data.count { !it.isManagementRelevant && !it.isRead }
                val filteredOutTotal = page.data.size - visibleItems.size
                _uiState.update {
                    it.copy(
                        notifications = it.notifications.copy(
                            loading = false,
                            items = visibleItems,
                            unread = (page.meta.unread - filteredOutUnread).coerceAtLeast(visibleItems.count { !it.isRead }),
                            total = (page.meta.total - filteredOutTotal).coerceAtLeast(visibleItems.size),
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

    /** شارةُ الجرس عند الإقلاع — قراءةٌ سريعة مع عزل إشعارات عهدة المندوب الفرديّة. */
    fun refreshNotificationBadge() {
        viewModelScope.launch {
            try {
                val page = repo.notifications(limit = 30)
                val visibleItems = page.data.filter { it.isManagementRelevant }
                val filteredOutUnread = page.data.count { !it.isManagementRelevant && !it.isRead }
                val filteredOutTotal = page.data.size - visibleItems.size
                _uiState.update {
                    it.copy(
                        notifications = it.notifications.copy(
                            items = visibleItems,
                            unread = (page.meta.unread - filteredOutUnread).coerceAtLeast(visibleItems.count { !it.isRead }),
                            total = (page.meta.total - filteredOutTotal).coerceAtLeast(visibleItems.size),
                        )
                    )
                }
            } catch (_: Exception) {
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

    fun showNoticeOk(messageAr: String) {
        _notice.value = Notice.ok(messageAr)
    }

    fun showNoticeDanger(messageAr: String) {
        _notice.value = Notice.danger(messageAr)
    }

    fun showNoticeWarn(messageAr: String) {
        _notice.value = Notice(Notice.Kind.WARN, messageAr)
    }

    // --------------------------------------------------- الدعم الفني ومركز المساعدة

    suspend fun supportTickets(): List<com.erpcloud.bakery.data.api.SupportTicketDto> =
        repo.supportTickets()

    suspend fun supportTicketDetail(id: String): com.erpcloud.bakery.data.api.SupportTicketDto =
        repo.supportTicketDetail(id)

    suspend fun createSupportTicket(body: JsonObject): com.erpcloud.bakery.data.api.SupportTicketDto =
        repo.createSupportTicket(body)

    suspend fun replySupportTicket(id: String, body: JsonObject): com.erpcloud.bakery.data.api.SupportTicketDto =
        repo.replySupportTicket(id, body)

    suspend fun publicHelp(q: String? = null): List<com.erpcloud.bakery.data.api.PublicHelpPostDto> =
        repo.publicHelp(q)

    suspend fun publicFaq(): List<com.erpcloud.bakery.data.api.PublicFaqDto> =
        repo.publicFaq()

    // ------------------------------------------ الفواتير الضريبية المرفوعة (ZATCA)

    suspend fun einvoiceFilings(
        status: String? = null,
        from: String? = null,
        to: String? = null,
        pageNo: Int = 1,
        pageSize: Int = 50,
    ): com.erpcloud.bakery.data.api.EinvoiceFilingPageDto =
        repo.einvoiceFilings(status = status, from = from, to = to, pageNo = pageNo, pageSize = pageSize)

    suspend fun einvoiceFilingDetail(id: String): com.erpcloud.bakery.data.api.EinvoiceFilingDetailDto =
        repo.einvoiceFilingDetail(id)

    suspend fun einvoiceChain(): com.erpcloud.bakery.data.api.EinvoiceChainStateDto? =
        repo.einvoiceChain()

    suspend fun syncEinvoices(): com.erpcloud.bakery.data.api.EinvoiceSyncReportDto =
        repo.syncEinvoices()

    suspend fun retryEinvoice(id: String): ActionResult =
        repo.retryEinvoice(id)

    // ------------------------------------------------ المساعد الذكي (AI) وإعداداته

    suspend fun aiSettings(): com.erpcloud.bakery.data.api.AiSettingsDto =
        repo.aiSettings()

    suspend fun updateAiSettings(body: JsonObject): ActionResult =
        repo.updateAiSettings(body)

    suspend fun testAiSettings(): com.erpcloud.bakery.data.api.AiTestResultDto =
        repo.testAiSettings()

    suspend fun aiSuggestions(): List<com.erpcloud.bakery.data.api.AiSuggestionDto> =
        repo.aiSuggestions()

    suspend fun aiConversations(): List<com.erpcloud.bakery.data.api.AiConversationRowDto> =
        repo.aiConversations()

    suspend fun aiConversation(id: String): com.erpcloud.bakery.data.api.AiStoredConversationDto =
        repo.aiConversation(id)

    suspend fun aiChat(message: String, conversationId: String?): com.erpcloud.bakery.data.api.AiChatResultDto =
        repo.aiChat(message, conversationId)

    // ----------------------------------------- الصناديق والبنوك والأرصدة وحركة الصندوق

    suspend fun cashLocationsList(): List<CashLocationDto> = repo.cashLocations()

    suspend fun cashLocationDetail(id: String): CashLocationDto = repo.cashLocationDetail(id)

    suspend fun cashLocationBalances(id: String): List<com.erpcloud.bakery.data.api.CashLocationBalanceDto> =
        repo.cashLocationBalances(id)

    suspend fun cashLocationMovements(
        id: String,
        all: Boolean = true,
        from: String? = null,
        to: String? = null,
    ): com.erpcloud.bakery.data.api.CashMovementStatementDto =
        repo.cashLocationMovements(id = id, all = all, from = from, to = to)

    suspend fun recalcCashLocationBalance(id: String): ActionResult =
        repo.recalcCashLocationBalance(id)

    suspend fun createCashLocationSuspend(body: JsonObject): ActionResult =
        repo.createCashLocation(body)

    suspend fun updateCashLocationSuspend(id: String, body: JsonObject): ActionResult =
        repo.updateCashLocation(id, body)

    suspend fun deleteCashLocationSuspend(id: String): ActionResult =
        repo.deleteCashLocation(id)

    suspend fun cashTransfers(
        status: String? = null,
        from: String? = null,
        to: String? = null,
    ): List<com.erpcloud.bakery.data.api.CashTransferDto> =
        repo.cashTransfers(status = status, from = from, to = to)

    suspend fun createCashTransfer(body: JsonObject): com.erpcloud.bakery.data.api.CashTransferDto =
        repo.createCashTransfer(body)

    suspend fun sendCashTransfer(id: String): ActionResult =
        repo.sendCashTransfer(id)

    suspend fun receiveCashTransfer(id: String): ActionResult =
        repo.receiveCashTransfer(id)

    suspend fun cancelCashTransfer(id: String): ActionResult =
        repo.cancelCashTransfer(id)

    fun friendlyError(error: Exception): String = friendly(error)

    private fun friendly(error: Exception): String = when (error) {
        is ApiException -> error.userMessage
        is IOException -> "تعذّر الاتصال بالخدمة السحابية — تحقّق من اتصال الإنترنت وحاول مرّةً أخرى"
        else -> error.message ?: "تعذّر إكمال الطلب"
    }
}
