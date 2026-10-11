// EDID 基础块、CTA-861 和 DisplayID 字段解码
//
// 移植自 firmware/tools/dp_aux_edid.py，输出改成带字节区间的结构化字段
// 只在块校验通过后做语义解码，未定义的 tag 保留原始载荷并明确标注未解析
// 文本只在协议定义的文本描述符里解码，不从二进制数据猜

export type EdidField = {
  bytes: string
  name: string
  value: string
}

export type EdidSection = {
  title: string
  range: string
  raw: string
  fields: EdidField[]
}

export type EdidResult = {
  sections: EdidSection[]
  errors: string[]
}

// NUL 填充的协议文本，只接受可打印 ASCII
export function protocolAscii(data: Uint8Array): string | null {
  let end = data.length
  while (end > 0 && data[end - 1] === 0) end -= 1
  const value = data.subarray(0, end)
  for (const byte of value) {
    if (byte < 32 || byte > 126) return null
  }
  return String.fromCharCode(...value)
}

function hx(data: Uint8Array): string {
  return Array.from(data, (byte) =>
    byte.toString(16).toUpperCase().padStart(2, '0'),
  ).join(' ')
}

function u16le(data: Uint8Array, offset: number): number {
  return (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8)
}

function u16be(data: Uint8Array, offset: number): number {
  return ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0)
}

function u24le(data: Uint8Array, offset: number): number {
  return (
    (data[offset] ?? 0) |
    ((data[offset + 1] ?? 0) << 8) |
    ((data[offset + 2] ?? 0) << 16)
  )
}

function u32le(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] ?? 0) |
      ((data[offset + 1] ?? 0) << 8) |
      ((data[offset + 2] ?? 0) << 16) |
      ((data[offset + 3] ?? 0) << 24)) >>>
    0
  )
}

// EDID 版本比较，和 Python 的元组比较等价
function versionAtLeast(
  data: Uint8Array,
  major: number,
  minor: number,
): boolean {
  const majorValue = data[18] ?? 0
  const minorValue = data[19] ?? 0
  return majorValue > major || (majorValue === major && minorValue >= minor)
}

// 18 字节详细时序描述符，前两字节为 0 表示不是时序
function detailedTiming(
  data: Uint8Array,
  title: string,
  offset: number,
): EdidSection | null {
  if (data.length !== 18 || (data[0] === 0 && data[1] === 0)) return null
  const clock = u16le(data, 0) * 10000
  const hactive = (data[2] ?? 0) | (((data[4] ?? 0) & 0xf0) << 4)
  const hblank = (data[3] ?? 0) | (((data[4] ?? 0) & 15) << 8)
  let vactive = (data[5] ?? 0) | (((data[7] ?? 0) & 0xf0) << 4)
  const vblank = (data[6] ?? 0) | (((data[7] ?? 0) & 15) << 8)
  const interlaced = !!((data[17] ?? 0) & 128)
  // 隔行扫描的垂直量描述的是一个场，换算成整帧要乘 2 再加一行
  let vtotal = vactive + vblank
  if (interlaced) {
    vtotal = vtotal * 2 + 1
    vactive *= 2
  }
  const total = (hactive + hblank) * vtotal
  const rate = total ? (clock / total).toFixed(2) : 'undefined'
  return {
    title,
    range: `${offset.toString(16).toUpperCase().padStart(2, '0')}h`,
    raw: hx(data),
    fields: [
      {
        bytes: hx(data.subarray(0, 2)),
        name: '像素时钟',
        value: `${(clock / 1e6).toFixed(3)} MHz`,
      },
      {
        bytes: hx(data.subarray(2, 5)),
        name: '水平',
        value: `${hactive} 有效 / ${hblank} 消隐`,
      },
      {
        bytes: hx(data.subarray(5, 8)),
        name: '垂直',
        value: `${vactive} 有效 / ${vblank} 消隐`,
      },
      {
        bytes: hx(data.subarray(17, 18)),
        name: '帧率',
        value: `${rate} Hz${interlaced ? '（隔行）' : ''}`,
      },
    ],
  }
}

