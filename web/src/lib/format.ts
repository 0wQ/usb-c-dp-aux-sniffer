// 展示层格式化工具

export function formatHex(bytes: Uint8Array, separator = ' '): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    separator,
  )
}

// 时间戳格式化为 MM:SS:MMM:UUU，和 PD sniffer 一致
// 分钟超过 99 时不补零，秒补 2 位，毫秒和微秒各补 3 位
export function formatTimestamp(microseconds: number): string {
  const total = Math.max(0, Math.floor(microseconds))
  const minutes = Math.floor(total / 60_000_000)
  const seconds = Math.floor((total % 60_000_000) / 1_000_000)
  const millis = Math.floor((total % 1_000_000) / 1_000)
  const micros = total % 1_000
  const pad = (value: number, length = 2) =>
    value.toString().padStart(length, '0')
  return [
    minutes >= 100 ? String(minutes) : pad(minutes),
    pad(seconds),
    pad(millis, 3),
    pad(micros, 3),
  ].join(':')
}

// DP AUX 地址是 20 位，统一补足 5 位十六进制
export function formatAddress(address: number): string {
  return `0x${address.toString(16).padStart(5, '0')}`
}

// 把时间跨度格式化为毫秒或秒，用于概览条
// 输入是微秒
export function formatSpan(microseconds: number): string {
  if (microseconds < 1000) return `${microseconds.toFixed(0)} us`
  if (microseconds < 1_000_000) return `${(microseconds / 1000).toFixed(1)} ms`
  return `${(microseconds / 1_000_000).toFixed(2)} s`
}

// 由 tick 频率和半位周期推算 AUX 位速率
// 半位周期单位是 tick，一个位周期等于 2 个半位周期
export function estimateBitrateKhz(
  tickHzKhz: number,
  halfTicks: number,
): number | null {
  if (tickHzKhz === 0 || halfTicks === 0) return null
  return tickHzKhz / (2 * halfTicks)
}
