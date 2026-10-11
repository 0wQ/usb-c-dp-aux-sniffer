// DPCD 与 HDCP 字段解码
//
// 移植自 firmware/tools/dp_aux_protocol.py 的 describe_dpcd 与
// firmware/tools/dp_aux_registers.py 的 describe_hdcp_scalars
// 原始值始终保留，只对标准定义过的地址给出语义，未覆盖的地址不猜

export type DpcdField = {
  address: number
  value: number
  text: string
}

// 常用 DPCD 寄存器名子集，够读链路训练和状态
export const DPCD_NAMES: Record<number, string> = {
  0: 'DPCD_REV',
  1: 'MAX_LINK_RATE',
  2: 'MAX_LANE_COUNT',
  3: 'MAX_DOWNSPREAD',
  4: 'NORP',
  5: 'DOWN_STREAM_PORT_PRESENT',
  6: 'MAIN_LINK_CHANNEL_CODING',
  7: 'DOWN_STREAM_PORT_COUNT',
  8: 'RECEIVE_PORT0_CAP_0',
  9: 'RECEIVE_PORT0_CAP_1',
  12: 'I2C_SPEED_CAP',
  14: 'TRAINING_AUX_RD_INTERVAL',
  15: 'ADAPTER_CAP',
  33: 'MSTM_CAP',
  144: 'FEC_CAPABILITY',
  46: 'RECEIVER_ALPM_CAP',
  96: 'DSC_SUPPORT',
  97: 'DSC_REV',
  176: 'PANEL_REPLAY_CAPABILITY_SUPPORTED',
  256: 'LINK_BW_SET',
  257: 'LANE_COUNT_SET',
  258: 'TRAINING_PATTERN_SET',
  259: 'TRAINING_LANE0_SET',
  260: 'TRAINING_LANE1_SET',
  261: 'TRAINING_LANE2_SET',
  262: 'TRAINING_LANE3_SET',
  263: 'DOWNSPREAD_CTRL',
  264: 'MAIN_LINK_CHANNEL_CODING_SET',
  266: 'EDP_CONFIGURATION_SET',
  288: 'FEC_CONFIGURATION',
  512: 'SINK_COUNT',
  513: 'DEVICE_SERVICE_IRQ_VECTOR',
  514: 'LANE0_1_STATUS',
  515: 'LANE2_3_STATUS',
  516: 'LANE_ALIGN_STATUS_UPDATED',
  517: 'SINK_STATUS',
  518: 'ADJUST_REQUEST_LANE0_1',
  519: 'ADJUST_REQUEST_LANE2_3',
  520: 'TRAINING_SCORE_LANE0',
  521: 'TRAINING_SCORE_LANE1',
  522: 'TRAINING_SCORE_LANE2',
  523: 'TRAINING_SCORE_LANE3',
  528: 'SYMBOL_ERROR_COUNT_LANE0',
  530: 'SYMBOL_ERROR_COUNT_LANE1',
  532: 'SYMBOL_ERROR_COUNT_LANE2',
  534: 'SYMBOL_ERROR_COUNT_LANE3',
  536: 'TEST_REQUEST',
  537: 'TEST_LINK_RATE',
  544: 'TEST_LANE_COUNT',
  545: 'TEST_PATTERN',
  1536: 'SET_POWER',
  8194: 'SINK_COUNT_ESI',
  8195: 'DEVICE_SERVICE_IRQ_VECTOR_ESI0',
  8196: 'DEVICE_SERVICE_IRQ_VECTOR_ESI1',
  8197: 'LINK_SERVICE_IRQ_VECTOR_ESI0',
  8204: 'LANE0_1_STATUS_ESI',
  8205: 'LANE2_3_STATUS_ESI',
  8206: 'LANE_ALIGN_STATUS_UPDATED_ESI',
  8207: 'SINK_STATUS_ESI',
  8704: 'DPCD_REV_EXT',
  8705: 'MAX_LINK_RATE_EXT',
  8706: 'MAX_LANE_COUNT_EXT',
  8707: 'MAX_DOWNSPREAD_EXT',
  8710: 'MAIN_LINK_CHANNEL_CODING_CAP_EXT',
  8720: 'DPRX_FEATURE_ENUMERATION_LIST',
  8724: 'ADAPTIVE_SYNC_CAPABILITY',
  12336: 'DOWNSTREAM_LINK_ERROR_REPORTING_SUPPORTED',
  917517: 'DP_TUNNELING_AND_PANEL_REPLAY_OPTIMIZATION_SUPPORT',
}

