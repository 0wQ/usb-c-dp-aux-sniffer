# DP AUX HID Demo

基于 CH32L103K8U6 的 DP AUX 被动监听固件，在 Type-C SBU1/SBU2 上采集差分信号，
解码 Manchester-II 码流，再通过 USB HID 将 AUX 帧和捕获统计发送给主机。
帧队列用于缓冲采集突发，USB 按端点可用情况发送。

本工程不初始化 PD/CC，不驱动 AUX，链路握手由外部 DP 源和显示设备完成。
配套 [Web 上位机](../web/) 通过 WebHID 接收数据，完成事务配对、DPCD 字段解析和 I2C 数据组装。

## 数据流

```text
SBU1/SBU2 ─ 100 nF 交流耦合与 1.65 V 偏置 ─> CMP3(PB5 正输入 / PB3 负输入)
                                              │
                     ┌────────────────────────┴────────────────────────┐
                     │                                                 │
              AUX_P / AUX_N 正接                                AUX_P / AUX_N 交换
              比较器输出同相                                    比较器输出反相
              TIM2_CH3 捕获上升沿                               TIM2_CH3 捕获下降沿
                     │                                                 │
                     └────────────────────────┬────────────────────────┘
                                              │
                              DMA 时间戳缓冲(2048×uint16_t)
                                              │
                              dp_aux_capture_poll 计算边沿间隔
                                              │
                         Manchester-II 解码器（AUX 原始上升沿规则）
                                              │
                                  frame_queue(chry_ringbuffer)
                                              │
                                       hid_device_task
                                              │
                                   HID IN report(64B) ─> 主机

主机 ─ HID OUT SET_EDGE(0x04) ─> hid_device_task ─> TIM2_CH3 捕获极性 payload[0] = 0 上升沿 / 1 下降沿
```

线序交换发生在输入接线中，固件通过切换捕获边沿适配比较器输出的反相，不交换引脚。
两种接法都向解码器提供 AUX 原始上升沿对应的间隔，解码规则保持一致。
主机命令由 HID 任务处理，用于启停采集、请求状态、清零统计和切换捕获边沿。

## 目录

```text
firmware/
  platformio.ini
  include/sdk_extern.h        WCH SDK 缺失的 extern
  lib/
    cherryrb/                 chry_ringbuffer，帧队列的底层实现
    cherryusb/                CherryUSB 协议栈与 CH32 USBFS port
  src/
    main.c                    初始化顺序和主循环
    config.h                  DP AUX 捕获参数
    bsp/
      bsp_delay.c             SysTick 计时
      bsp_print.c             LOG，支持 SDI 和 UART
      bsp_uid.c               芯片 UID，用作 USB 序列号
      bsp_usb.c               USBFS 时钟和中断，供 CherryUSB port 调用
      bsp_dp_aux.c            CMP3、TIM2、DMA 捕获前端
    dp_aux/
      dp_aux_decoder.c        Manchester-II 解码，纯逻辑
      dp_aux_capture.c        采集编排，读间隔、解码、入队
      frame_queue.c           帧环形缓冲
    usb/
      hid_protocol.h          HID 线协议定义
      usb_device.c            CherryUSB 初始化
      usb_desc.c              设备描述符
      usb_hid.c               CherryUSB HID class 适配层
      hid_device.c            HID 设备逻辑，上报帧、处理命令
```

## 构建与烧录

