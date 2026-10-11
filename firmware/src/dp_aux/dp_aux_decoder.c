#include "dp_aux/dp_aux_decoder.h"

#include <stddef.h>
#include <string.h>

#define DP_AUX_STATE_WAIT_SYNC_END 0u
#define DP_AUX_STATE_BODY          1u

// DP 2.0 3.4.1 规定 STOP 驱动高 2T 加低 2T，然后释放总线
// 释放不保证产生比较器上升沿，所以下一个捕获到的边沿属于总线停下后的回复
// pre-charge，或早于旧的 100 tick 截止点
// 超过最长 SYNC 间隔，即 10 个半位槽加容差之后，就按未经确认的电气空闲收尾，
// 绝不因此声称识别到了 STOP。丢沿同样会造成间隔，所以字节结构不能当作逐位证明
#define DP_AUX_INTERVAL_TOLERANCE_TICKS 2u

// SYNC_END 是 Manchester-II 里的非法序列，高 2 个位周期加低 2 个位周期，接收端靠它锁定
// 它是唯一能确定 body 首位相位的标记
//
// 参考点是 preamble 最后一个位的位中间跳变，preamble 是有边沿的周期图案，不是静默
// SYNC_END 起点比参考点晚半个位周期，于是
//   首位为 1 时，沿落在 body 首个位的位起点，共 0.5T + 4T 等于 4.5T，即 54 tick
//   首位为 0 时，沿落在它的位中间，共 0.5T + 4.5T 等于 5T，即 60 tick
// 也就是 9 或 10 个半位
//
// 这两个值在 body 里不会出现，body 只有 2、3、4 个半位，所以它是唯一的 SYNC_END
// 标记，也顺带消掉了相位二义性
#define DP_AUX_SYNC_END_SLOTS_BODY1 9u   // 4.5T，首位为 1
#define DP_AUX_SYNC_END_SLOTS_BODY0 10u  // 5T，首位为 0

// 帧内合法间隔最多 4 个半位，即 2 个位周期
#define DP_AUX_MAX_SLOTS 4u

// body 最短 8 位，回复事务为 4 bit COMM 加 4 bit 0 填充
#define DP_AUX_MIN_BODY_BITS 8u

// DP 2.0 3.4.1 规定 preamble 为 16 个 0，另有 10 到 16 个 pre-charge 0
// 被动监听允许前段未捕获，要求末段至少覆盖 8 个位周期，避免孤立长间隔触发假同步
#define DP_AUX_MIN_PREAMBLE_PERIODS 8u

static uint8_t dp_aux_interval_to_half_slots(const dp_aux_decoder_t *dec, uint16_t ticks) {
    if (dec->half_ticks == 0u) {
        return 0u;
    }
    uint32_t slots = ((uint32_t)ticks + ((uint32_t)dec->half_ticks / 2u)) / (uint32_t)dec->half_ticks;
    if (slots > 255u) {
        slots = 255u;
    }
    return (uint8_t)slots;
}

void dp_aux_decoder_init(dp_aux_decoder_t *dec, uint16_t half_ticks) {
    if (dec == NULL) {
        return;
    }
    memset(dec, 0, sizeof(*dec));
    dec->half_ticks = (half_ticks != 0u) ? half_ticks : 1u;
    dec->min_interval_ticks = 0xFFFFu;
    dp_aux_decoder_reset_stream(dec);
}

void dp_aux_decoder_reset_stream(dp_aux_decoder_t *dec) {
    if (dec == NULL) {
        return;
    }
    // 回到等待 SYNC_END 标记的状态
    dec->state = DP_AUX_STATE_WAIT_SYNC_END;
    dec->preamble_periods = 0u;
    dec->slot = 0;
    dec->bit_count = 0u;
    dec->flags = 0u;
    memset(dec->data, 0, sizeof(dec->data));
}

static void dp_aux_decoder_emit_body(dp_aux_decoder_t *dec, uint8_t bit) {
    if (dec->bit_count < DP_AUX_MAX_BITS && bit != 0u) {
        dec->data[dec->bit_count >> 3u] |= (uint8_t)(1u << (7u - (dec->bit_count & 7u)));
    }
    dec->bit_count++;
}

// body 里的精确解码
//
// 位 i 占半位槽 [2i, 2i+1]，'0' 为先低后高，'1' 为先高后低，于是上升沿只落在
//   偶数槽 2m   位边界，且 b[m-1] 和 b[m] 都是 1
//   奇数槽 2m+1 某个 '0' 的位中间，b[m] 为 0
// 在未丢沿的前提下，中间未被上升沿揭示的位只判为 1
// 所以只要记住上一个沿在第几个槽和下一个要输出的位号，每次按新槽的奇偶把确定下来
// 的位一次补出来
static void dp_aux_decoder_step_body(dp_aux_decoder_t *dec, uint8_t half_slots) {
    const int32_t next_slot = dec->slot + (int32_t)half_slots;
    if (next_slot < 0) {
        dec->flags |= DP_AUX_FLAG_INTERVAL;
        return;
    }
    const uint16_t revealed = (uint16_t)(next_slot >> 1);

    if ((next_slot & 1) == 0) {
        // 位边界，b[m-1] 和 b[m] 都是 1
        while (dec->bit_count <= revealed) {
            dp_aux_decoder_emit_body(dec, 1u);
        }
    } else {
        // '0' 的位中间，b[m] 为 0
        while (dec->bit_count < revealed) {
            dp_aux_decoder_emit_body(dec, 1u);
        }
        dp_aux_decoder_emit_body(dec, 0u);
    }

    dec->slot = next_slot;
}