// HDCP over DP 的寄存器名
export const HDCP_NAMES: Record<number, string> = {
  430080: 'HDCP2_RTX',
  430088: 'HDCP2_TXCAPS',
  430091: 'HDCP2_CERT_RX',
  430613: 'HDCP2_RRX',
  430621: 'HDCP2_RX_CAPS',
  430624: 'HDCP2_EKPUB_KM',
  430752: 'HDCP2_EKH_KM_WR',
  430768: 'HDCP2_M',
  430784: 'HDCP2_HPRIME',
  430816: 'HDCP2_EKH_KM_RD',
  430832: 'HDCP2_RN',
  430840: 'HDCP2_LPRIME',
  430872: 'HDCP2_EDKEY_KS',
  430888: 'HDCP2_RIV',
  430896: 'HDCP2_RXINFO',
  430898: 'HDCP2_SEQ_NUM_V',
  430901: 'HDCP2_VPRIME',
  430917: 'HDCP2_RECEIVER_ID_LIST',
  431072: 'HDCP2_V',
  431088: 'HDCP2_SEQ_NUM_M',
  431091: 'HDCP2_K',
  431093: 'HDCP2_STREAM_ID_TYPE',
  431251: 'HDCP2_RXSTATUS',
  431252: 'HDCP2_STREAM_TYPE',
}

type RegisterField = {
  address: number
  size: number
  name: string
}

// HDCP 多字节字段，用来把地址落回所属寄存器
const FIELDS: RegisterField[] = []
for (let lane = 0; lane < 4; lane += 1) {
  FIELDS.push({
    address: 0x210 + lane * 2,
    size: 2,
    name: `SYMBOL_ERROR_COUNT_LANE${lane}`,
  })
}
FIELDS.push({ address: 0x67, size: 2, name: 'DSC_MAX_BITS_PER_PIXEL' })
for (const [base, name] of [
  [0x300, 'SOURCE'],
  [0x400, 'SINK'],
  [0x500, 'BRANCH'],
  [0xe0000, 'TUNNEL'],
] as const) {
  FIELDS.push({ address: base, size: 3, name: `${name}_OUI` })
  FIELDS.push({ address: base + 3, size: 6, name: `${name}_DEVICE_ID` })
  FIELDS.push({ address: base + 9, size: 1, name: `${name}_HW_REV` })
  FIELDS.push({ address: base + 10, size: 2, name: `${name}_SW_REV` })
}
for (const [address, size, name] of [
  [0x68000, 5, 'HDCP1_BKSV'],
  [0x68005, 2, 'HDCP1_RI_PRIME'],
  [0x68007, 5, 'HDCP1_AKSV'],
  [0x6800c, 8, 'HDCP1_AN'],
  [0x68014, 20, 'HDCP1_VPRIME'],
  [0x69000, 8, 'HDCP2_RTX'],
  [0x69008, 3, 'HDCP2_TXCAPS'],
  [0x6900b, 522, 'HDCP2_CERT_RX'],
  [0x69215, 8, 'HDCP2_RRX'],
  [0x6921d, 3, 'HDCP2_RX_CAPS'],
  [0x69220, 128, 'HDCP2_EKPUB_KM'],
  [0x692a0, 16, 'HDCP2_EKH_KM_WR'],
  [0x692b0, 16, 'HDCP2_M'],
  [0x692c0, 32, 'HDCP2_HPRIME'],
  [0x692e0, 16, 'HDCP2_EKH_KM_RD'],
  [0x692f0, 8, 'HDCP2_RN'],
  [0x692f8, 32, 'HDCP2_LPRIME'],
  [0x69318, 16, 'HDCP2_EDKEY_KS'],
  [0x69328, 8, 'HDCP2_RIV'],
  [0x69330, 2, 'HDCP2_RXINFO'],
  [0x69332, 3, 'HDCP2_SEQ_NUM_V'],
  [0x69335, 16, 'HDCP2_VPRIME'],
  [0x693e0, 16, 'HDCP2_V'],
  [0x693f0, 3, 'HDCP2_SEQ_NUM_M'],
  [0x693f3, 2, 'HDCP2_K'],
  [0x69473, 32, 'HDCP2_MPRIME'],
] as const) {
  FIELDS.push({ address, size, name })
}
FIELDS.sort((a, b) => a.address - b.address)

