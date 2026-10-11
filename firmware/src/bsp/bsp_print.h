#pragma once

#include <stdint.h>
#include <stdio.h>

// 日志输出通道选择
#define PRINT_DISABLE (-1)  // 关闭日志
#define PRINT_SDI     (0)   // WCH-Link SDI
#define PRINT_UART1   (1)
#define PRINT_UART2   (2)
#define PRINT_UART3   (3)

#ifndef DEBUG
#define DEBUG PRINT_DISABLE
#endif

#if (DEBUG < PRINT_DISABLE) || (DEBUG > PRINT_UART3)
#error "DEBUG 只能是 PRINT_DISABLE(-1)、PRINT_SDI(0)、PRINT_UART1(1)、PRINT_UART2(2)、PRINT_UART3(3)"
#endif

#if (DEBUG == PRINT_DISABLE)
#define LOG(...) ((void)0)
#else
#define LOG(...) printf(__VA_ARGS__)
#endif

#define DEBUG_DATA0_ADDRESS ((volatile uint32_t *)0xE0000380)
#define DEBUG_DATA1_ADDRESS ((volatile uint32_t *)0xE0000384)

void bsp_print_init(uint32_t baudrate);

static inline void print_init(uint32_t baudrate) {
    bsp_print_init(baudrate);
}
