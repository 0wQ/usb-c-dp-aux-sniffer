#pragma once

#include <stdbool.h>
#include <stdint.h>

// DP AUX 捕获前端
//
// CMP3 正端接 PB5（AUX_P），负端接 PB3（AUX_N），输出走内部通道 TIM2_CH3
// TIM2 自由运行，CH3 捕获选定极性，DMA1 通道 1 把时间戳写进循环缓冲。主循环再
// 计算相邻边沿的间隔，DMA 半满和全满中断只记录周数，不逐沿中断
//
// CMP3 的共模偏置来自 V_BIAS = 1.65 V，而 V_BIAS 由 VDD_3V3 分压得到，VDD_3V3
// 又只来自 USB0 的 VBUS_PC。USB0 不插，前端就没有偏置，捕不到东西

// 初始化捕获前端，配置 CMP3、TIM2 和 DMA
void bsp_dp_aux_init(void);

// 打开或关闭比较器和捕获 DMA
void bsp_dp_aux_set_enabled(bool en);

bool bsp_dp_aux_is_enabled(void);

// 选择 TIM2_CH3 捕获的比较器边沿，false 为上升沿，true 为下降沿
void bsp_dp_aux_set_falling_edge(bool falling);

// 取走自上次调用以来捕获到的边沿间隔
// out 输出数组，单位是 TIM2 tick，见 CONFIG_DP_AUX_TICK_HZ
// max 最多取出多少个，返回实际取出的个数
uint16_t bsp_dp_aux_read_intervals(uint16_t *out, uint16_t max);

// 丢弃上一条边沿的时间戳，下一条边沿只建立新的参考点，不产生跨空闲期的间隔
void bsp_dp_aux_reset_interval_reference(void);

// 丢弃环形缓冲里还没被取走的采样，用于比较器启停和用户清零
// notify_loss 为 true 时在后续数据中插入丢样标记，使主机撤销旧配对上下文
// 普通空闲收尾只重置边沿参考，不重启 DMA
void bsp_dp_aux_restart(bool notify_loss);

// 间隔超过这个 tick 数就按空闲上报
#define BSP_DP_AUX_GAP_TICKS (0x00FFu)

uint32_t bsp_dp_aux_get_edge_count(void);

// DMA 缓冲被覆盖的采样数，另含无法确定周数的延迟事件，是计数下界
uint32_t bsp_dp_aux_get_overrun_count(void);
// CC3OF 或 DMA 传输错误的锁存事件数，不等于实际丢失的边沿数
uint32_t bsp_dp_aux_get_capture_overrun_count(void);

// 清零边沿和溢出计数，内部保护 DMA IRQ 并保留它的启用状态
void bsp_dp_aux_clear_counters(void);
