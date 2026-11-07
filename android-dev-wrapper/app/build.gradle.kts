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
        versionCode = 3
        versionName = "2.1.0-dev"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    // FileProvider: hands the system camera a private file to write the photo to (no storage permission needed).
    implementation("androidx.core:core:1.13.1")
}
