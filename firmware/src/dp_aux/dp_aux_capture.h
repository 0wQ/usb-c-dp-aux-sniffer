#pragma once

#include <stdbool.h>
#include <stdint.h>

// DP AUX 采集编排
//
// 把捕获前端、Manchester 解码器和帧队列串起来
//   bsp_dp_aux 读上升沿间隔，dp_aux_decoder 解码，frame_queue 入队
// 主循环反复调用 dp_aux_capture_poll()

// 捕获统计快照，供 HID 状态上报使用
typedef struct {
    uint32_t edge_count;          // 累计捕获到的上升沿数
    uint32_t frame_count;         // 解出的事务数
    uint32_t valid_frame_count;   // 其中事务体自洽的
    uint32_t sync_error_count;    // 锚到 sync 但 body 不合法的次数
    uint32_t ring_overrun;        // 捕获 DMA 环形缓冲被覆盖的采样数
    uint32_t capture_overrun;     // CC3OF 或 DMA 传输错误次数
    uint32_t queue_drop_count;    // 帧队列因满而丢弃的记录数
    uint16_t min_interval_ticks;  // 见过的最短合法上升沿间隔，标称 1 个位周期
    uint16_t half_ticks;          // 解码器使用的半位周期，单位 tick
    uint16_t tick_hz_khz;         // 捕获 tick 频率，单位 kHz
    uint16_t gap_count;           // 被判定为空闲的间隔数
} dp_aux_stats_t;

// 初始化捕获前端、解码器和帧队列
void dp_aux_capture_init(void);

// 主循环轮询，取走捕获到的间隔，解码，把完成的帧推进帧队列
void dp_aux_capture_poll(void);

// 打开或关闭捕获
void dp_aux_capture_set_enabled(bool en);
bool dp_aux_capture_is_enabled(void);

// 选择比较器捕获边沿，false 为上升沿，true 为下降沿
void dp_aux_capture_set_falling_edge(bool falling);

// 清零累计统计，含边沿数、帧数、最短间隔、空闲间隔数、队列丢弃数
void dp_aux_capture_clear_stats(void);

// 读取当前统计快照
void dp_aux_capture_get_stats(dp_aux_stats_t *out);
