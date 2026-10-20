// Ponte JNI mínima para iniciar o Node.js (nodejs-mobile) dentro do app.
#include <jni.h>
#include <android/log.h>
#include <pthread.h>
#include <unistd.h>
#include <cstdlib>
#include <cstring>
#include <string>
#include "node.h"

#define TAG "zapp-node"

static int pipes[2];
static void* logThread(void*) {
    char buf[2048];
    ssize_t n;
    while ((n = read(pipes[0], buf, sizeof(buf) - 1)) > 0) {
        if (buf[n - 1] == '\n') n--;
        buf[n] = 0;
        __android_log_write(ANDROID_LOG_INFO, TAG, buf);
    }
    return nullptr;
}

extern "C" JNIEXPORT void JNICALL
Java_app_zapp_NodeBridge_redirectLogs(JNIEnv*, jclass) {
    setvbuf(stdout, nullptr, _IONBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);
    if (pipe(pipes) != 0) return;
    dup2(pipes[1], 1);
    dup2(pipes[1], 2);
    pthread_t t;
    pthread_create(&t, nullptr, logThread, nullptr);
    pthread_detach(t);
}

extern "C" JNIEXPORT void JNICALL
Java_app_zapp_NodeBridge_setEnv(JNIEnv* env, jclass, jstring k, jstring v) {
    const char* ck = env->GetStringUTFChars(k, nullptr);
    const char* cv = env->GetStringUTFChars(v, nullptr);
    setenv(ck, cv, 1);
    env->ReleaseStringUTFChars(k, ck);
    env->ReleaseStringUTFChars(v, cv);
}

extern "C" JNIEXPORT jint JNICALL
Java_app_zapp_NodeBridge_startNode(JNIEnv* env, jclass, jobjectArray arguments) {
    jsize argc = env->GetArrayLength(arguments);
    size_t total = 0;
    for (jsize i = 0; i < argc; i++) {
        jstring js = (jstring)env->GetObjectArrayElement(arguments, i);
        const char* s = env->GetStringUTFChars(js, nullptr);
        total += strlen(s) + 1;
        env->ReleaseStringUTFChars(js, s);
    }
    // o Node exige argv contíguo na memória
    char* buffer = (char*)calloc(total + 1, 1);
    char** argv = (char**)calloc(argc + 1, sizeof(char*));
    char* cur = buffer;
    for (jsize i = 0; i < argc; i++) {
        jstring js = (jstring)env->GetObjectArrayElement(arguments, i);
        const char* s = env->GetStringUTFChars(js, nullptr);
        size_t len = strlen(s);
        memcpy(cur, s, len);
        argv[i] = cur;
        cur += len + 1;
        env->ReleaseStringUTFChars(js, s);
    }
    return (jint)node::Start((int)argc, argv);
}
