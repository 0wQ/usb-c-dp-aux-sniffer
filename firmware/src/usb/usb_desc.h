#pragma once

#include "usbd_core.h"
#include "usbd_hid.h"

#include <stdint.h>

#define USB_DEV_MAX_POWER_MA 50

// HID 配置描述符总长度，配置 9 字节加接口 9 字节加 HID 9 字节加两个端点各 7 字节
#define USB_DEVICE_HID_CONFIG_DESC_SIZE (9u + 9u + 9u + 7u + 7u)
// 配置描述符里 report descriptor 长度字段的偏移
#define USB_DEVICE_HID_REPORT_DESC_SIZE_OFFSET 25u

// 组装一个 HID 配置描述符，in_interval 和 out_interval 由调用方给出
#define USB_DEVICE_HID_CONFIG_DESCRIPTOR_INIT(in_ep, in_ep_size, in_interval, out_ep, out_ep_size, out_interval)           \
    USB_CONFIG_DESCRIPTOR_INIT(USB_DEVICE_HID_CONFIG_DESC_SIZE, 0x01, 0x01, USB_CONFIG_BUS_POWERED, USB_DEV_MAX_POWER_MA), \
        0x09,                                                                                                              \
        USB_DESCRIPTOR_TYPE_INTERFACE,                                                                                     \
        0x00,                                                                                                              \
        0x00,                                                                                                              \
        0x02,                                                                                                              \
        0x03,                                                                                                              \
        0x00,                                                                                                              \
        0x00,                                                                                                              \
        0x00,                                                                                                              \
        0x09,                                                                                                              \
        HID_DESCRIPTOR_TYPE_HID,                                                                                           \
        0x11,                                                                                                              \
        0x01,                                                                                                              \
        0x00,                                                                                                              \
        0x01,                                                                                                              \
        0x22,                                                                                                              \
        0x00,                                                                                                              \
        0x00,                                                                                                              \
        0x07,                                                                                                              \
        USB_DESCRIPTOR_TYPE_ENDPOINT,                                                                                      \
        (in_ep),                                                                                                           \
        0x03,                                                                                                              \
        WBVAL(in_ep_size),                                                                                                 \
        (in_interval),                                                                                                     \
        0x07,                                                                                                              \
        USB_DESCRIPTOR_TYPE_ENDPOINT,                                                                                      \
        (out_ep),                                                                                                          \
        0x03,                                                                                                              \
        WBVAL(out_ep_size),                                                                                                \
        (out_interval)

const struct usb_descriptor *usb_get_desc(void);
