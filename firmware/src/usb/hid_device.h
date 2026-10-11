#pragma once

#include "usbd_core.h"

#include <stdint.h>

// demo HID 设备逻辑
//
// 负责 report descriptor、配置描述符、注册 HID 接口，并在主循环里把帧队列里的
// AUX 记录封成 IN report 上报，同时处理主机下发的 OUT report 命令

// 注册 HID 接口
void hid_device_register(uint8_t busid);

// 返回当前速度对应的配置描述符，内部会按实际 report descriptor 长度回填
const uint8_t *hid_device_config_descriptor(uint8_t speed);

// 主循环任务，处理命令、周期状态和帧上报
void hid_device_task(void);