const VARIABLE_RANGES: [number, number, string][] = [
  [0x6802a, 0x6802c, 'HDCP1_BINFO'],
  [0x6802c, 0x6803b, 'HDCP1_KSV_FIFO'],
  [0x69345, 0x693e0, 'HDCP2_RECEIVER_ID_LIST'],
  [0x693f5, 0x69473, 'HDCP2_STREAM_ID_TYPE'],
]

// 把地址落回 HDCP 多字节字段名，带字段内偏移
export function registerFieldName(address: number): string {
  for (const field of FIELDS) {
    if (address >= field.address && address < field.address + field.size) {
      const offset = address - field.address
      return offset === 0
        ? field.name
        : `${field.name}+0x${offset.toString(16).toUpperCase()} (${field.size}-byte field)`
    }
  }
  for (const [start, end, name] of VARIABLE_RANGES) {
    if (address >= start && address < end) {
      return address === start
        ? name
        : `${name}+0x${(address - start).toString(16).toUpperCase()}`
    }
  }
  return ''
}

// 寄存器名，先查 DPCD 表，再查 HDCP 字段，最后按段给类别
export function dpcdName(address: number): string {
  if (address in DPCD_NAMES) return DPCD_NAMES[address]
  if (address in HDCP_NAMES) return HDCP_NAMES[address]
  const field = registerFieldName(address)
  if (field) return field
  if (address >= 0x00000 && address <= 0x000ff) return 'receiver capability'
  if (address >= 0x00100 && address <= 0x001ff) return 'link configuration'
  if (address >= 0x00200 && address <= 0x002ff) return 'link/sink status'
  if (address >= 0x00300 && address <= 0x003ff) return 'source device specific'
  if (address >= 0x00400 && address <= 0x004ff) return 'sink device specific'
  if (address >= 0x02000 && address <= 0x020ff)
    return 'extended sink/link status'
  if (address >= 0x02200 && address <= 0x022ff)
    return 'extended receiver capability'
  return 'unparsed DPCD register'
}

function hex(value: number, width: number): string {
  return value.toString(16).toUpperCase().padStart(width, '0')
}

function bool(value: boolean): string {
  return value ? 'true' : 'false'
}

// HDCP 标量字段，只覆盖单字节寄存器
function describeHdcpScalars(address: number, data: Uint8Array): DpcdField[] {
  const fields: DpcdField[] = []
  data.forEach((value, index) => {
    const addr = address + index
    let text: string | null = null
    if (addr === 0x68028) {
      text = `HDCP1_BCAPS capable=${bool(!!(value & 1))} repeater=${bool(!!(value & 2))}`
    } else if (addr === 0x68029) {
      text = `HDCP1_BSTATUS ready=${bool(!!(value & 1))} R0_ready=${bool(!!(value & 2))} link_failure=${bool(!!(value & 4))} reauth_request=${bool(!!(value & 8))}`
    } else if (addr === 0x69493) {
      text = `HDCP2_RXSTATUS ready=${bool(!!(value & 1))} H_prime_available=${bool(!!(value & 2))} pairing_available=${bool(!!(value & 4))} reauth_request=${bool(!!(value & 8))} link_integrity_failure=${bool(!!(value & 16))}`
    } else if (addr === 0x69494) {
      const streamType =
        value === 0 ? 'Type0' : value === 1 ? 'Type1' : `reserved(${value})`
      text = `HDCP2_STREAM_TYPE=${streamType}`
    }
    if (text) fields.push({ address: addr, value, text })
  })
  return fields
}

