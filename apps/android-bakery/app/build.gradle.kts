import java.io.FileInputStream
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// توقيعُ نسخة الإصدار: من ملف keystore.properties محليًّا، أو من متغيّرات البيئة في CI
// (GitHub Actions يفكّ سرّ KEYSTORE_BASE64 ويضبطها). وإن لم يوجد أيٌّ منهما تُوقَّع
// نسخةُ الإصدار بمفتاح التصحيح كي تبقى APK قابلةً للتثبيت مباشرةً.
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) load(FileInputStream(keystorePropertiesFile))
}
val ciStoreFile = System.getenv("KEYSTORE_FILE")
val ciStorePassword = System.getenv("KEYSTORE_PASSWORD")
val ciKeyAlias = System.getenv("KEY_ALIAS")
val ciKeyPassword = System.getenv("KEY_PASSWORD")
val releaseKeystorePresent =
    (
        !ciStoreFile.isNullOrBlank() && !ciStorePassword.isNullOrBlank() &&
            !ciKeyAlias.isNullOrBlank() && !ciKeyPassword.isNullOrBlank()
        ) ||
        (keystorePropertiesFile.exists() && !keystoreProperties.getProperty("storeFile").isNullOrBlank())

android {
    namespace = "com.erpcloud.bakery"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.erpcloud.bakery"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        vectorDrawables { useSupportLibrary = true }
    }

    signingConfigs {
        if (releaseKeystorePresent) {
            create("release") {
                storeFile = file(ciStoreFile ?: keystoreProperties.getProperty("storeFile"))
                storePassword = ciStorePassword ?: keystoreProperties.getProperty("storePassword")
                keyAlias = ciKeyAlias ?: keystoreProperties.getProperty("keyAlias")
                keyPassword = ciKeyPassword ?: keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (releaseKeystorePresent) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // java.time على minSdk 24 (LocalDate/Year في كشوف الرواتب والتقارير والحركة)
        isCoreLibraryDesugaringEnabled = true
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.2")
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons)
    implementation(libs.androidx.navigation.compose)

    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.print)
    implementation(libs.androidx.biometric)
    implementation(libs.androidx.security.crypto)

    debugImplementation(libs.androidx.compose.ui.tooling)
}
