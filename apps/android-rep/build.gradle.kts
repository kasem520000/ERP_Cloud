// ملفُ البناءِ الجذريّ — تطبيقُ مندوبِ التوزيع (أندرويد).
// ملاحظة: هذا المشروع مستقلٌّ عن بيئة pnpm في المستودع (لا package.json) — يُفتح
// في Android Studio ويُبنى بـ Gradle وحده.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}
