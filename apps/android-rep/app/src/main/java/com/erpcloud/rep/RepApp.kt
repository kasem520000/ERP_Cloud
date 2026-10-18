package com.erpcloud.rep

import android.app.Application
import android.content.Context
import com.erpcloud.rep.data.RepRepository
import com.erpcloud.rep.data.api.NetworkFactory
import com.erpcloud.rep.data.api.SessionEvents
import com.erpcloud.rep.data.offline.CredentialStore
import com.erpcloud.rep.data.offline.QueueStore
import com.erpcloud.rep.data.offline.SessionStore

/** حاويةُ الاعتماديّات اليدويّة — بلا Hilt: المشروعُ صغيرٌ والوضوحُ أوّى. */
class AppContainer(context: Context) {
    val sessionStore = SessionStore(context)
    val sessionEvents = SessionEvents()
    val queueStore = QueueStore(context)
    val credentialStore = CredentialStore(context)
    private val network = NetworkFactory(sessionStore, sessionEvents)
    val repository = RepRepository(network.api, sessionStore, queueStore)
}

class RepApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
