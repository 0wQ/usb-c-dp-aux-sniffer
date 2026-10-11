// SDK 缺失的 extern 声明（为了替代 WCH SDK 例程里的 debug.h 那坨全局变量）
//
// 来源说明（WCH CH32L103 SDK/EVT 例程）：
// - 例程的 Debug/debug.h 会声明这些全局变量：OPA_Trim / ADC_Trim / TS_Val / CHIPID / USBPD_CFG
// - 例程的 Peripheral/src/ch32l103_gpio.c 在 GPIO_IPD_Unused() 里从 *_BASE 地址读出并初始化它们
// - 本工程不直接引入 debug.h，因此在这里补 extern；赋值/初始化应由启动流程 (SystemInit) 或显式 init 负责
#pragma once

#ifndef __ASSEMBLER__

#include <stdint.h>

extern uint32_t OPA_Trim;
extern uint16_t ADC_Trim;
extern uint32_t TS_Val;
extern uint32_t CHIPID;
extern uint16_t USBPD_CFG;

#endif
