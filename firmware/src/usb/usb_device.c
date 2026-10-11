#include "usb/usb_device.h"

#include "bsp/bsp_print.h"
#include "usb/hid_device.h"
#include "usb/usb_desc.h"
#include "usb/usb_hid.h"
#include "usbd_core.h"

// 记录枚举过程中的关键事件，并把事件转发给 HID 层处理端点状态
static void usbd_event_handler(uint8_t busid, uint8_t event) {
    switch (event) {
        case USBD_EVENT_RESET:
            LOG("usb: reset\r\n");
            break;
        case USBD_EVENT_CONNECTED:
            LOG("usb: connected\r\n");
            break;
        case USBD_EVENT_DISCONNECTED:
            LOG("usb: disconnected\r\n");
            break;
        case USBD_EVENT_RESUME:
            LOG("usb: resume\r\n");
            break;
        case USBD_EVENT_SUSPEND:
            LOG("usb: suspend\r\n");
            break;
        case USBD_EVENT_CONFIGURED:
            LOG("usb: configured\r\n");
            break;
        case USBD_EVENT_SET_REMOTE_WAKEUP:
            break;
        case USBD_EVENT_CLR_REMOTE_WAKEUP:
            break;
        default:
            break;
    }
    usb_hid_on_usb_event(busid, event);
}

void usb_device_init(void) {
    usbd_desc_register(0, usb_get_desc());
    hid_device_register(0);
    usbd_initialize(0, 0, usbd_event_handler);
}
