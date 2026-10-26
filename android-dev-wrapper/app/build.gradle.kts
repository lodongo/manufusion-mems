plugins {
    id("com.android.application")
}
android {
    namespace = "com.manufusion.mems.devclient"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.manufusion.mems.devclient"
        minSdk = 24
        targetSdk = 34
        versionCode = 2
        versionName = "2.0.0-dev"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