// 基础块（块 0）
function baseBlock(data: Uint8Array): EdidResult {
  const sections: EdidSection[] = []
  const errors: string[] = []

  sections.push({
    title: '头部',
    range: '00h-08h',
    raw: hx(data.subarray(0, 8)),
    fields: [{ bytes: '', name: '固定头', value: '00 FF FF FF FF FF FF 00' }],
  })

  const manufacturer = u16be(data, 8)
  const maker = [10, 5, 0]
    .map((shift) => String.fromCharCode(64 + ((manufacturer >> shift) & 31)))
    .join('')
  const date =
    data[16] === 255
      ? `型号年 ${1990 + (data[17] ?? 0)}`
      : `${data[16]} 周 / ${1990 + (data[17] ?? 0)} 年`
  sections.push({
    title: '厂商与产品',
    range: '08h-12h',
    raw: hx(data.subarray(8, 18)),
    fields: [
      { bytes: hx(data.subarray(8, 10)), name: '厂商名', value: maker },
      {
        bytes: hx(data.subarray(10, 12)),
        name: '产品码',
        value: `0x${u16le(data, 10).toString(16).toUpperCase().padStart(4, '0')}`,
      },
      {
        bytes: hx(data.subarray(12, 16)),
        name: '序列号',
        value: String(u32le(data, 12)),
      },
      { bytes: hx(data.subarray(16, 18)), name: '生产日期', value: date },
    ],
  })

  sections.push({
    title: '版本',
    range: '12h-14h',
    raw: hx(data.subarray(18, 20)),
    fields: [
      {
        bytes: hx(data.subarray(18, 20)),
        name: 'EDID 版本',
        value: `${data[18]}.${data[19]}`,
      },
    ],
  })

  const inputValue = data[20] ?? 0
  const inputFields: EdidField[] = []
  if (inputValue & 128) {
    inputFields.push({
      bytes: hx(data.subarray(20, 21)),
      name: '接口类型',
      value: '数字',
    })
    if (versionAtLeast(data, 1, 4)) {
      const depth = ['未指定', '6', '8', '10', '12', '14', '16', '保留'][
        (inputValue >> 4) & 7
      ]
      const iface =
        {
          0: '未指定',
          1: 'DVI',
          2: 'HDMI-A',
          3: 'HDMI-B',
          4: 'MDDI',
          5: 'DisplayPort',
        }[inputValue & 15] ?? '保留'
      inputFields.push({ bytes: '', name: '色深', value: `${depth} bpc` })
      inputFields.push({ bytes: '', name: '数字接口', value: iface })
    }
  } else {
    inputFields.push({
      bytes: hx(data.subarray(20, 21)),
      name: '接口类型',
      value: '模拟',
    })
  }
  let dimensions: string
  if (data[21] && data[22]) {
    dimensions = `${data[21]} x ${data[22]} cm`
  } else if (versionAtLeast(data, 1, 4) && data[21]) {
    dimensions = `横宽比 ${(((data[21] ?? 0) + 99) / 100).toFixed(2)}`
  } else if (versionAtLeast(data, 1, 4) && data[22]) {
    dimensions = `竖高比 ${(100 / ((data[22] ?? 0) + 99)).toFixed(2)}`
  } else {
    dimensions = '未指定'
  }
  inputFields.push({
    bytes: hx(data.subarray(21, 23)),
    name: '屏幕尺寸',
    value: dimensions,
  })
  inputFields.push({
    bytes: hx(data.subarray(23, 24)),
    name: 'gamma',
    value:
      data[23] === 255 ? '未指定' : (((data[23] ?? 0) + 100) / 100).toFixed(2),
  })
  inputFields.push({
    bytes: hx(data.subarray(24, 25)),
    name: '特性支持',
    value: `0x${(data[24] ?? 0).toString(16).toUpperCase().padStart(2, '0')}`,
  })
  sections.push({
    title: '基本显示参数',
    range: '14h-19h',
    raw: hx(data.subarray(20, 25)),
    fields: inputFields,
  })

  const modes: string[] = []
  for (let p = 38; p < 54; p += 2) {
    const a = data[p] ?? 0
    const b = data[p + 1] ?? 0
    if ((a === 1 && b === 1) || (a === 0 && b === 0)) continue
    const h = (a + 31) * 8
    const aspect = b >> 6
    const ratios: [number, number][] = [
      [4, 3],
      [5, 4],
      [16, 9],
    ]
    const ratio: [number, number] =
      aspect === 0
        ? versionAtLeast(data, 1, 3)
          ? [16, 10]
          : [1, 1]
        : (ratios[aspect - 1] ?? [1, 1])
    modes.push(`${h}x${(h * ratio[1]) / ratio[0]}@${(b & 63) + 60}Hz`)
  }
  sections.push({
    title: '标准时序',
    range: '26h-36h',
    raw: hx(data.subarray(38, 54)),
    fields:
      modes.length > 0
        ? modes.map((mode) => ({ bytes: '', name: '', value: mode }))
        : [{ bytes: '', name: '', value: '无' }],
  })

  const descriptors: EdidField[] = []
  const descriptorSections: EdidSection[] = []
  for (const p of [54, 72, 90, 108]) {
    const desc = data.subarray(p, p + 18)
    const timing = detailedTiming(desc, '详细时序', p)
    if (timing) {
      descriptorSections.push(timing)
      continue
    }
    if (!(desc[0] === 0 && desc[1] === 0 && desc[2] === 0)) continue
    const tag = desc[3] ?? 0
    if ((tag === 0xfc || tag === 0xff || tag === 0xfe) && desc[4] === 0) {
      const newline = desc.subarray(5).indexOf(0x0a)
      const raw =
        newline >= 0 ? desc.subarray(5, 5 + newline) : desc.subarray(5)
      let end = raw.length
      while (end > 0 && (raw[end - 1] === 0x20 || raw[end - 1] === 0)) end -= 1
      const text = protocolAscii(raw.subarray(0, end))
      const name = tag === 0xfc ? '型号' : tag === 0xff ? '序列号' : '文本'
      if (text === null) {
        errors.push(`EDID ${name}描述符在偏移 ${p} 不是合法 ASCII`)
        descriptors.push({ bytes: hx(desc), name, value: '非法 ASCII' })
      } else {
        descriptors.push({ bytes: hx(desc.subarray(0, 5)), name, value: text })
      }
    } else if (tag === 0xfd && desc[4] === 0) {
      descriptors.push({
        bytes: hx(desc.subarray(0, 5)),
        name: '范围限制',
        value: `垂直 ${desc[5]}..${desc[6]} Hz，水平 ${desc[7]}..${desc[8]} kHz，最大像素时钟 ${(desc[9] ?? 0) * 10} MHz`,
      })
    } else if (tag !== 0) {
      descriptors.push({
        bytes: hx(desc),
        name: `描述符 0x${tag.toString(16).toUpperCase().padStart(2, '0')}`,
        value: '未解析',
      })
    }
  }
  sections.push({
    title: '描述符',
    range: '36h-7Eh',
    raw: hx(data.subarray(54, 126)),
    fields:
      descriptors.length > 0
        ? descriptors
        : [{ bytes: '', name: '', value: '无' }],
  })
  sections.push(...descriptorSections)

  sections.push({
    title: '扩展块',
    range: '7Eh',
    raw: hx(data.subarray(126, 127)),
    fields: [
      {
        bytes: hx(data.subarray(126, 127)),
        name: '扩展块数',
        value: String(data[126]),
      },
    ],
  })

  return { sections, errors }
}

