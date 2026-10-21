// Ponte JNI mínima para iniciar o Node.js (nodejs-mobile) dentro do app.
#include <jni.h>
#include <android/log.h>
#include <pthread.h>
#include <unistd.h>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <signal.h>
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

// node::Start() restaura TODOS os sinais para SIG_DFL (PlatformInit). Isso remove os handlers do ART (SIGSEGV usado
// para NullPointerException/stack overflow) e do debuggerd: o app morre em silêncio, sem tombstone. Guardamos os
// handlers antes e os devolvemos assim que o Node terminar de inicializar (só se ainda estiverem em SIG_DFL).
static const int kGuarded[] = {SIGSEGV, SIGBUS, SIGFPE, SIGILL, SIGABRT, SIGTRAP};
static struct sigaction savedActs[64];

static bool hasHandler(const struct sigaction& a) {
    return (a.sa_flags & SA_SIGINFO) || (a.sa_handler != SIG_DFL && a.sa_handler != SIG_IGN);
}

static void* signalGuard(void*) {
    const useconds_t waits[] = {200000, 400000, 800000, 1500000, 3000000, 5000000};
    for (useconds_t w : waits) {
        usleep(w);
        for (int sig : kGuarded) {
            struct sigaction cur;
            if (sigaction(sig, nullptr, &cur) != 0) continue;
            if (!hasHandler(cur) && hasHandler(savedActs[sig])) {
                sigaction(sig, &savedActs[sig], nullptr);
                __android_log_print(ANDROID_LOG_WARN, TAG, "handler do sinal %d restaurado apos node::Start", sig);
            }
        }
    }
    return nullptr;
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

    for (int sig : kGuarded) sigaction(sig, nullptr, &savedActs[sig]);
    pthread_t g;
    if (pthread_create(&g, nullptr, signalGuard, nullptr) == 0) pthread_detach(g);
    return static_cast<jint>(node::Start(static_cast<int>(argc), argv.get()));
}

