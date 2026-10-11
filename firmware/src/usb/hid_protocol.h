#pragma once

#include <stdint.h>

// 本工程的 HID 线协议，供 WebHID 上位机使用
//
// IN 和 OUT report 都固定 64 字节，所有多字节字段为小端
// 字节 0 是应用层 type 或 opcode，不是 USB HID Report ID

#define HID_REPORT_SIZE 64u

// IN report，设备到主机
//   type(1) + len(1) + reserved(2) + seq(4) + timestamp_us(4) + payload(52)
// type 取值
//   0x01 FRAME  一个解出的 AUX 事务
//   0x02 STATUS 捕获统计

#define HID_REPORT_TYPE_FRAME  0x01u
#define HID_REPORT_TYPE_STATUS 0x02u

#define HID_IN_HEADER_SIZE 12u
#define HID_IN_PAYLOAD_MAX (HID_REPORT_SIZE - HID_IN_HEADER_SIZE)

typedef struct __attribute__((packed)) {
    uint8_t type;       // HID_REPORT_TYPE_*
    uint8_t len;        // payload 有效长度
    uint16_t reserved;  // 保留，填 0
    uint32_t seq;       // FRAME 为采集序号，STATUS 为 0
    uint32_t timestamp_us;
    uint8_t payload[HID_IN_PAYLOAD_MAX];
} hid_in_report_t;

_Static_assert(sizeof(hid_in_report_t) == HID_REPORT_SIZE, "IN report 必须固定 64 字节");

// FRAME payload，4 字节头加最多 20 字节 body
#define HID_FRAME_HEADER_SIZE 4u
#define HID_FRAME_DATA_MAX    20u
#define HID_FRAME_PAYLOAD_MAX (HID_FRAME_HEADER_SIZE + HID_FRAME_DATA_MAX)

typedef struct __attribute__((packed)) {
    uint8_t flags;       // DP_AUX_FLAG_*
    uint8_t bit_count;   // 完整字节位数
    uint8_t byte_count;  // data[] 有效长度
    uint8_t raw_bits;    // 对齐前原始位数
    uint8_t data[HID_FRAME_DATA_MAX];
} hid_frame_payload_t;

// STATUS payload，捕获统计，全部为累计值，直到 CLEAR_STATS 才清零
typedef struct __attribute__((packed)) {
    uint32_t edge_count;         // 累计上升沿数
    uint32_t frame_count;        // 解出的事务数
    uint32_t valid_frame_count;  // 其中事务体自洽的
    uint32_t sync_error_count;   // 锚到 sync 但 body 不合法的次数
    uint32_t ring_overrun;       // 捕获环形缓冲被覆盖的采样数
    uint32_t capture_overrun;    // CC3OF 或 DMA 传输错误次数
    uint32_t queue_drop_count;   // 帧队列因满而丢弃的记录数
    uint16_t min_interval_ticks;
    uint16_t half_ticks;
    uint16_t tick_hz_khz;
    uint16_t gap_count;
} hid_status_payload_t;

_Static_assert(sizeof(hid_status_payload_t) <= HID_IN_PAYLOAD_MAX, "STATUS payload 放不下");

// OUT report，主机到设备
//   opcode(1) + len(1) + payload(62)

#define HID_CMD_SET_ENABLED 0x01u  // payload[0] 为 0 关，1 开
#define HID_CMD_GET_STATUS  0x02u  // 无 payload，请求一次 STATUS report
#define HID_CMD_CLEAR_STATS 0x03u  // 无 payload，清零累计统计
#define HID_CMD_SET_EDGE    0x04u  // payload[0] 为 0 上升沿，1 下降沿

#define HID_OUT_PAYLOAD_MAX (HID_REPORT_SIZE - 2u)

typedef struct __attribute__((packed)) {
    uint8_t opcode;  // HID_CMD_*
    uint8_t len;     // payload 有效长度
    uint8_t payload[HID_OUT_PAYLOAD_MAX];
} hid_out_report_t;

_Static_assert(sizeof(hid_out_report_t) == HID_REPORT_SIZE, "OUT report 必须固定 64 字节");