const VIC_NAMES: Record<number, string> = {
  1: '640x480p60',
  2: '720x480p60(4:3)',
  3: '720x480p60(16:9)',
  4: '1280x720p60',
  5: '1920x1080i60',
  16: '1920x1080p60',
  17: '720x576p50(4:3)',
  18: '720x576p50(16:9)',
  19: '1280x720p50',
  20: '1920x1080i50',
  31: '1920x1080p50',
  63: '1920x1080p120',
  77: '1920x1080p100(64:27)',
}

function ctaDataBlock(
  tag: number,
  payload: Uint8Array,
  offset: number,
): EdidResult {
  const fields: EdidField[] = []
  const errors: string[] = []
  const raw = hx(payload)
  const range = `${offset.toString(16).toUpperCase().padStart(2, '0')}h`
  let title = `CTA 数据块 tag=${tag}`

  if (tag === 1) {
    title = 'CTA 音频数据块'
    if (payload.length % 3 !== 0) errors.push('CTA 音频块长度不是 3 的倍数')
    for (let p = 0; p + 2 < payload.length; p += 3) {
      const a = payload[p] ?? 0
      const b = payload[p + 1] ?? 0
      const c = payload[p + 2] ?? 0
      const fmt = (a >> 3) & 15
      const frequencies = [32, 44.1, 48, 88.2, 96, 176.4, 192]
        .filter((_, bit) => b & (1 << bit))
        .map((rate) => String(rate))
      let value = `格式 ${fmt === 1 ? 'LPCM' : fmt}，${(a & 7) + 1} 声道，采样率 ${frequencies.join('/')} kHz`
      if (fmt === 1) {
        const sizes = [16, 20, 24].filter((_, bit) => c & (1 << bit))
        value += `，位深 ${sizes.join('/')}`
      } else {
        value += `，codec 0x${c.toString(16).toUpperCase().padStart(2, '0')}`
      }
      fields.push({
        bytes: hx(payload.subarray(p, p + 3)),
        name: '音频',
        value,
      })
    }
  } else if (tag === 2) {
    title = 'CTA 视频数据块'
    for (const value of payload) {
      // CTA 扩展 VIC 193..253 用整字节，不带 native 标志
      const vic = value <= 192 ? value & 127 : value
      const native = value >= 129 && value <= 192
      fields.push({
        bytes: value.toString(16).toUpperCase().padStart(2, '0'),
        name: `VIC ${vic}`,
        value: `${VIC_NAMES[vic] ?? '时序未解析'}${native ? '，native' : ''}`,
      })
    }
  } else if (tag === 3) {
    title = 'CTA 厂商数据块'
    if (payload.length < 3) {
      errors.push('CTA 厂商块短于 OUI')
    } else {
      const oui =
        (payload[0] ?? 0) | ((payload[1] ?? 0) << 8) | ((payload[2] ?? 0) << 16)
      fields.push({
        bytes: hx(payload.subarray(0, 3)),
        name: 'OUI',
        value: `0x${oui.toString(16).toUpperCase().padStart(6, '0')}`,
      })
      fields.push({
        bytes: hx(payload.subarray(3)),
        name: '载荷',
        value: '未解析',
      })
    }
  } else if (tag === 4) {
    title = 'CTA 扬声器分配块'
    if (payload.length !== 3) {
      errors.push('CTA 扬声器分配块需要 3 字节')
    } else {
      const value =
        (payload[0] ?? 0) | ((payload[1] ?? 0) << 8) | ((payload[2] ?? 0) << 16)
      fields.push({
        bytes: hx(payload),
        name: '分配位图',
        value: `0x${value.toString(16).toUpperCase().padStart(6, '0')}`,
      })
    }
  } else if (tag === 7) {
    title = 'CTA 扩展数据块'
    if (payload.length === 0) {
      return { sections: [], errors: ['CTA 扩展块缺少扩展 tag'] }
    }
    const ext = payload[0] ?? 0
    const content = payload.subarray(1)
    if (ext === 6) {
      if (content.length < 2) {
        errors.push('CTA HDR 静态元数据块过短')
      } else {
        const eotfs = ['SDR', 'HDR_gamma', 'PQ', 'HLG'].filter(
          (_, bit) => (content[0] ?? 0) & (1 << bit),
        )
        fields.push({
          bytes: hx(content.subarray(0, 1)),
          name: 'EOTF',
          value: eotfs.join('/'),
        })
        fields.push({
          bytes: hx(content.subarray(1, 2)),
          name: '静态元数据',
          value: (content[1] ?? 0) & 1 ? '支持' : '不支持',
        })
        fields.push({
          bytes: hx(content.subarray(2)),
          name: '亮度码',
          value: hx(content.subarray(2)),
        })
      }
    } else if (ext === 5) {
      if (content.length < 2) {
        errors.push('CTA colorimetry 块过短')
      } else {
        const spaces = [
          'xvYCC601',
          'xvYCC709',
          'sYCC601',
          'opYCC601',
          'opRGB',
          'BT2020cYCC',
          'BT2020YCC',
          'BT2020RGB',
        ]
        const enabled = spaces.filter(
          (_, bit) => (content[0] ?? 0) & (1 << bit),
        )
        fields.push({
          bytes: hx(content.subarray(0, 1)),
          name: '色域',
          value: enabled.join('/') || '无',
        })
        fields.push({
          bytes: hx(content.subarray(1, 2)),
          name: '标志',
          value: `0x${(content[1] ?? 0).toString(16).toUpperCase().padStart(2, '0')}`,
        })
      }
    } else if (ext === 0x0e) {
      fields.push({
        bytes: hx(content),
        name: 'YCbCr420 VIC',
        value: Array.from(content).join(','),
      })
    } else if (ext === 0x0f) {
      fields.push({
        bytes: hx(content),
        name: 'YCbCr420 能力位图',
        value: hx(content),
      })
    } else {
      fields.push({
        bytes: hx(content),
        name: `扩展 tag 0x${ext.toString(16).toUpperCase().padStart(2, '0')}`,
        value: '未解析',
      })
    }
  } else {
    fields.push({ bytes: raw, name: `tag=${tag}`, value: '未解析' })
  }

  return {
    sections: [{ title, range, raw, fields }],
    errors,
  }
}