// 逐字节解释 DPCD 字段，原始值始终可见，未定义地址不产出条目
export function describeDpcd(address: number, data: Uint8Array): DpcdField[] {
  const fields: DpcdField[] = []
  data.forEach((value, offset) => {
    const wireAddr = address + offset
    let addr = wireAddr
    if (wireAddr >= 0x2200 && wireAddr <= 0x220f) {
      addr = wireAddr - 0x2200
    } else {
      const mirror: Record<number, number> = {
        8194: 0x200,
        8204: 0x202,
        8205: 0x203,
        8206: 0x204,
        8207: 0x205,
      }
      addr = mirror[wireAddr] ?? wireAddr
    }

    let text = ''
    if (addr === 0x000) {
      text = `DPCD_REV=${value >> 4}.${value & 15}`
    } else if (addr === 0x001 || addr === 0x100) {
      const rate = { 6: '1.62', 10: '2.7', 20: '5.4', 30: '8.1' }[value]
      const name = addr === 0x100 ? 'LINK_BW_SET' : 'MAX_LINK_RATE'
      text =
        rate === undefined
          ? `${name}=0x${hex(value, 2)} (table/other encoding)`
          : `${name}=${rate}Gbps/lane`
    } else if (addr === 0x002) {
      text = `MAX_LANE_COUNT=${value & 31} TPS3=${bool(!!(value & 64))} enhanced_frame=${bool(!!(value & 128))}`
    } else if (addr === 0x003) {
      text = `MAX_DOWNSPREAD=0.5%:${bool(!!(value & 1))} no_AUX_training=${bool(!!(value & 64))} TPS4=${bool(!!(value & 128))}`
    } else if (addr === 0x004) {
      text = `NORP SST_receive_ports=${(value & 1) + 1} DP_PWR_5V=${bool(!!(value & 32))} DP_PWR_12V=${bool(!!(value & 64))} DP_PWR_18V=${bool(!!(value & 128))}`
    } else if (addr === 0x005) {
      const portType = ['DP', 'analog', 'TMDS', 'other'][(value >> 1) & 3]
      text = `downstream_present=${bool(!!(value & 1))} type=${portType} format_conversion=${bool(!!(value & 8))} detailed_caps=${bool(!!(value & 16))}`
    } else if (addr === 0x006 || addr === 0x108) {
      const what = addr === 6 ? 'capability' : 'set'
      text = `coding ${what}: 8b/10b=${bool(!!(value & 1))} 128b/132b=${bool(!!(value & 2))}`
    } else if (addr === 0x007) {
      text = `downstream_port_count=${value & 15} MSA_timing_ignored=${bool(!!(value & 64))} OUI_supported=${bool(!!(value & 128))}`
    } else if (addr === 0x008 || addr === 0x00a) {
      text = `receive_port${(addr - 8) / 2} local_EDID=${bool(!!(value & 2))} associated_to_previous=${bool(!!(value & 4))}`
    } else if (addr === 0x009 || addr === 0x00b) {
      text = `receive_port${(addr - 9) / 2} buffer_size=${(value + 1) * 32}bytes/lane`
    } else if (addr === 0x00c) {
      const speeds = [1, 5, 10, 100, 400, 1000].filter(
        (_, bit) => value & (1 << bit),
      )
      text = `I2C_SPEED_CAP=${speeds.length ? `${speeds.join('/')}kHz` : 'unspecified'}`
    } else if (addr === 0x00d) {
      text = `eDP alternate_scrambler_reset=${bool(!!(value & 1))} framing_change=${bool(!!(value & 2))} display_control=${bool(!!(value & 8))}`
    } else if (addr === 0x00e) {
      const interval = value & 127
      text = interval
        ? `TRAINING_AUX_RD_INTERVAL=${interval * 4}ms`
        : 'TRAINING_AUX_RD_INTERVAL=default (depends on revision/training phase)'
      text += ` extended_receiver_caps=${bool(!!(value & 128))}`
    } else if (addr === 0x00f) {
      text = `adapter force_load_sense=${bool(!!(value & 1))} alternate_I2C_pattern=${bool(!!(value & 2))}`
    } else if (addr === 0x021) {
      text = `MST_capable=${bool(!!(value & 1))}`
    } else if (addr === 0x02e) {
      text = `ALPM_supported=${bool(!!(value & 1))}`
    } else if (addr === 0x060) {
      text = `DSC_decompression_supported=${bool(!!(value & 1))}`
    } else if (addr === 0x061) {
      text = `DSC_REV=${value & 15}.${value >> 4}`
    } else if (addr === 0x062) {
      const block = { 0: '1KiB', 1: '4KiB', 2: '16KiB', 3: '64KiB' }[value]
      text = `DSC_RC_buffer_block=${block ?? `reserved(${value})`}`
    } else if (addr === 0x063) {
      text = `DSC_RC_buffer_blocks=${value + 1}`
    } else if (addr === 0x064 || addr === 0x06d) {
      const choices: [number, number][] =
        addr === 0x64
          ? [
              [0, 1],
              [1, 2],
              [3, 4],
              [4, 6],
              [5, 8],
              [6, 10],
              [7, 12],
            ]
          : [
              [0, 16],
              [1, 20],
              [2, 24],
            ]
      const counts = choices
        .filter(([bit]) => value & (1 << bit))
        .map(([, n]) => n)
      text = `DSC_slice_counts=${counts.join(',')}`
    } else if (addr === 0x065) {
      const low = value & 15
      const depth = low < 8 ? low + 9 : low === 8 ? '8' : 'reserved'
      text = `DSC_line_buffer_depth=${depth}bits`
    } else if (addr === 0x066) {
      text = `DSC_block_prediction=${bool(!!(value & 1))}`
    } else if (addr === 0x069) {
      const names = [
        'RGB',
        'YCbCr444',
        'YCbCr422_simple',
        'YCbCr422_native',
        'YCbCr420_native',
      ]
      const formats = names.filter((_, bit) => value & (1 << bit))
      text = `DSC_color_formats=${formats.join('/')}`
    } else if (addr === 0x06a) {
      const depths = [
        [1, 8],
        [2, 10],
        [3, 12],
      ]
        .filter(([bit]) => value & (1 << bit))
        .map(([, size]) => size)
      text = `DSC_color_depths=${depths.join('/')}bpc`
    } else if (addr === 0x06b) {
      const throughput = (code: number) =>
        code === 0
          ? 'unsupported'
          : code === 1
            ? '340'
            : code === 15
              ? '170'
              : `${300 + code * 50}`
      text = `DSC_peak_throughput_mode0=${throughput(value & 15)} mode1=${throughput(value >> 4)}Mpixels/s`
    } else if (addr === 0x06c) {
      text = `DSC_max_slice_width=${value * 320}pixels`
    } else if (addr === 0x06f) {
      const increment = { 0: '1/16', 1: '1/8', 2: '1/4', 3: '1/2', 4: '1' }[
        value & 7
      ]
      text = `DSC_bpp_increment=${increment ?? 'reserved'}`
    } else if (addr === 0x090) {
      text = `FEC_capable=${bool(!!(value & 1))} uncorrected_block_count=${bool(!!(value & 2))} corrected_block_count=${bool(!!(value & 4))} bit_error_count=${bool(!!(value & 8))}`
    } else if (addr === 0x0b0) {
      text = `PANEL_REPLAY_supported=${bool(!!(value & 1))} selective_update=${bool(!!(value & 2))}`
    } else if (addr === 0x101) {
      text = `LANE_COUNT_SET=${value & 31} enhanced_frame=${bool(!!(value & 128))}`
    } else if (addr === 0x102) {
      const pattern =
        { 0: 'disabled', 1: 'TPS1', 2: 'TPS2', 3: 'TPS3', 7: 'TPS4' }[
          value & 15
        ] ?? `reserved/legacy(0x${(value & 15).toString(16).toUpperCase()})`
      text = `TRAINING_PATTERN=${pattern} scrambling_disabled=${bool(!!(value & 32))}`
    } else if (addr >= 0x103 && addr <= 0x106) {
      text = `lane${addr - 0x103} 8b/10b setting: swing=${value & 3} pre_emphasis=${(value >> 3) & 3} max_swing=${bool(!!(value & 4))} max_pre=${bool(!!(value & 32))}`
    } else if (addr === 0x107) {
      text = `DOWNSPREAD_CTRL=0.5%:${bool(!!(value & 16))}`
    } else if (addr === 0x120) {
      text = `FEC_ready=${bool(!!(value & 1))} error_count_select=${(value >> 1) & 7} lane_select=${(value >> 4) & 3}`
    } else if (addr === 0x200) {
      text = `SINK_COUNT=${(value & 63) | ((value & 128) >> 1)} CP_ready=${bool(!!(value & 64))}`
    } else if (addr === 0x201) {
      const flags = [
        'remote_control_pending',
        'automated_test',
        'CP_IRQ',
        'MCCS_IRQ',
        'downstream_reply_ready',
        'upstream_request_ready',
        'sink_specific_IRQ',
      ]
      const active = flags.filter((_, bit) => value & (1 << bit))
      text = `DEVICE_SERVICE_IRQ=${active.length ? active.join(',') : 'none'}`
    } else if (addr === 0x202 || addr === 0x203) {
      const lanes: string[] = []
      for (let index = 0; index < 2; index += 1) {
        const status = (value >> (index * 4)) & 15
        const lane = (addr - 0x202) * 2 + index
        lanes.push(
          `lane${lane}:CR=${bool(!!(status & 1))},EQ=${bool(!!(status & 2))},symbol_lock=${bool(!!(status & 4))}`,
        )
      }
      text = lanes.join(' ')
    } else if (addr === 0x204) {
      text = `interlane_align=${bool(!!(value & 1))} status_updated=${bool(!!(value & 128))} downstream_status_changed=${bool(!!(value & 64))}`
    } else if (addr === 0x205) {
      text = `receive_port0_in_sync=${bool(!!(value & 1))} receive_port1_in_sync=${bool(!!(value & 2))}`
    } else if (addr === 0x206 || addr === 0x207) {
      const lanes: string[] = []
      for (let index = 0; index < 2; index += 1) {
        const setting = (value >> (index * 4)) & 15
        const lane = (addr - 0x206) * 2 + index
        lanes.push(
          `lane${lane} 8b/10b adjust:swing=${setting & 3},pre=${(setting >> 2) & 3}`,
        )
      }
      text = lanes.join(' ')
    } else if (addr === 0x600) {
      const power = { 1: 'D0', 2: 'D3', 5: 'D3_AUX_ON' }[value & 7]
      text = `SET_POWER=${power ?? `reserved(${value & 7})`}`
    } else if (addr === 0x2210) {
      const flags = [
        'GTC',
        'SST_split_SDP',
        'AV_sync',
        'VSC_colorimetry',
        'VSC_ext_VESA',
        'VSC_ext_VESA_chaining',
        'VSC_ext_CTA',
        'VSC_ext_CTA_chaining',
      ]
      const active = flags.filter((_, bit) => value & (1 << bit))
      text = `DPRX_FEATURES=${active.length ? active.join(',') : 'none'}`
    } else if (addr === 0x2214) {
      text = `ADAPTIVE_SYNC_SDP_supported=${bool(!!(value & 1))}`
    } else if (addr === 0x3030) {
      text = `DOWNSTREAM_LINK_ERROR_REPORTING_supported=${bool(!!(value & 1))}`
    } else if (addr === 0xe000d) {
      text = `DP_TUNNELING_supported=${bool(!!(value & 1))} panel_replay_optimization=${bool(!!(value & 64))} (requires qualifying tunnel identity)`
    }

    if (text) {
      fields.push({ address: wireAddr, value, text })
    }
  })
  fields.push(...describeHdcpScalars(address, data))
  return fields
}
