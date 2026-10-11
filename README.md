# USB-C DP AUX Sniffer

基于 CH32L103K8U6 的 Type-C SBU 上 DP AUX 被动监听方案，包含固件和 Web 上位机。

在 Type-C 的 SBU1/SBU2 上通过比较器切片 DP AUX 差分对，用定时器捕获和 DMA 采集上升沿
时间戳，解出 Manchester-II 码流，再通过 USB HID 把 AUX 事务和捕获统计发送给主机。
主机侧用 WebHID 接收，完成请求/回复配对、DPCD 与 HDCP 字段解析、I2C 传输聚合、
EDID 重组和 DDC/CI 解码。

本方案不初始化 PD/CC，不驱动 AUX，链路握手由外部 DP 源和显示设备完成，属于纯监听。

## 目录

```text
firmware/     CH32L103 固件，PlatformIO 工程
web/          Web 上位机，pnpm + Vite + React + WebHID
hardware/     原理图
```

## 快速开始

固件：

在 VS Code 中安装 [PlatformIO IDE](https://marketplace.visualstudio.com/items?itemName=platformio.platformio-ide) 插件，
打开 `firmware/` 目录。连接 WCH-LinkE，在 PlatformIO 的 Project Tasks 中选择
`CH32L103_LINKE`，点击 `Build` 编译、`Upload` 烧录。

也可以在插件提供的 PlatformIO Core CLI 终端中执行以下命令；独立安装 PlatformIO Core 的用户同样适用。

```bash
cd firmware
# 编译固件
pio run -e CH32L103_LINKE
# 通过 WCH-LinkE 烧录
pio run -e CH32L103_LINKE -t upload
```

上位机：

```bash
cd web
pnpm install
pnpm dev
```

## 许可证

MIT，见 [LICENSE](LICENSE)。
