plugins {
  id("com.google.gms.google-services") version "4.4.4" apply false
  id("com.google.firebase.crashlytics") version "3.0.3" apply false
}

plugins {
  id("com.android.application")
  id("com.google.gms.google-services")
  id("com.google.firebase.crashlytics")
}

dependencies {
  implementation(platform("com.google.firebase:firebase-bom:34.11.0"))

  implementation("com.google.firebase:firebase-messaging")
  implementation("com.google.firebase:firebase-analytics")
  implementation("com.google.firebase:firebase-crashlytics")
}
