# قواعد ProGuard — الطابور يعتمد kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**

-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.erpcloud.bakery.**$$serializer { *; }
-keepclassmembers class com.erpcloud.bakery.** {
    *** Companion;
}
-keepclasseswithmembers class com.erpcloud.bakery.** {
    kotlinx.serialization.KSerializer serializer(...);
}
