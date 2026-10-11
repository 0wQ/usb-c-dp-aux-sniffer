import { type DdcResult, describeDdc } from './ddc'
import { type DpcdField, describeDpcd, dpcdName } from './dpcd'
import {
  type AuxFrameInput,
  type AuxTransaction,
  DP_AUX_FLAG,
  hasFlag,
  parseFrame,
  validateReply,
} from './frame'

// 请求与回复配对成事务
//
// 移植自 firmware/tools/dp_aux_protocol.py 的 AuxStreamDecoder
// 配对窗口取 4 ms，超时的请求单独成行并标注未应答

const REPLY_WINDOW_US = 4000

export type ExchangeKind =
  | 'exchange'
  | 'request-only'
  | 'reply-only'
  | 'invalid'

export type Exchange = {
  key: string
  timestampUs: number
  request: AuxTransaction | null
  reply: AuxTransaction | null
  elapsedUs: number | null
  errors: string[]
  warnings: string[]
  fields: DpcdField[]
  // I2C 0x37 的 DDC/CI 解码，非 DDC 事务为 null
  ddc: DdcResult | null
  frames: AuxFrameInput[]
  kind: ExchangeKind
  address: number | null
  registerName: string
  // 列表和详情要展示的有效载荷，写取请求，读取回复
  data: Uint8Array
  commandLabel: string
  operationLabel: string
}

const OPERATION_LABEL: Record<string, string> = {
  writ: '写',
  read: '读',
  wsr: '写状态',
}

function baseFields(event: AuxFrameInput, key: string): Exchange {
  return {
    key,
    timestampUs: event.timestampUs,
    request: null,
    reply: null,
    elapsedUs: null,
    errors: [],
    warnings: [],
    fields: [],
    ddc: null,
    frames: [event],
    kind: 'invalid',
    address: null,
    registerName: '',
    data: new Uint8Array(0),
    commandLabel: 'AUX',
    operationLabel: '-',
  }
}

// 从请求和回复推导列表要展示的字段
function decorate(exchange: Exchange): Exchange {
  const { request, reply } = exchange
  const address = request?.address ?? null
  exchange.address = address
  exchange.registerName = address === null ? '' : dpcdName(address)
  if (request) {
    exchange.commandLabel = request.native ? 'Native' : 'I2C'
    exchange.operationLabel =
      OPERATION_LABEL[request.operation] ?? request.operation
    exchange.data =
      request.operation === 'writ' && request.data.length > 0
        ? request.data
        : (reply?.data ?? request.data)
  } else if (reply) {
    exchange.commandLabel = 'AUX'
    exchange.operationLabel = reply.operation
    exchange.data = reply.data
  }

  // 只有自洽的原生写和原生读回复才做 DPCD 字段解码
  if (
    request?.native &&
    request.operation === 'writ' &&
    request.data.length > 0
  ) {
    exchange.fields = describeDpcd(request.address ?? 0, request.data)
  } else if (
    request?.native &&
    request.operation === 'read' &&
    reply?.command === 0
  ) {
    exchange.fields = describeDpcd(request.address ?? 0, reply.data)
  }

  // I2C 0x37 是 DDC/CI，主机写用 0x51，显示器回复用 0x6E
  if (
    request &&
    !request.native &&
    request.address === 0x37 &&
    request.data.length > 0
  ) {
    exchange.ddc = describeDdc(request.data, 0x51)
  } else if (
    reply &&
    request &&
    !request.native &&
    request.address === 0x37 &&
    reply.data.length > 0
  ) {
    exchange.ddc = describeDdc(reply.data, 0x6e)
  }
  return exchange
}

function makeExchange(
  pending: { event: AuxFrameInput; request: AuxTransaction },
  replyEvent: AuxFrameInput,
  reply: AuxTransaction,
  issues: string[],
): Exchange {
  const exchange = baseFields(
    replyEvent,
    `${pending.event.seq}-${replyEvent.seq}`,
  )
  exchange.kind = 'exchange'
  exchange.timestampUs = pending.event.timestampUs
  exchange.request = pending.request
  exchange.reply = reply
  exchange.elapsedUs = replyEvent.timestampUs - pending.event.timestampUs
  exchange.errors = issues
  exchange.frames = [pending.event, replyEvent]
  return decorate(exchange)
}

