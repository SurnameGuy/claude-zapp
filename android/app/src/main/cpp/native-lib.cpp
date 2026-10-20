// Ponte JNI mínima para iniciar o Node.js (nodejs-mobile) dentro do app.
#include <jni.h>
#include <android/log.h>
#include <pthread.h>
#include <unistd.h>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include "node.h"

#define TAG "zapp-node"

static int pipes[2];
static void* logThread(void*) {
    char buf[2048];
    ssize_t n;
    while ((n = read(pipes[0], buf, sizeof(buf) - 1)) > 0) {
        if (n > 0 && buf[n - 1] == '\n') n--;
        buf[n] = '\0';
        __android_log_write(ANDROID_LOG_INFO, TAG, buf);
    }
    return nullptr;
}

extern "C" JNIEXPORT void JNICALL
Java_app_zapp_NodeBridge_redirectLogs(JNIEnv*, jclass) {
    setvbuf(stdout, nullptr, _IONBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);
    if (pipe(pipes) != 0) return;
    dup2(pipes[1], STDOUT_FILENO);
    dup2(pipes[1], STDERR_FILENO);
    pthread_t t;
    pthread_create(&t, nullptr, logThread, nullptr);
    pthread_detach(t);
}

extern "C" JNIEXPORT void JNICALL
Java_app_zapp_NodeBridge_setEnv(JNIEnv* env, jclass, jstring k, jstring v) {
    const char* ck = env->GetStringUTFChars(k, nullptr);
    const char* cv = env->GetStringUTFChars(v, nullptr);
    if (ck && cv) {
        setenv(ck, cv, 1);
    }
    if (ck) env->ReleaseStringUTFChars(k, ck);
    if (cv) env->ReleaseStringUTFChars(v, cv);
}

extern "C" JNIEXPORT jint JNICALL
Java_app_zapp_NodeBridge_startNode(JNIEnv* env, jclass, jobjectArray arguments) {
    if (arguments == nullptr) {
        return -1;
    }

    jsize argc = env->GetArrayLength(arguments);
    size_t total = 0;
    for (jsize i = 0; i < argc; ++i) {
        jstring js = static_cast<jstring>(env->GetObjectArrayElement(arguments, i));
        if (js == nullptr) {
            continue;
        }
        const char* s = env->GetStringUTFChars(js, nullptr);
        if (s != nullptr) {
            total += std::strlen(s) + 1;
            env->ReleaseStringUTFChars(js, s);
        }
        env->DeleteLocalRef(js);
    }

    // node::Start() exige argv[] terminado em nullptr para não ler fora do array.
    auto buffer = std::unique_ptr<char[]>(new char[total + 1]());
    auto argv = std::unique_ptr<char*[]>(new char*[static_cast<size_t>(argc) + 1]);
    char* cur = buffer.get();

    for (jsize i = 0; i < argc; ++i) {
        jstring js = static_cast<jstring>(env->GetObjectArrayElement(arguments, i));
        if (js == nullptr) {
            continue;
        }
        const char* s = env->GetStringUTFChars(js, nullptr);
        if (s != nullptr) {
            size_t len = std::strlen(s);
            std::memcpy(cur, s, len);
            cur[len] = '\0';
            argv[i] = cur;
            cur += len + 1;
            env->ReleaseStringUTFChars(js, s);
        }
        env->DeleteLocalRef(js);
    }

    argv[argc] = nullptr;
    return static_cast<jint>(node::Start(static_cast<int>(argc), argv.get()));
}
