#include "usb/usb_hid.h"

#include "bsp/bsp_usb.h"
#include "usbd_core.h"
#include "usbd_hid.h"

#include <string.h>

#define HID_STATE_IDLE      0
#define HID_STATE_BUSY      1
#define HID_MAX_REPORT_SIZE 64u

USB_NOCACHE_RAM_SECTION USB_MEM_ALIGNX static uint8_t hid_read_buffer[HID_MAX_REPORT_SIZE];
USB_NOCACHE_RAM_SECTION USB_MEM_ALIGNX static uint8_t hid_send_buffer[HID_MAX_REPORT_SIZE];

// IN 端点状态，只有 IDLE 时才能提交新的发送
static volatile uint8_t hid_state;
static volatile uint8_t hid_read_ready;
static volatile uint16_t hid_read_len;
static uint8_t hid_busid;
static const usb_hid_spec_t *hid_spec;

static void usbd_hid_in_callback(uint8_t busid, uint8_t ep, uint32_t nbytes) {
    (void)busid;
    (void)ep;
    (void)nbytes;
    hid_state = HID_STATE_IDLE;
}

// 收完后保留缓冲并让端点维持 NAK，主循环取走命令后再接收下一包
static void usbd_hid_out_callback(uint8_t busid, uint8_t ep, uint32_t nbytes) {
    (void)busid;
    (void)ep;
    hid_read_len = (uint16_t)nbytes;
    hid_read_ready = 1u;
}

static struct usbd_endpoint hid_in_ep = {
    .ep_cb = usbd_hid_in_callback,
    .ep_addr = 0u,
};

static struct usbd_endpoint hid_out_ep = {
    .ep_cb = usbd_hid_out_callback,
    .ep_addr = 0u,
};

static struct usbd_interface hid_intf;

void usb_hid_register(uint8_t busid, const usb_hid_spec_t *spec) {
    if (spec == NULL) {
        return;
    }
    if (spec->in_ep_size > HID_MAX_REPORT_SIZE || spec->out_ep_size > HID_MAX_REPORT_SIZE) {
        return;
    }
    hid_busid = busid;
    hid_spec = spec;
    hid_in_ep.ep_addr = spec->in_ep;
    hid_out_ep.ep_addr = spec->out_ep;

    usbd_add_interface(busid, usbd_hid_init_intf(busid, &hid_intf, spec->report_desc, spec->report_desc_size));
    usbd_add_endpoint(busid, &hid_in_ep);
    usbd_add_endpoint(busid, &hid_out_ep);
}

static void usb_hid_on_reset(void) {
    hid_state = HID_STATE_IDLE;
    hid_read_ready = 0u;
    hid_read_len = 0u;
}

static void usb_hid_on_configured(uint8_t busid) {
    if (hid_spec == NULL) {
        return;
    }
    hid_state = HID_STATE_IDLE;
    hid_read_ready = 0u;
    usbd_ep_start_read(busid, hid_spec->out_ep, hid_read_buffer, hid_spec->out_ep_size);
}

void usb_hid_on_usb_event(uint8_t busid, uint8_t event) {
    switch (event) {
        case USBD_EVENT_RESET:
        case USBD_EVENT_DISCONNECTED:
            usb_hid_on_reset();
            return;
        case USBD_EVENT_CONFIGURED:
            usb_hid_on_configured(busid);
            return;
        default:
            return;
    }
}

uint8_t usb_hid_send_report(const uint8_t *data, uint16_t len) {
    if (hid_spec == NULL) {
        return 0;
    }
    const uint16_t max_body_len = hid_spec->in_report_size;

    if (data == NULL) {
        return 0;
    }
    if (len > max_body_len || hid_spec->in_ep_size > HID_MAX_REPORT_SIZE) {
        return 0;
    }

    // 提交和 BUSY 状态在同一个临界区内，完成或复位中断只在提交之后处理
    const uint32_t irq_enabled = bsp_usb_lock();
    if (hid_state != HID_STATE_IDLE) {
        bsp_usb_unlock(irq_enabled);
        return 0u;
    }
    memset(hid_send_buffer, 0, sizeof(hid_send_buffer));
    memcpy(hid_send_buffer, data, len);

    hid_state = HID_STATE_BUSY;
    if (usbd_ep_start_write(hid_busid, hid_spec->in_ep, hid_send_buffer, hid_spec->in_ep_size) == 0) {
        bsp_usb_unlock(irq_enabled);
        return 1;
    }

    hid_state = HID_STATE_IDLE;
    bsp_usb_unlock(irq_enabled);
    return 0;
}

uint16_t usb_hid_get_report(uint8_t *data, uint16_t len) {
    if (hid_spec == NULL || data == NULL || len == 0u) {
        return 0u;
    }

    // USB 复位会撤销待收命令，复制和重新允许接收必须与复位互斥
    const uint32_t irq_enabled = bsp_usb_lock();
    if (hid_read_ready == 0u) {
        bsp_usb_unlock(irq_enabled);
        return 0u;
    }
    const uint16_t copy_len = (len < hid_read_len) ? len : hid_read_len;
    memcpy(data, hid_read_buffer, copy_len);
    hid_read_ready = 0u;
    usbd_ep_start_read(hid_busid, hid_spec->out_ep, hid_read_buffer, hid_spec->out_ep_size);
    bsp_usb_unlock(irq_enabled);
    return copy_len;
}
