cmake_minimum_required(VERSION 3.18)
project(zapp-native)

set(LIBNODE ${CMAKE_CURRENT_SOURCE_DIR}/../../../libnode)
add_library(node SHARED IMPORTED)
set_target_properties(node PROPERTIES IMPORTED_LOCATION ${LIBNODE}/bin/${ANDROID_ABI}/libnode.so)

add_library(zapp-native SHARED native-lib.cpp)
target_include_directories(zapp-native PRIVATE ${LIBNODE}/include/node)
target_link_libraries(zapp-native node log)
