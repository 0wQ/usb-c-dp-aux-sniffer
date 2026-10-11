// DDC/CI 解码，I2C 地址 0x37
//
// DDC/CI 报文格式：源地址(1) + 头(1) + opcode(1) + 数据 + 校验和(1)
// 头 = 0x80 | 长度，长度是 opcode 加数据的字节数，不含校验和
// 校验和 = XOR(0x6E, 源地址, 头, opcode, 数据)，包含显示器的 I2C 写地址 0x6E
//
// 这里只解主机写和显示器回复，VCP 码表只列常用的，未知码保留原值

export type DdcField = {
  name: string
  value: string
}

export type DdcResult = {
  kind: 'source' | 'message'
  source: number
  opcode: number | null
  name: string
  checksumOk: boolean | null
  fields: DdcField[]
}

// 常用 VCP 码，见 MCCS 标准
const VCP_NAMES: Record<number, string> = {
  16: '亮度',
  18: '对比度',
  96: '输入源',
  98: '音量',
  108: '红增益',
  110: '绿增益',
  112: '蓝增益',
  172: '水平频率',
  174: '垂直频率',
  182: '使用时间',
  214: '电源模式',
  223: 'VCP 版本',
}

const OPCODE_NAMES: Record<number, string> = {
  1: 'Get VCP Feature',
  2: 'VCP Feature Reply',
  3: 'Set VCP Feature',
  4: 'Save Current Settings',
  5: 'Capabilities Request',
  6: 'Capabilities Reply',
  7: 'Get Timing Report',
  8: 'Timing Report',
}

const POWER_MODES: Record<number, string> = {
  1: '开机',
  2: '待机',
  3: '挂起',
  4: '关机',
  5: '关机（省电）',
}

function hex(value: number, width = 2): string {
  return `0x${value.toString(16).toUpperCase().padStart(width, '0')}`
}

function vcpLabel(code: number): string {
  const name = VCP_NAMES[code]
  return name ? `${hex(code)} (${name})` : hex(code)
}

export function describeDdc(data: Uint8Array, source = 0x51): DdcResult | null {
  // 单字节写就是源地址，后面跟的才是报文
  if (data.length === 1 && (data[0] === 0x51 || data[0] === 0x6e)) {
    const value = data[0]
    return {
      kind: 'source',
      source: value,
      opcode: null,
      name: '源地址',
      checksumOk: null,
      fields: [
        {
          name: '源地址',
          value: value === 0x51 ? '0x51（主机）' : '0x6E（显示器）',
        },
      ],
    }
  }

  if (data.length < 3) return null
  const header = data[0] ?? 0
  if ((header & 0x80) === 0) return null
  const length = header & 0x7f
  // 头之后有 length 个字节，再加一个校验和
  if (data.length !== length + 2) return null

  const opcode = data[1] ?? 0
  const payload = data.subarray(2, 1 + length)
  const checksum = data[data.length - 1] ?? 0
  let xor = 0x6e ^ source ^ header ^ opcode
  for (const byte of payload) xor ^= byte
  const checksumOk = (xor & 0xff) === checksum

  const fields: DdcField[] = [
    {
      name: '源地址',
      value: source === 0x51 ? '0x51（主机）' : '0x6E（显示器）',
    },
    { name: '长度', value: String(length) },
  ]

  if (opcode === 0x01 && payload.length >= 1) {
    fields.push({ name: 'VCP', value: vcpLabel(payload[0] ?? 0) })
  } else if (opcode === 0x03 && payload.length >= 3) {
    const code = payload[0] ?? 0
    const value = ((payload[1] ?? 0) << 8) | (payload[2] ?? 0)
    fields.push({ name: 'VCP', value: vcpLabel(code) })
    fields.push({
      name: '值',
      value:
        code === 0xd6
          ? `${value}（${POWER_MODES[value] ?? '保留'}）`
          : String(value),
    })
  } else if (opcode === 0x02 && payload.length >= 7) {
    const code = payload[1] ?? 0
    const max = ((payload[3] ?? 0) << 8) | (payload[4] ?? 0)
    const current = ((payload[5] ?? 0) << 8) | (payload[6] ?? 0)
    fields.push({ name: '结果', value: hex(payload[0] ?? 0) })
    fields.push({ name: 'VCP', value: vcpLabel(code) })
    fields.push({ name: '类型', value: hex(payload[2] ?? 0) })
    fields.push({ name: '最大值', value: String(max) })
    fields.push({
      name: '当前值',
      value:
        code === 0xd6
          ? `${current}（${POWER_MODES[current] ?? '保留'}）`
          : String(current),
    })
  } else if (payload.length > 0) {
    fields.push({
      name: '数据',
      value: Array.from(payload, (byte) =>
        byte.toString(16).toUpperCase().padStart(2, '0'),
      ).join(' '),
    })
  }

  fields.push({
    name: '校验和',
    value: `${hex(checksum)} ${checksumOk ? 'ok' : 'BAD'}`,
  })

  return {
    kind: 'message',
    source,
    opcode,
    name: OPCODE_NAMES[opcode] ?? `opcode ${hex(opcode)}`,
    checksumOk,
    fields,
  }
}