static bool dp_aux_decoder_finish(dp_aux_decoder_t *dec, dp_aux_frame_t *frame_out) {
    if (dec->state != DP_AUX_STATE_BODY) {
        dp_aux_decoder_reset_stream(dec);
        return false;
    }
    if (dec->bit_count < DP_AUX_MIN_BODY_BITS &&
        (dec->flags & DP_AUX_FLAG_INTERVAL) == 0u) {
        dec->sync_errors++;
        dp_aux_decoder_reset_stream(dec);
        return false;
    }

    uint16_t bits = dec->bit_count;
    uint8_t flags = dec->flags;

    // 每个完整解出的字节都要保留，协议 LEN 不能用来删证据
    // STOP 的起始沿会贡献一两个残余位
    const uint16_t remainder = (uint16_t)(bits & 7u);
    if (remainder != 0u) {
        flags |= DP_AUX_FLAG_ALIGN_FIX;
        if (remainder > 2u) {
            flags |= DP_AUX_FLAG_INTERVAL;
        }
    }
    if (bits > DP_AUX_MAX_BITS + 2u) {
        flags |= DP_AUX_FLAG_TRUNCATED;
    }
    bits = (uint16_t)(bits & (uint16_t)~7u);
    flags |= DP_AUX_FLAG_ALIGN;

    dp_aux_frame_t built;
    memset(&built, 0, sizeof(built));
    built.flags = flags;
    built.reserved = (uint8_t)((dec->bit_count > 255u) ? 255u : dec->bit_count);
    uint16_t bytes = (uint16_t)(bits >> 3u);
    if (bytes > DP_AUX_MAX_BYTES) {
        bytes = DP_AUX_MAX_BYTES;
    }
    built.byte_count = (uint8_t)bytes;
    built.bit_count = (uint8_t)(bytes * 8u);
    if (bytes > 0u) {
        memcpy(built.data, dec->data, bytes);
    }

    // 固件只给结构提示，方向由主机独立校验
    if (dp_aux_frame_looks_valid(&built)) {
        built.flags |= DP_AUX_FLAG_VALID;
        dec->valid_frames++;
    }
    if (frame_out != NULL) {
        *frame_out = built;
    }

    dec->frames++;
    if ((flags & DP_AUX_FLAG_SYNC_OK) == 0u) {
        dec->sync_errors++;
    }
    dp_aux_decoder_reset_stream(dec);
    return true;
}