function ctaBlock(data: Uint8Array): EdidResult {
  const sections: EdidSection[] = []
  const errors: string[] = []
  const end = data[2] ?? 0

  sections.push({
    title: 'CTA 头',
    range: '00h-04h',
    raw: hx(data.subarray(0, 4)),
    fields: [
      {
        bytes: hx(data.subarray(1, 2)),
        name: 'revision',
        value: String(data[1]),
      },
      {
        bytes: hx(data.subarray(3, 4)),
        name: '标志',
        value: `underscan=${!!((data[3] ?? 0) & 128)} basic_audio=${!!((data[3] ?? 0) & 64)} YCbCr444=${!!((data[3] ?? 0) & 32)} YCbCr422=${!!((data[3] ?? 0) & 16)} native_DTDs=${(data[3] ?? 0) & 15}`,
      },
      { bytes: hx(data.subarray(2, 3)), name: '数据块区结束', value: `${end}` },
    ],
  })

  if ((data[1] ?? 0) < 3) {
    return { sections, errors }
  }
  if (end === 0) return { sections, errors }
  if (end < 4 || end > 127) {
    return { sections, errors: ['CTA DTD 偏移超出 4..127'] }
  }

  let pos = 4
  while (pos < end) {
    const header = data[pos] ?? 0
    let restZero = true
    for (let i = pos; i < end; i += 1) {
      if (data[i] !== 0) {
        restZero = false
        break
      }
    }
    if (header === 0 && restZero) break
    const length = header & 31
    if (pos + 1 + length > end) {
      errors.push(`CTA 数据块在 ${pos} 超出集合边界`)
      break
    }
    const result = ctaDataBlock(
      header >> 5,
      data.subarray(pos + 1, pos + 1 + length),
      pos,
    )
    sections.push(...result.sections)
    errors.push(...result.errors)
    pos += 1 + length
  }

  for (let p = end; p < 110; p += 18) {
    const timing = detailedTiming(data.subarray(p, p + 18), 'CTA 详细时序', p)
    if (timing) sections.push(timing)
  }
  return { sections, errors }
}

