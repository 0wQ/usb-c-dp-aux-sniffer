#include "usb/usb_desc.h"

#include "bsp/bsp_uid.h"
#include "usb/hid_device.h"

// USB 设备标识，沿用 DP AUX 固件的 VID/PID，避免和 PD 嗅探固件 0x2333 混淆
#define USB_DEVICE_VID          0x1A86u
#define USB_DEVICE_PID          0x2334u
#define USB_DEVICE_BCD_USB      USB_2_1
#define USB_DEVICE_MANUFACTURER "Mizore"
#define USB_DEVICE_PRODUCT      "DP AUX HID Demo"

// 浏览器通过 BOS 中的 WebUSB 能力读取落地页，URL 不包含 scheme 和结尾 NUL
#define WEBUSB_VENDOR_CODE  0x22u
#define WEBUSB_LANDING_PAGE 0x01u
#define WEBUSB_URL          "0wQ.github.io/usb-c-dp-aux-sniffer/"

static const struct {
    uint8_t length;
    uint8_t type;
    uint8_t scheme;
    char url[sizeof(WEBUSB_URL)];
} webusb_url = {
    .length = 3u + sizeof(WEBUSB_URL) - 1u,
    .type = WEBUSB_URL_TYPE,
    .scheme = WEBUSB_URL_SCHEME_HTTPS,
    .url = WEBUSB_URL,
};

static const uint8_t bos_descriptor[] = {
    USB_BOS_HEADER_DESCRIPTOR_INIT(5u + USB_BOS_CAP_PLATFORM_WEBUSB_DESCRIPTOR_LEN, 1u),
    USB_BOS_CAP_PLATFORM_WEBUSB_DESCRIPTOR_INIT(WEBUSB_VENDOR_CODE, WEBUSB_LANDING_PAGE),
};

// 注册给 CherryUSB，GET_URL 请求由协议栈处理，HID 数据仍走原端点
static const struct usb_webusb_descriptor webusb_url_descriptor = {
    .vendor_code = WEBUSB_VENDOR_CODE,
    .string = (const uint8_t *)&webusb_url,
    .string_len = sizeof(webusb_url) - 1u,
};

static const struct usb_bos_descriptor bos = {
    .string = bos_descriptor,
    .string_len = sizeof(bos_descriptor),
};

static uint8_t device_descriptor[] = {
    USB_DEVICE_DESCRIPTOR_INIT(USB_2_0, 0x00, 0x00, 0x00, 0x0000, 0x0000, 0x0002, 0x01),
};

static const uint8_t device_quality_descriptor[] = {
    0x0a,
    USB_DESCRIPTOR_TYPE_DEVICE_QUALIFIER,
    0x00,
    0x02,
    0x00,
    0x00,
    0x00,
    0x40,
    0x00,
    0x00,
};

static const char lang_id_descriptor[] = {0x09, 0x04};

// USB 序列号取自芯片 UID，首次访问时生成
static char usb_serial_string[17];
static uint8_t usb_serial_inited;

static const char *usb_get_serial_string(void) {
    if (usb_serial_inited == 0) {
        bsp_get_uid_hex16(usb_serial_string);
        usb_serial_inited = 1;
    }

    return usb_serial_string;
}

static void put_u16_le(uint8_t *p, uint16_t value) {
    p[0] = (uint8_t)(value & 0xFFu);
    p[1] = (uint8_t)((value >> 8) & 0xFFu);
}

static const uint8_t *device_descriptor_callback(uint8_t speed) {
    (void)speed;
    put_u16_le(&device_descriptor[2], USB_DEVICE_BCD_USB);
    put_u16_le(&device_descriptor[8], USB_DEVICE_VID);
    put_u16_le(&device_descriptor[10], USB_DEVICE_PID);
    return device_descriptor;
}

static const uint8_t *config_descriptor_callback(uint8_t speed) {
    return hid_device_config_descriptor(speed);
}

static const uint8_t *device_quality_descriptor_callback(uint8_t speed) {
    (void)speed;
    return device_quality_descriptor;
}

static const char *string_descriptor_callback(uint8_t speed, uint8_t index) {
    (void)speed;

    if (index == 0u) {
        return lang_id_descriptor;
    }
    if (index == 1u) {
        return USB_DEVICE_MANUFACTURER;
    }
    if (index == 2u) {
        return USB_DEVICE_PRODUCT;
    }
    if (index == 3) {
        return usb_get_serial_string();
    }
    return NULL;
}

static const struct usb_descriptor usb_descriptor = {
    .device_descriptor_callback = device_descriptor_callback,
    .config_descriptor_callback = config_descriptor_callback,
    .device_quality_descriptor_callback = device_quality_descriptor_callback,
    .string_descriptor_callback = string_descriptor_callback,
    .webusb_url_descriptor = &webusb_url_descriptor,
    .bos_descriptor = &bos,
};

const struct usb_descriptor *usb_get_desc(void) {
    return &usb_descriptor;
}
