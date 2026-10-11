#include "bsp/bsp_delay.h"

#include <ch32l103.h>

static uint8_t initialized = 0;
static uint32_t us_divider;
static uint32_t ms_divider;

// 用 SysTick 做自由运行的计时基准，CMP 设成 0xFFFF，不需要中断
void bsp_delay_init(void) {
    if (initialized) return;

    SysTick->CTLR = 0;
    SysTick->SR = 0;
    SysTick->CNT = 0;
    SysTick->CMP = 0xFFFFu;

    us_divider = SystemCoreClock / 1000000u;
    ms_divider = SystemCoreClock / 1000u;

    SysTick->CTLR = SysTick_CTLR_STE_Msk | SysTick_CTLR_STCLK_Msk;
    initialized = 1;
}

void delay_us(uint32_t us) {
    if (us == 0u) return;
    uint64_t start = SysTick->CNT;
    uint64_t ticks = (uint64_t)us * us_divider;
    while (((uint64_t)SysTick->CNT - start) < ticks) {
    }
}

void delay_ms(uint32_t ms) {
    if (ms == 0u) return;
    uint64_t start = SysTick->CNT;
    uint64_t ticks = (uint64_t)ms * ms_divider;
    while (((uint64_t)SysTick->CNT - start) < ticks) {
    }
}

uint32_t micros(void) {
    return SysTick->CNT / us_divider;
}

uint32_t millis(void) {
    return SysTick->CNT / ms_divider;
}

// 读两次直到单调，避免在计数器更新沿读到撕裂值
uint64_t systick_cnt64(void) {
    uint64_t cnt1 = (uint64_t)SysTick->CNT;
    uint64_t cnt2 = (uint64_t)SysTick->CNT;
    while (cnt2 < cnt1) {
        cnt1 = cnt2;
        cnt2 = (uint64_t)SysTick->CNT;
    }
    return cnt2;
}

uint64_t systick_cnt_to_us(uint64_t cnt) {
    if (us_divider == 0u) {
        return 0u;
    }
    return cnt / (uint64_t)us_divider;
}

uint64_t micros64(void) {
    return systick_cnt_to_us(systick_cnt64());
}