function displayIdBlock(data: Uint8Array): EdidResult {
  const sections: EdidSection[] = []
  const errors: string[] = []
  const end = 5 + (data[2] ?? 0)

  sections.push({
    title: 'DisplayID 头',
    range: '00h-05h',
    raw: hx(data.subarray(0, 5)),
    fields: [
      {
        bytes: hx(data.subarray(1, 2)),
        name: '版本',
        value: `${(data[1] ?? 0) >> 4}.${(data[1] ?? 0) & 15}`,
      },
      {
        bytes: hx(data.subarray(2, 3)),
        name: '载荷字节数',
        value: String(data[2]),
      },
      {
        bytes: hx(data.subarray(3, 4)),
        name: '产品类型',
        value: String(data[3]),
      },
      {
        bytes: hx(data.subarray(4, 5)),
        name: '扩展块数',
        value: String(data[4]),
      },
    ],
  })

  if (end > 126) {
    return { sections, errors: ['DisplayID 载荷超出 EDID 扩展块边界'] }
  }
  let checksum = 0
  for (let i = 1; i <= end; i += 1) checksum += data[i] ?? 0
  if (checksum & 255) {
    return { sections, errors: ['DisplayID 内部 checksum 错误'] }
  }

  let pos = 5
  while (pos < end) {
    let restZero = true
    for (let i = pos; i < end; i += 1) {
      if (data[i] !== 0) {
        restZero = false
        break
      }
    }
    if (restZero) break
    if (pos + 3 > end) {
      errors.push('DisplayID 块头越过载荷边界')
      break
    }
    const tag = data[pos] ?? 0
    const rev = data[pos + 1] ?? 0
    const length = data[pos + 2] ?? 0
    if (pos + 3 + length > end) {
      errors.push(
        `DisplayID tag=0x${tag.toString(16).toUpperCase().padStart(2, '0')} 越过载荷边界`,
      )
      break
    }
    const payload = data.subarray(pos + 3, pos + 3 + length)
    const range = `${pos.toString(16).toUpperCase().padStart(2, '0')}h`
    const fields: EdidField[] = []

    if (tag === 3 && (data[1] ?? 0) < 0x20) {
      if (length % 20 !== 0)
        errors.push('DisplayID Type I 时序长度不是 20 的倍数')
      for (let p = 0; p + 19 < length; p += 20) {
        const value = payload.subarray(p, p + 20)
        // 像素时钟是 3 字节小端，单位 10 kHz，存的是值减一
        const clock = (u24le(value, 0) + 1) * 10000
        const ha = u16le(value, 4) + 1
        const hb = u16le(value, 6) + 1
        const va = u16le(value, 12) + 1
        const vb = u16le(value, 14) + 1
        fields.push({
          bytes: hx(value.subarray(0, 4)),
          name: `${ha}x${va}`,
          value: `${(clock / 1e6).toFixed(3)} MHz，${(clock / ((ha + hb) * (va + vb))).toFixed(2)} Hz${(value[3] ?? 0) & 128 ? '，preferred' : ''}`,
        })
      }
      sections.push({
        title: 'DisplayID Type I 时序',
        range,
        raw: hx(payload),
        fields,
      })
    } else if (tag === 0x0b && (data[1] ?? 0) < 0x20) {
      const text = protocolAscii(payload)
      if (text === null) {
        errors.push('DisplayID ASCII 字符串含非法字节')
      } else {
        fields.push({ bytes: hx(payload), name: '文本', value: text })
      }
      sections.push({
        title: 'DisplayID 文本',
        range,
        raw: hx(payload),
        fields,
      })
    } else {
      fields.push({
        bytes: hx(payload),
        name: `tag 0x${tag.toString(16).toUpperCase().padStart(2, '0')} rev 0x${rev.toString(16).toUpperCase().padStart(2, '0')}`,
        value: '未解析',
      })
      sections.push({
        title: 'DisplayID 数据块',
        range,
        raw: hx(payload),
        fields,
      })
    }
    pos += 3 + length
  }
  return { sections, errors }
}

// 解码一个 128 字节 EDID 块，block 0 是基础块，其余按扩展 tag 分派
export function describeEdidBlock(data: Uint8Array, block: number): EdidResult {
  if (data.length !== 128) {
    throw new Error('EDID 语义解码需要完整 128 字节块')
  }
  let checksum = 0
  for (const byte of data) checksum += byte
  if (checksum & 255) {
    return { sections: [], errors: ['EDID checksum 错误，跳过语义解码'] }
  }
  if (block === 0) {
    const header = [0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00]
    if (!header.every((value, index) => data[index] === value)) {
      return { sections: [], errors: ['EDID 基础块头错误，跳过语义解码'] }
    }
    return baseBlock(data)
  }
  if (data[0] === 2) return ctaBlock(data)
  if (data[0] === 0x70) return displayIdBlock(data)
  return {
    sections: [
      {
        title: `EDID 扩展 tag=0x${(data[0] ?? 0).toString(16).toUpperCase().padStart(2, '0')}`,
        range: '',
        raw: hx(data),
        fields: [{ bytes: '', name: '', value: '载荷未解析' }],
      },
    ],
    errors: [],
  }
}
