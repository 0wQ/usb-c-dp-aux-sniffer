#include "bsp/bsp_delay.h"
#include "bsp/bsp_print.h"
#include "bsp/bsp_uid.h"
#include "dp_aux/dp_aux_capture.h"
#include "usb/hid_device.h"
#include "usb/usb_device.h"

#include <ch32l103.h>

int main(void) {
    NVIC_PriorityGroupConfig(NVIC_PriorityGroup_1);
    SystemCoreClockUpdate();

    bsp_delay_init();

    print_init(921600);
    LOG("\r\n");
    LOG("sys_clk: %lu\r\n", (unsigned long)SystemCoreClock);
    LOG("chip_id: 0x%08x\r\n", bsp_get_chip_id());
    char uid_hex[17] = {0};
    bsp_get_uid_hex16(uid_hex);
    LOG("uid: 0x%s\r\n", uid_hex);
    LOG("usb: DP AUX to HID demo\r\n");

    usb_device_init();
    dp_aux_capture_init();

    while (1) {
        dp_aux_capture_poll();
        hid_device_task();
    }
}