function makeRequestOnly(pending: {
  event: AuxFrameInput
  request: AuxTransaction
}): Exchange {
  const exchange = baseFields(pending.event, `${pending.event.seq}-req`)
  exchange.kind = 'request-only'
  exchange.request = pending.request
  exchange.warnings = ['未捕获到回复']
  return decorate(exchange)
}

function makeReplyOnly(event: AuxFrameInput, reply: AuxTransaction): Exchange {
  const exchange = baseFields(event, `${event.seq}-rep`)
  exchange.kind = 'reply-only'
  exchange.reply = reply
  exchange.warnings = ['未配对的回复']
  return decorate(exchange)
}

export function buildExchanges(frames: AuxFrameInput[]): Exchange[] {
  // 列表按时间倒序存放，配对要从旧到新
  const ordered = [...frames].reverse()
  const exchanges: Exchange[] = []
  let pending: { event: AuxFrameInput; request: AuxTransaction } | null = null
  let previousSeq: number | undefined

  for (const event of ordered) {
    // 序号缺口表示队列丢帧或设备清零，旧请求不能与后续回复配对
    if (
      previousSeq !== undefined &&
      event.seq !== (previousSeq + 1) >>> 0 &&
      pending
    ) {
      exchanges.push(makeRequestOnly(pending))
      pending = null
    }
    previousSeq = event.seq
    const flags = event.frame.flags
    const damaged =
      hasFlag(flags, DP_AUX_FLAG.INTERVAL) ||
      hasFlag(flags, DP_AUX_FLAG.TRUNCATED)

    if (damaged) {
      if (pending) {
        exchanges.push(makeRequestOnly(pending))
        pending = null
      }
      const exchange = baseFields(event, `${event.seq}-bad`)
      exchange.errors = ['采集区间错误或截断']
      exchanges.push(exchange)
      continue
    }

    const parsed = parseFrame(event.frame.data)

    // 回复窗口过期，旧请求单独成行
    if (
      pending &&
      event.timestampUs - pending.event.timestampUs > REPLY_WINDOW_US
    ) {
      exchanges.push(makeRequestOnly(pending))
      pending = null
    }

    if (pending && (parsed.kind === 'reply' || parsed.kind === 'ambiguous')) {
      const reply = parsed.kind === 'reply' ? parsed.transaction : parsed.reply
      // 进入这个分支时 parsed 是 reply 或 ambiguous
      // ambiguous 说明这帧也满足请求形状，不能仅凭校验失败就配对
      const hasRequestCandidate = parsed.kind === 'ambiguous'
      const issues = validateReply(pending.request, reply)
      if (issues.length === 0 || !hasRequestCandidate) {
        exchanges.push(makeExchange(pending, event, reply, issues))
        pending = null
        continue
      }
    }

    if (parsed.kind === 'request') {
      if (pending) {
        exchanges.push(makeRequestOnly(pending))
        pending = null
      }
      pending = { event, request: parsed.transaction }
    } else if (parsed.kind === 'reply') {
      exchanges.push(makeReplyOnly(event, parsed.transaction))
    } else if (parsed.kind === 'ambiguous') {
      // 同时满足请求和回复形状时，没有待配对请求就优先按请求处理
      // 地址-only 写这类帧也满足回复形状，但在 DDC/CI 流程里它就是新请求
      if (pending) {
        exchanges.push(makeRequestOnly(pending))
        pending = null
      }
      pending = { event, request: parsed.request }
    } else {
      if (pending) {
        exchanges.push(makeRequestOnly(pending))
        pending = null
      }
      const exchange = baseFields(event, `${event.seq}-unk`)
      exchange.errors = parsed.errors
      exchanges.push(exchange)
    }
  }

  if (pending) exchanges.push(makeRequestOnly(pending))

  // 旧到新，和抓包时间顺序一致
  return exchanges
}