bool dp_aux_decoder_feed(dp_aux_decoder_t *dec, uint16_t interval_ticks, dp_aux_frame_t *frame_out) {
    if (dec == NULL) {
        return false;
    }

    if (interval_ticks == 0u) {
        // BSP 的丢样标记或零 tick 毛刺，不要把不连续的采样拼在一起
        if (dec->state != DP_AUX_STATE_BODY) {
            // 帧间丢样只通知主机撤销挂起请求，没有帧内容，不增加解码统计
            if (frame_out != NULL) {
                memset(frame_out, 0, sizeof(*frame_out));
                frame_out->flags = DP_AUX_FLAG_INTERVAL;
            }
            dp_aux_decoder_reset_stream(dec);
            return true;
        }
        dec->flags |= DP_AUX_FLAG_INTERVAL;
        return dp_aux_decoder_finish(dec, frame_out);
    }
    if ((uint32_t)interval_ticks > (uint32_t)dec->half_ticks *
                                           DP_AUX_SYNC_END_SLOTS_BODY0 +
                                       DP_AUX_INTERVAL_TOLERANCE_TICKS) {
        // 电学空闲终止当前帧，实际 STOP 波形未经确认
        dec->sync_gap_count++;
        dec->flags |= DP_AUX_FLAG_IDLE;
        return dp_aux_decoder_finish(dec, frame_out);
    }

    const uint8_t half_slots = dp_aux_interval_to_half_slots(dec, interval_ticks);
    const uint32_t quantized = (uint32_t)half_slots * dec->half_ticks;
    const uint32_t error = (quantized > interval_ticks) ? quantized - interval_ticks : interval_ticks - quantized;
    if (half_slots < 2u || error > DP_AUX_INTERVAL_TOLERANCE_TICKS) {
        dec->flags |= DP_AUX_FLAG_INTERVAL;
        return dp_aux_decoder_finish(dec, frame_out);
    }

    if (dec->state == DP_AUX_STATE_WAIT_SYNC_END) {
        // 零位上升沿相隔一个位周期，允许缺一个边沿形成两个位周期的间隔
        // 24 tick 只用于前导验证，帧内仍按 Manchester 规则检查
        if (half_slots == 2u || half_slots == 4u) {
            const uint8_t periods = (uint8_t)(dec->preamble_periods + half_slots / 2u);
            dec->preamble_periods = (periods < DP_AUX_MIN_PREAMBLE_PERIODS) ? periods : DP_AUX_MIN_PREAMBLE_PERIODS;
            return false;
        }
        const bool have_preamble = dec->preamble_periods >= DP_AUX_MIN_PREAMBLE_PERIODS;
        dec->preamble_periods = 0u;
        if (!have_preamble) return false;
        // 前导通过后，仅由 SYNC_END 确定 body 首位相位
        if (half_slots == DP_AUX_SYNC_END_SLOTS_BODY1) {
            dec->flags = DP_AUX_FLAG_SYNC_OK;
            dec->slot = 0;
            dp_aux_decoder_emit_body(dec, 1u);
            dec->state = DP_AUX_STATE_BODY;
        } else if (half_slots == DP_AUX_SYNC_END_SLOTS_BODY0) {
            dec->flags = DP_AUX_FLAG_SYNC_OK;
            dec->slot = 1;
            dp_aux_decoder_emit_body(dec, 0u);
            dec->state = DP_AUX_STATE_BODY;
        }
        return false;
    }

    if (half_slots > DP_AUX_MAX_SLOTS) {
        // STOP 结束沿，从位边界算是 4T，从位中间算是 4.5T
        if ((half_slots == 8u && (dec->slot & 1) == 0) ||
            (half_slots == 9u && (dec->slot & 1) != 0)) {
            dec->flags |= DP_AUX_FLAG_STOP_OK;
        } else {
            dec->flags |= DP_AUX_FLAG_INTERVAL;
        }
        return dp_aux_decoder_finish(dec, frame_out);
    }
    if (half_slots == 4u && (dec->slot & 1) == 0) {
        // 位边界上升沿，连续 1 之间必须隔 2 个槽
        dec->flags |= DP_AUX_FLAG_INTERVAL;
        return dp_aux_decoder_finish(dec, frame_out);
    }

    dp_aux_decoder_step_body(dec, half_slots);
    if (dec->bit_count > DP_AUX_MAX_BITS + 2u) {
        dec->flags |= DP_AUX_FLAG_TRUNCATED;
        return dp_aux_decoder_finish(dec, frame_out);
    }
    return false;
}

bool dp_aux_decoder_flush(dp_aux_decoder_t *dec, dp_aux_frame_t *frame_out) {
    if (dec == NULL) {
        return false;
    }
    if (dec->state != DP_AUX_STATE_BODY) {
        dp_aux_decoder_reset_stream(dec);
        return false;
    }
    dec->flags |= DP_AUX_FLAG_IDLE;
    return dp_aux_decoder_finish(dec, frame_out);
}

// 只做结构判断，单个上升沿丢失检测不出来
static bool dp_aux_frame_looks_like_request(const dp_aux_frame_t *frame) {
    const uint16_t bytes = frame->byte_count;
    if (bytes < 3u) return false;
    const uint8_t cmd = (uint8_t)(frame->data[0] >> 4);
    const bool native = (cmd == 8u || cmd == 9u);
    if (!native && cmd != 0u && cmd != 1u && cmd != 2u &&
        cmd != 4u && cmd != 5u && cmd != 6u) return false;
    const uint32_t addr = ((uint32_t)(frame->data[0] & 15u) << 16) |
                          ((uint32_t)frame->data[1] << 8) | frame->data[2];
    if (!native && addr > 127u) return false;
    const uint8_t operation = cmd & 3u;
    // DP 2.0 表 2-175 里也有只带地址的 I2C 状态请求
    if (bytes == 3u) return !native;
    const uint8_t len = frame->data[3];
    if (operation == 2u) return len == 0u && bytes == 4u;
    if (len > 15u) return false;
    return bytes == ((operation == 0u) ? (uint16_t)(5u + len) : 4u);
}

static bool dp_aux_frame_looks_like_reply(const dp_aux_frame_t *frame) {
    const uint16_t bytes = frame->byte_count;
    if (bytes < 1u || bytes > 17u || (frame->data[0] & 15u) != 0u) return false;
    const uint8_t cmd = (uint8_t)(frame->data[0] >> 4);
    if (cmd == 0u) return true;
    if (cmd == 1u || cmd == 4u) return bytes <= 2u;
    if (cmd == 2u || cmd == 8u) return bytes == 1u;
    return false;
}

bool dp_aux_frame_looks_valid(const dp_aux_frame_t *frame) {
    if (frame == NULL || frame->byte_count == 0u || frame->byte_count > DP_AUX_MAX_BYTES ||
        frame->bit_count != frame->byte_count * 8u ||
        (frame->flags & (DP_AUX_FLAG_INTERVAL | DP_AUX_FLAG_TRUNCATED)) != 0u) return false;
    return dp_aux_frame_looks_like_request(frame) || dp_aux_frame_looks_like_reply(frame);
}
