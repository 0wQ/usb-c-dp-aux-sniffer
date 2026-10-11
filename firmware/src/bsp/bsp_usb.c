#include "bsp/bsp_usb.h"

#include "bsp/bsp_delay.h"

#include <ch32l103.h>

uint32_t bsp_usb_lock(void) {
    const uint32_t irq_enabled = NVIC_GetStatusIRQ(USBFS_IRQn);
    NVIC_DisableIRQ(USBFS_IRQn);
    return irq_enabled;
}

void bsp_usb_unlock(uint32_t irq_enabled) {
    if (irq_enabled != 0u) {
        NVIC_EnableIRQ(USBFS_IRQn);
    }
}

// 按当前系统时钟选择 USBFS 时钟源，并打开外设时钟
// 96 MHz 用 PLL/2，72 MHz 用 PLL/1.5，48 MHz 用 PLL/1
static void bsp_usb_clk_init(void) {
    uint32_t usb_clk_source;

    switch (SystemCoreClock) {
        case 96000000u:
            usb_clk_source = RCC_USBCLKSource_PLLCLK_Div2;
            break;
        case 72000000u:
            usb_clk_source = RCC_USBCLKSource_PLLCLK_Div1_5;
            break;
        case 48000000u:
        default:
            usb_clk_source = RCC_USBCLKSource_PLLCLK_Div1;
            break;
    }

    RCC_USBCLKConfig(usb_clk_source);
    RCC_HBPeriphClockCmd(RCC_HBPeriph_USBFS, ENABLE);
}

// CherryUSB port 的弱符号钩子，usb_dc_init 会先调用它
void usb_dc_low_level_init(void) {
    bsp_usb_clk_init();

    NVIC_InitTypeDef NVIC_InitStructure = {0};
    NVIC_InitStructure.NVIC_IRQChannel = USBFS_IRQn;
    NVIC_InitStructure.NVIC_IRQChannelPreemptionPriority = 1;
    NVIC_InitStructure.NVIC_IRQChannelSubPriority = 0;
    NVIC_InitStructure.NVIC_IRQChannelCmd = ENABLE;
    NVIC_Init(&NVIC_InitStructure);
}

void usb_dc_low_level_deinit(void) {
    NVIC_InitTypeDef NVIC_InitStructure = {0};
    NVIC_InitStructure.NVIC_IRQChannel = USBFS_IRQn;
    NVIC_InitStructure.NVIC_IRQChannelCmd = DISABLE;
    NVIC_Init(&NVIC_InitStructure);
}

// 给 USB 栈提供微秒级延时，直接复用 SysTick 计时
void usb_dc_delay_us(uint32_t us) {
    delay_us(us);
}
