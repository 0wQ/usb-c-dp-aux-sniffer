/*
 * Copyright (c) 2022, sakumisu
 *
 * SPDX-License-Identifier: Apache-2.0
 */
#ifndef CHERRYUSB_CONFIG_H
#define CHERRYUSB_CONFIG_H

/* ================ USB common Configuration ================ */

// #define CONFIG_USB_PRINTF(...) printf(__VA_ARGS__)
#define CONFIG_USB_PRINTF(...) do { } while (0)

#ifndef CONFIG_USB_DBG_LEVEL
#define CONFIG_USB_DBG_LEVEL USB_DBG_ERROR
#endif

/* Enable print with color */
// #define CONFIG_USB_PRINTF_COLOR_ENABLE

// #define CONFIG_USB_DCACHE_ENABLE

/* data align size when use dma or use dcache */
#ifdef CONFIG_USB_DCACHE_ENABLE
#define CONFIG_USB_ALIGN_SIZE 32
#else
#define CONFIG_USB_ALIGN_SIZE 4
#endif

/* attribute data into no cache ram */
// #define USB_NOCACHE_RAM_SECTION __attribute__((section(".noncacheable")))
#define USB_NOCACHE_RAM_SECTION

/* use usb_memcpy default for high performance but cost more flash memory.
 * And, arm libc has a bug that memcpy() may cause data misalignment when the size is not a multiple of 4.
*/
// #define CONFIG_USB_MEMCPY_DISABLE

/* ================= USB Device Stack Configuration ================ */

/* Ep0 in and out transfer buffer.
 *
 * Must cover the largest control-IN response the descriptors hand out. The
 * WinUSB MS OS 2.0 descriptor set is 170 bytes (10 byte set header + 160 byte
 * function subset); when a host asks for more than this buffer holds, the core
 * cannot stage the reply and stalls EP0 instead -- usbd_core.c:
 *
 *   if (ep0_data_buf_residue > CONFIG_USBDEV_REQUEST_BUFFER_LEN)
 *       usbd_ep_set_stall(busid, USB_CONTROL_IN_EP0);
 *
 * Measured on hardware: wLength 128 returns the data, 129 stalls. Windows asks
 * for the descriptor set with wLength=168, so at 128 the WCID handshake never
 * completes and driver binding silently fails. Stalling EP0 also leaves the
 * host unable to recover the interface (clearHalt goes over EP0 too). */
#ifndef CONFIG_USBDEV_REQUEST_BUFFER_LEN
#define CONFIG_USBDEV_REQUEST_BUFFER_LEN 256
#endif

/* Send ep0 in data from user buffer instead of copying into ep0 reqdata
 * Please note that user buffer must be aligned with CONFIG_USB_ALIGN_SIZE
*/
// #define CONFIG_USBDEV_EP0_INDATA_NO_COPY

/* Check if the input descriptor is correct */
// #define CONFIG_USBDEV_DESC_CHECK

/* Enable test mode */
// #define CONFIG_USBDEV_TEST_MODE

/* enable advance desc register api */
#define CONFIG_USBDEV_ADVANCE_DESC

#ifndef CONFIG_USBDEV_MSC_MAX_LUN
#define CONFIG_USBDEV_MSC_MAX_LUN 1
#endif

#ifndef CONFIG_USBDEV_MSC_MAX_BUFSIZE
#define CONFIG_USBDEV_MSC_MAX_BUFSIZE 512
#endif

#ifndef CONFIG_USBDEV_MSC_MANUFACTURER_STRING
#define CONFIG_USBDEV_MSC_MANUFACTURER_STRING ""
#endif

#ifndef CONFIG_USBDEV_MSC_PRODUCT_STRING
#define CONFIG_USBDEV_MSC_PRODUCT_STRING ""
#endif

#ifndef CONFIG_USBDEV_MSC_VERSION_STRING
#define CONFIG_USBDEV_MSC_VERSION_STRING "0.01"
#endif

/* move msc read & write from isr to while(1), you should call usbd_msc_polling in while(1) */
// #define CONFIG_USBDEV_MSC_POLLING

/* move msc read & write from isr to thread */
// #define CONFIG_USBDEV_MSC_THREAD

#ifndef CONFIG_USBDEV_MSC_PRIO
#define CONFIG_USBDEV_MSC_PRIO 4
#endif

#ifndef CONFIG_USBDEV_MSC_STACKSIZE
#define CONFIG_USBDEV_MSC_STACKSIZE 2048
#endif

/* ================ USB Device Port Configuration ================*/

#ifndef CONFIG_USBDEV_MAX_BUS
#define CONFIG_USBDEV_MAX_BUS 1
#endif

/* only useful for musb/ch32/chipidea */
// #ifndef CONFIG_USBDEV_EP_NUM
// #define CONFIG_USBDEV_EP_NUM 8
// #endif


#endif
