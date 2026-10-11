#pragma once

#include "dp_aux/dp_aux_decoder.h"

#include <stdbool.h>
#include <stdint.h>

// 帧环形缓冲
//
// 采集和解码在主循环里产生帧，USB HID 也在主循环里取帧发送，两者速度不匹配
// 一次 AUX 事务几十微秒就结束，而 HID 最快一个 report 每毫秒
// 这里用 cherryrb 的 chry_ringbuffer 存固定大小的记录，把采集突发和 USB 节流隔离
// 队列满时丢弃最旧的记录，保留最新，并累加 drop_count

// 一条解码记录的队列格式，timestamp_us 是解码完成时的时间戳
typedef struct __attribute__((packed)) {
    uint32_t seq;  // 入队前生成的帧序号，队列丢帧后保留缺口
    uint32_t timestamp_us;
    uint8_t flags;       // DP_AUX_FLAG_*
    uint8_t bit_count;   // 完整字节位数
    uint8_t byte_count;  // data[] 有效长度
    uint8_t raw_bits;    // 对齐前原始位数
    uint8_t data[DP_AUX_MAX_BYTES];
} dp_aux_record_t;

_Static_assert(sizeof(dp_aux_record_t) == 32u, "帧记录布局必须固定");

// 初始化队列
void frame_queue_init(void);

// 入队一条记录，队列满时丢弃最旧的记录并计入 drop_count
// 返回 true 表示记录已写入，队列满时同时丢掉一条最旧记录
bool frame_queue_push(const dp_aux_record_t *rec);

// 出队一条记录，返回 true 表示取到一条记录
bool frame_queue_pop(dp_aux_record_t *rec);

// 队列当前积压的记录数
uint32_t frame_queue_get_count(void);

// 因队列满而丢弃的记录数
uint32_t frame_queue_get_drop_count(void);

// 清空队列和丢弃计数
void frame_queue_reset(void);
