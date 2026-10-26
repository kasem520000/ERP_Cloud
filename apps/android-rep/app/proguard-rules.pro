# قواعد ProGuard — الطابور يعتمد kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**

-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.erpcloud.rep.**$$serializer { *; }
-keepclassmembers class com.erpcloud.rep.** {
    *** Companion;
}
-keepclasseswithmembers class com.erpcloud.rep.** {
    kotlinx.serialization.KSerializer serializer(...);
}
