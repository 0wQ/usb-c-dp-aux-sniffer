#include "usb/hid_device.h"

#include "bsp/bsp_delay.h"
#include "config.h"
#include "dp_aux/dp_aux_capture.h"
#include "dp_aux/frame_queue.h"
#include "usb/hid_protocol.h"
#include "usb/usb_desc.h"
#include "usb/usb_hid.h"

#include <stddef.h>
#include <string.h>

#define HID_IN_EP        0x81u
#define HID_OUT_EP       0x01u
#define HID_EP_SIZE      64u
#define HID_IN_INTERVAL  1u
#define HID_OUT_INTERVAL 10u

// vendor HID report descriptor，输入输出各 64 字节
static const uint8_t hid_report_desc[] = {
    0x06, 0x00, 0xFF,
    0x09, 0x01,
    0xA1, 0x01,
    0x09, 0x01,
    0x15, 0x00,
    0x26, 0xFF, 0x00,
    0x95, HID_REPORT_SIZE,
    0x75, 0x08,
    0x81, 0x02,
    0x09, 0x01,
    0x15, 0x00,
    0x26, 0xFF, 0x00,
    0x95, HID_REPORT_SIZE,
    0x75, 0x08,
    0x91, 0x02,
    0xC0};

static const usb_hid_spec_t s_hid_spec = {
    .report_desc = hid_report_desc,
    .report_desc_size = sizeof(hid_report_desc),
    .in_report_size = HID_REPORT_SIZE,
    .in_ep = HID_IN_EP,
    .out_ep = HID_OUT_EP,
    .in_ep_size = HID_EP_SIZE,
    .out_ep_size = HID_EP_SIZE,
};

static uint8_t s_config_descriptor[USB_DEVICE_HID_CONFIG_DESC_SIZE] = {
    USB_DEVICE_HID_CONFIG_DESCRIPTOR_INIT(
        HID_IN_EP,
        HID_EP_SIZE,
        HID_IN_INTERVAL,
        HID_OUT_EP,
        HID_EP_SIZE,
        HID_OUT_INTERVAL),
};

static bool s_status_pending;
static uint32_t s_last_status_ms;
static bool s_frame_pending_valid;
static dp_aux_record_t s_frame_pending;

static void put_u16_le(uint8_t *p, uint16_t value) {
    p[0] = (uint8_t)(value & 0xFFu);
    p[1] = (uint8_t)((value >> 8) & 0xFFu);
}

void hid_device_register(uint8_t busid) {
    usb_hid_register(busid, &s_hid_spec);
}

const uint8_t *hid_device_config_descriptor(uint8_t speed) {
    (void)speed;
    put_u16_le(&s_config_descriptor[USB_DEVICE_HID_REPORT_DESC_SIZE_OFFSET], s_hid_spec.report_desc_size);
    return s_config_descriptor;
}

// 组装并发送一个 STATUS report
static bool hid_device_send_status(void) {
    dp_aux_stats_t stats;
    dp_aux_capture_get_stats(&stats);

    hid_in_report_t report = {0};
    report.type = HID_REPORT_TYPE_STATUS;
    report.len = (uint8_t)sizeof(hid_status_payload_t);
    // STATUS 不占用帧序号，seq 保持为 0
    report.timestamp_us = micros();

    hid_status_payload_t *payload = (hid_status_payload_t *)report.payload;
    payload->edge_count = stats.edge_count;
    payload->frame_count = stats.frame_count;
    payload->valid_frame_count = stats.valid_frame_count;
    payload->sync_error_count = stats.sync_error_count;
    payload->ring_overrun = stats.ring_overrun;
    payload->capture_overrun = stats.capture_overrun;
    payload->queue_drop_count = stats.queue_drop_count;
    payload->min_interval_ticks = stats.min_interval_ticks;
    payload->half_ticks = stats.half_ticks;
    payload->tick_hz_khz = stats.tick_hz_khz;
    payload->gap_count = stats.gap_count;

    if (usb_hid_send_report((const uint8_t *)&report, sizeof(report)) == 0u) {
        return false;
    }
    return true;
}

// 组装并发送一个 FRAME report
static bool hid_device_send_frame(const dp_aux_record_t *rec) {
    uint8_t data_len = rec->byte_count;
    if (data_len > HID_FRAME_DATA_MAX) {
        data_len = HID_FRAME_DATA_MAX;
    }

    hid_in_report_t report = {0};
    report.type = HID_REPORT_TYPE_FRAME;
    report.len = (uint8_t)(HID_FRAME_HEADER_SIZE + data_len);
    report.seq = rec->seq;
    report.timestamp_us = rec->timestamp_us;

    hid_frame_payload_t *payload = (hid_frame_payload_t *)report.payload;
    payload->flags = rec->flags;
    payload->bit_count = rec->bit_count;
    payload->byte_count = data_len;
    payload->raw_bits = rec->raw_bits;
    memcpy(payload->data, rec->data, data_len);

    if (usb_hid_send_report((const uint8_t *)&report, sizeof(report)) == 0u) {
        return false;
    }
    return true;
}

static void hid_device_handle_cmd(const uint8_t *data, uint16_t len) {
    if (data == NULL || len < 2u) {
        return;
    }

    const hid_out_report_t *cmd = (const hid_out_report_t *)data;
    if (cmd->opcode == 0x00u) {
        return;
    }
    if (cmd->len > HID_OUT_PAYLOAD_MAX || len < (uint16_t)(2u + cmd->len)) {
        return;
    }

    switch (cmd->opcode) {
        case HID_CMD_SET_ENABLED:
            if (cmd->len != 1u) {
                return;
            }
            dp_aux_capture_set_enabled(cmd->payload[0] != 0u);
            return;
        case HID_CMD_SET_EDGE:
            if (cmd->len != 1u || cmd->payload[0] > 1u) {
                return;
            }
            dp_aux_capture_set_falling_edge(cmd->payload[0] != 0u);
            return;
        case HID_CMD_GET_STATUS:
            if (cmd->len != 0u) {
                return;
            }
            s_status_pending = true;
            return;
        case HID_CMD_CLEAR_STATS:
            if (cmd->len != 0u) {
                return;
            }
            dp_aux_capture_clear_stats();
            // 清空已出队但尚未提交 USB 的旧帧，已提交的传输仍由端点完成
            s_frame_pending_valid = false;
            s_status_pending = true;
            return;
        default:
            return;
    }
}

static void hid_device_poll_host_cmd(void) {
    uint8_t report[HID_REPORT_SIZE];
    const uint16_t len = usb_hid_get_report(report, sizeof(report));
    hid_device_handle_cmd(report, len);
}

void hid_device_task(void) {
    hid_device_poll_host_cmd();

    // 周期状态和 GET_STATUS 请求都走同一条待发路径
    const uint32_t now_ms = millis();
    if (!s_status_pending && (uint32_t)(now_ms - s_last_status_ms) >= CONFIG_DP_AUX_STATUS_PERIOD_MS) {
        s_status_pending = true;
        s_last_status_ms = now_ms;
    }
    if (s_status_pending) {
        if (hid_device_send_status()) {
            s_status_pending = false;
        } else {
            return;  // 端点忙，下一轮再试
        }
    }

    // 端点忙时保留待发帧，避免出队后丢失
    if (!s_frame_pending_valid && frame_queue_pop(&s_frame_pending)) {
        s_frame_pending_valid = true;
    }
    if (s_frame_pending_valid && hid_device_send_frame(&s_frame_pending)) {
        s_frame_pending_valid = false;
    }
}
