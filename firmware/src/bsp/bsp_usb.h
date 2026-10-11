#pragma once

#include <stdint.h>

// 保护主循环与 USB 中断共享的端点状态，DMA 捕获中断保持开启
uint32_t bsp_usb_lock(void);
void bsp_usb_unlock(uint32_t irq_enabled);