在 VS Code 中安装 [PlatformIO IDE](https://marketplace.visualstudio.com/items?itemName=platformio.platformio-ide) 插件，
打开 `firmware/` 目录。连接 WCH-LinkE，在 PlatformIO 的 Project Tasks 中选择
`CH32L103_LINKE`，点击 `Build` 编译、`Upload` 烧录。
插件自动安装 PlatformIO Core，平台自动安装工具链和烧录工具，无需手动安装。

也可以在插件提供的 PlatformIO Core CLI 终端中执行以下命令；独立安装 PlatformIO Core 的用户同样适用。

```bash
cd firmware
# 编译固件
pio run -e CH32L103_LINKE
# 通过 WCH-LinkE 烧录
pio run -e CH32L103_LINKE -t upload
```

| 配置 | 上传方式 | 日志 |
| --- | --- | --- |
| `CH32L103_LINKE` | WCH-LinkE / wlink | 关闭 |
| `CH32L103_USBISP` | USB ISP | 关闭 |
| `CH32L103_LINKE_SDI_PRINT` | WCH-LinkE / wlink | SDI |

使用其他配置时，将构建和上传命令中的 `-e` 替换为对应名称。
SDI 配置的上传命令会开启 WLink SDI 输出。

## 连接与抓包

1. 烧录固件，将目标板 USB0 数据口连接到主机，供电并完成 HID 枚举
2. 接入 DP 源和显示设备，由外部设备建立链路并产生 AUX 事务
3. 在仓库的 `web/` 目录执行 `pnpm install` 和 `pnpm dev`
4. 用 Chrome 或 Edge 打开开发服务器显示的地址，点击连接设备，选择 `DP AUX HID Demo`

WebHID 要求安全上下文，`localhost` 或 HTTPS 均可。
固件启动后自动开启采集，每秒上报一次统计；页面可以启停采集、请求状态和清零统计。
设备侧清零统计会清空帧队列，页面清空列表仅影响已接收的数据。

## 默认采集参数

参数定义在 [`src/config.h`](src/config.h)。

| 参数 | 默认值 |
| --- | --- |
| 比较器输入 | PB5：AUX_P，PB3：AUX_N |
| 捕获路径 | CMP3、TIM2_CH3、DMA1 通道 1 |
| 捕获 tick | 12 MHz，标称 1 Mbps 对应 12 tick/位 |
| 捕获边沿 | 默认上升沿，可切换为下降沿以适配 SBU 线序反接 |
| 比较器迟滞 | 开启 |
| TIM2 输入滤波 | IC3F = `0x03` |
| 捕获环形缓冲 | 2048 个 16 位时间戳，4 KB |
| 帧队列 | 128 条记录 |
| 空闲收尾阈值 | 64 µs |
| 状态上报周期 | 1000 ms |

同步前先检查零位前导，再用 SYNC_END 确定数据起点。
前导要求连续覆盖至少 8 个位周期，允许单个缺沿形成两位周期的间隔。
这是被动监听的容错阈值；DP 2.0 3.4.1 规定发送端有 10～16 个 pre-charge 0 和 16 个 preamble 0。

## USB 标识

| 字段 | 值 |
| --- | --- |
| VID/PID | `0x1A86 / 0x2334` |
| manufacturer | `Mizore` |
| product | `DP AUX HID Demo` |
| serial | 芯片 UID，16 位十六进制字符串 |
| HID IN EP | `0x81`，64 字节，interval 1 |
| HID OUT EP | `0x01`，64 字节，interval 10 |

## HID 协议

IN 和 OUT report 都固定 64 字节，字节 0 是应用层 type 或 opcode，不是 HID Report ID。
所有多字节字段为小端。定义见 [`src/usb/hid_protocol.h`](src/usb/hid_protocol.h)，Web 解析见
[`web/src/lib/hid/protocol.ts`](../web/src/lib/hid/protocol.ts)。
未使用的 report 字节填 0，`len` 仅表示 payload 的有效长度。

FRAME 的 `seq` 在采集入队前生成，从 1 开始，按 uint32 回绕，CLEAR_STATS 不重置它。
相邻 FRAME 序号出现缺口表示数据流不连续，主机应丢弃旧配对和分段组装上下文。
CLEAR_STATS 会跳过一个序号，使下一帧与清零前的上下文断开。
STATUS 的 `seq` 固定为 0，不参与帧序号检查。

FRAME 的 `timestamp_us` 是解码完成时间，不是物理边沿时间，不能用它精确测量应答延迟。
STATUS 使用状态组装时间，两者均按 uint32 在约 71.6 分钟后回绕。

### IN report

```text
type(1) + len(1) + reserved(2) + seq(4) + timestamp_us(4) + payload(52)
```

`type = 0x01` 是 FRAME，payload 为

```text
flags(1) + bit_count(1) + byte_count(1) + raw_bits(1) + data[byte_count]
```

flags 的 bit 0~7 依次为 SYNC_OK、STOP_OK、ALIGN、ALIGN_FIX、INTERVAL、VALID、TRUNCATED、IDLE。
VALID 只表示事务结构自洽，不证明逐位正确；IDLE 表示靠空闲结束帧，未确认 STOP。
INTERVAL 或 TRUNCATED 表示采样或帧不完整，主机应撤销旧上下文。
`bit_count` 等于完整字节数乘 8，`raw_bits` 保留对齐前位数，尾部残余位不会伪装成完整字节。

`type = 0x02` 是 STATUS，payload 为捕获统计

```text
edge_count(4) + frame_count(4) + valid_frame_count(4) + sync_error_count(4)
+ ring_overrun(4) + capture_overrun(4) + queue_drop_count(4)
+ min_interval_ticks(2) + half_ticks(2) + tick_hz_khz(2) + gap_count(2)
```

计数器累计至 CLEAR_STATS 或设备复位；`half_ticks` 和 `tick_hz_khz` 是采集配置，
`min_interval_ticks` 是本次统计期间观察到的最小值，`gap_count` 上报值最大为 `0xFFFF`。
`min_interval_ticks` 排除 0 tick 丢样标记和钳位空闲间隔，未测到边沿间隔时为 `0xFFFF`。
帧队列容量为 128 条，满时丢弃最旧记录，`queue_drop_count` 累加丢弃数。
CLEAR_STATS 同时清空帧队列和未提交的待发帧，已提交 USB 的传输仍会完成。
初始化和 CLEAR_STATS 不产生丢样标记；采集开关切换与真实丢样保留上下文失效通知。
等待帧时的零字节失效通知不计入帧数和同步错误，丢样打断正在解码的帧时仍计入帧数。

### OUT report

```text
opcode(1) + len(1) + payload(62)
```

| opcode | 名称 | 说明 |
| ---: | --- | --- |
| `0x01` | SET_ENABLED | len = 1，payload[0] 为 0 关，1 开 |
| `0x02` | GET_STATUS | len = 0，请求一次 STATUS report |
| `0x03` | CLEAR_STATS | len = 0，清零累计统计并清空帧队列 |
| `0x04` | SET_EDGE | len = 1，payload[0] 为 0 上升沿，1 下降沿，用于手动适配 SBU 线序 |

解码器按 AUX 原始上升沿的间隔规则工作。SBU 线序正确时捕获比较器上升沿；
SBU 线序反接时比较器输出反相，捕获下降沿即可得到 AUX 原始上升沿对应的间隔。
SET_EDGE 只切换捕获边沿，不改变解码规则，也不自动判断线序。
