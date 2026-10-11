#pragma once

#include <stdbool.h>
#include <stdint.h>

// DP AUX Manchester-II 解码器，纯逻辑，不碰硬件
//
// 输入是切片后 AUX 差分对的相邻上升沿间隔，单位是 TIM2 tick
//
// 只捕上升沿的原因，CH32L103 的 TIM2 没有 CCxNP 位，一个捕获通道只能选一种极性
// 只靠上升沿仍能完整还原波形，DP 约定 '0' 为先低后高，'1' 为先高后低，所以一个
// 上升沿要么是某个 '0' 的位中间跳变，要么是两个 '1' 之间的位边界跳变，而间隔序列
// 本身就能区分这两种情况，前提是相位已经确定
//
// SYNC 是 26~32 个连续的 Manchester 0，后面跟高 2T 加低 2T。SYNC_END 到 body 第一个
// 上升沿在 12 MHz 定时器下是 54 或 60 tick。丢沿仍会凑出合法的 24 tick，所以 VALID
// 只代表结构自洽，不证明逐位正确
// 请求为 command 加 20 位地址加 LEN(N-1)，写请求后面跟 N 个数据字节
// 回复为 command 加 4 位 0 填充，再跟 0~16 个数据字节

// 4 + 20 + 8 + 16*8 = 160 bit = 20 字节
#define DP_AUX_MAX_BYTES 20u
#define DP_AUX_MAX_BITS  (DP_AUX_MAX_BYTES * 8u)

// body 的上升沿间隔最多 4 个半位槽，SYNC 最多 10 个
// 超过 10 个半位槽再加容差就按空闲结束，此时 STOP 未经确认

#define DP_AUX_FLAG_SYNC_OK   (1u << 0)  // 已由 SYNC 长间隔确定数据起点
#define DP_AUX_FLAG_STOP_OK   (1u << 1)  // 识别到 STOP 结束沿
#define DP_AUX_FLAG_ALIGN     (1u << 2)  // 位数为整数字节
#define DP_AUX_FLAG_ALIGN_FIX (1u << 3)  // 不足一字节的尾部位，原始位数仍上报
#define DP_AUX_FLAG_INTERVAL  (1u << 4)  // 出现了不合法的间隔
#define DP_AUX_FLAG_TRUNCATED (1u << 6)  // body 超过帧缓冲容量
#define DP_AUX_FLAG_IDLE      (1u << 7)  // 由空闲或收尾终止，STOP 未经确认
#define DP_AUX_FLAG_VALID     (1u << 5)  // 事务体自洽，LEN 与数据长度吻合

// 解出的一帧 AUX 事务 body
typedef struct __attribute__((packed)) {
    uint8_t flags;       // DP_AUX_FLAG_*
    uint8_t bit_count;   // 完整字节位数，等于 byte_count * 8
    uint8_t byte_count;  // data[] 里的有效字节数
    uint8_t reserved;    // 对齐前的原始位数，超过 255 截断
    uint8_t data[DP_AUX_MAX_BYTES];
} dp_aux_frame_t;

// 解码器状态
typedef struct {
    uint16_t half_ticks;  // 半个位周期等于多少个 tick

    uint8_t state;             // 内部状态机状态
    uint8_t preamble_periods;  // SYNC_END 前连续零位间隔覆盖的位周期数
    int32_t slot;              // body 里上一个上升沿落在第几个半位槽
    uint16_t bit_count;        // body 里已输出的位数，也是下一个要输出的位号
    uint8_t data[DP_AUX_MAX_BYTES];
    uint8_t flags;

    // 统计窗口内最短的合法上升沿间隔，调用方过滤掉空闲间隔后填进来
    // 只捕上升沿时最小间隔就是 1 个位周期，可以直接核对 AUX 码率
    uint16_t min_interval_ticks;

    uint32_t frames;
    uint32_t valid_frames;  // 其中事务体自洽的
    uint32_t sync_errors;
    uint32_t sync_gap_count;  // 见过的 SYNC 或空闲长间隔数，约等于事务数
} dp_aux_decoder_t;

// 初始化半位周期，相位由 SYNC_END 决定
void dp_aux_decoder_init(dp_aux_decoder_t *dec, uint16_t half_ticks);

// 帧是否自洽，body 必须是整数字节，且对 DP 原生事务 LEN 要和数据字节数吻合
bool dp_aux_frame_looks_valid(const dp_aux_frame_t *frame);

// 丢弃半帧状态，保留统计，链路空闲后调用
void dp_aux_decoder_reset_stream(dp_aux_decoder_t *dec);

// 送入一个上升沿间隔，返回 true 表示有帧或失效通知输出，结果写在 frame_out
bool dp_aux_decoder_feed(dp_aux_decoder_t *dec, uint16_t interval_ticks, dp_aux_frame_t *frame_out);

// 链路空闲，收尾当前帧，返回 true 表示有帧完成
bool dp_aux_decoder_flush(dp_aux_decoder_t *dec, dp_aux_frame_t *frame_out);
