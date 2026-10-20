package com.erpcloud.bakery

import android.app.Application
import android.content.Context
import com.erpcloud.bakery.data.BakeryRepository
import com.erpcloud.bakery.data.api.NetworkFactory
import com.erpcloud.bakery.data.api.SessionEvents
import com.erpcloud.bakery.data.offline.CredentialStore
import com.erpcloud.bakery.data.offline.SessionStore

/**
 * حاويةُ الاعتماديّات اليدويّة — بلا Hilt: مشروعٌ واحدٌ والوضوحُ أوّى.
 * **لا طابورَ هنا**: تطبيقُ الإدارة متصلٌ دائمًا (قرارٌ مقصود — القراراتُ الماليّة
 * تُتخذ بمعلومةٍ حديثة من الخادم).
 */
class AppContainer(context: Context) {
    val sessionStore = SessionStore(context)
    val sessionEvents = SessionEvents()
    val credentialStore = CredentialStore(context)
    private val network = NetworkFactory(
        sessionStore,
        sessionEvents,
        com.erpcloud.bakery.data.offline.SnapshotCache(context),
    )
    val repository = BakeryRepository(network.api, sessionStore)
}

class BakeryApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
