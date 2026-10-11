#pragma once

#include <ch32l103.h>

// DP AUX 捕获前端配置
//
// 本工程用 CH32L103 内部比较器 CMP3 切片 Type-C SBU1/SBU2 上的 DP AUX 差分对，
// 解出 Manchester-II 码流，再通过 native HID 把 AUX 事务转发给主机。解出的帧先
// 进入环形缓冲，USB HID 层再按自己的节奏取走
//
// 板上把 SBU1/SBU2 经 100 nF 交流耦合到 1.65 V 偏置，接到比较器输入
//   AUX_P 接 PB5，CMP3 正输入 0
//   AUX_N 接 PB3，CMP3 负输入 0
// MODE3 = OUT_IO_TIM2 把比较器输出送到内部 TIM2_CH3。这是本封装唯一可用的输出，
// CMP3 的备用输出 PB12 和 P1/N1 输入 PB10/PB11 在 CH32L103K8U6（QFN32）上都没有
// 键合出来

#define CONFIG_DP_AUX_GPIO_PORT GPIOB
#define CONFIG_DP_AUX_GPIO_CLK  RCC_PB2Periph_GPIOB
#define CONFIG_DP_AUX_PIN_P     GPIO_Pin_5
#define CONFIG_DP_AUX_PIN_N     GPIO_Pin_3

// TIM2 时钟来自 PCLK1 * 2。SystemInit 把 PPRE1 设为 /2，所以 SYSCLK = 96 MHz 时
// TIM2 是 96 MHz，见 CH32L103 参考手册时钟树
#define CONFIG_DP_AUX_TIMER_HZ (96000000u)

// CMP3 迟滞 ±15 mV
//
// 实测抓到的 preamble 上升沿间隔是 12 12 12 24，每 4 个丢一个沿，而规范要求
// preamble 是 26~32 个连续 0，半位严格交替、上升沿严格每 1 个位周期一个
// 两次实测的对比结论（2026-10-10）
//   迟滞开               preamble 漏边沿，间隔呈 12 12 12 24，但空闲期干净，valid 约 83%
//   迟滞关               比较器在 MHz 级持续自激，10 万边沿/秒，min_interval 为 0，valid 4.8%
//   迟滞关加 IC3F 166ns  一样自激，是真实振荡不是毛刺，滤波器滤不掉
// 保持迟滞开启
#define CONFIG_DP_AUX_CMP_HYSTERESIS (1U)

// TIM2 CH3 捕获输入的数字滤波 IC3F
// 取值见参考手册 IC3F[3:0]，0 为不滤波，Fdts 在 CKD=DIV1 时等于 TIM2 时钟 96 MHz
// 0b0011 为 Fck_int 采样 N=8，约 83 ns；0b0111 为 Fdts/4 采样 N=8，约 333 ns
// 0b1001 为 Fdts/8 采样 N=8，约 666 ns，会盖住 500 ns 半位，不能用于 AUX
// 实测（2026-10-11）：0x00 时 67 s 内 CC3OF 35 次，改 0x03 后 267 s、49289 个边沿
// CC3OF 为 0，自洽率保持 97.7%，保留此滤波配置，毛刺根因需波形测量确认
#define CONFIG_DP_AUX_IC3F (0x03u)

// 捕获 tick。12 MHz 时 1 us 的 AUX 位是 12 tick，半个位是 6 tick，而 16 位计数器
// 每 5.46 ms 才回绕一次，远长于一次事务里的任何间隔，所以帧内差值不会回绕
#define CONFIG_DP_AUX_TICK_HZ (12000000u)

// AUX 标称位周期 tick 数，1 Mbps 对应 12 tick
#define CONFIG_DP_AUX_BIT_TICKS (12u)
// 半个位周期，Manchester 的量化单位
#define CONFIG_DP_AUX_HALF_TICKS (CONFIG_DP_AUX_BIT_TICKS / 2u)

// 连续这么久没有边沿就结束当前帧，继续等待后续边沿
#define CONFIG_DP_AUX_IDLE_TIMEOUT_US (64u)

// 周期状态上报的间隔
#define CONFIG_DP_AUX_STATUS_PERIOD_MS (1000u)
