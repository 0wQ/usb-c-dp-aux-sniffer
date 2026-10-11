#pragma once

#include <stdint.h>

// SysTick 控制与状态寄存器位定义
#define SysTick_CTLR_STRE_Msk  (1UL << 3U)
#define SysTick_CTLR_STCLK_Msk (1UL << 2U)
#define SysTick_CTLR_STIE_Msk  (1UL << 1U)
#define SysTick_CTLR_STE_Msk   (1UL << 0U)

// 初始化 SysTick 计时基准，自由运行，无中断
void bsp_delay_init(void);

void delay_us(uint32_t us);
void delay_ms(uint32_t ms);

uint32_t micros(void);
uint32_t millis(void);

// 读取 64 位原始 SysTick 计数
uint64_t systick_cnt64(void);
// 把原始 SysTick 计数换算成微秒
uint64_t systick_cnt_to_us(uint64_t cnt);
uint64_t micros64(void);

