#pragma once

#include <stdint.h>

// CherryUSB HID class 适配层的接口描述
typedef struct {
    const uint8_t *report_desc;  // HID report descriptor
    uint16_t report_desc_size;
    uint16_t in_report_size;  // IN report body 最大长度
    uint8_t in_ep;
    uint8_t out_ep;
    uint16_t in_ep_size;
    uint16_t out_ep_size;
} usb_hid_spec_t;

// 注册 HID 接口和端点
void usb_hid_register(uint8_t busid, const usb_hid_spec_t *spec);

// 转发 USB 事件，处理 reset、disconnect、configured
void usb_hid_on_usb_event(uint8_t busid, uint8_t event);

// 发送一个 IN report，body 长度不能超过 in_report_size
// 返回 1 表示已提交发送，0 表示端点忙或参数非法
uint8_t usb_hid_send_report(const uint8_t *data, uint16_t len);

// 取走完整收到的 OUT report，再允许端点接收下一包，无待收命令时返回 0
uint16_t usb_hid_get_report(uint8_t *data, uint16_t len);
