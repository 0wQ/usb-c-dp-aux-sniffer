#include "dp_aux/dp_aux_capture.h"

#include "bsp/bsp_delay.h"
#include "bsp/bsp_dp_aux.h"
#include "config.h"
#include "dp_aux/dp_aux_decoder.h"
#include "dp_aux/frame_queue.h"

#include <string.h>

// 一次 poll 最多消费多少个间隔
// 限制单次主循环预算，用 64-word 小缓冲分批消费，捕获环形容量 2048
#define DP_AUX_DRAIN_CHUNK 2048u

static dp_aux_decoder_t s_decoder;
static uint32_t s_last_edge_us;
static uint32_t s_gap_count;
static bool s_loss_reported;
static uint32_t s_frame_seq;

void dp_aux_capture_init(void) {
    bsp_dp_aux_init();
    dp_aux_decoder_init(&s_decoder, (uint16_t)CONFIG_DP_AUX_HALF_TICKS);
    frame_queue_init();

    s_last_edge_us = micros();
    s_gap_count = 0u;
    s_loss_reported = false;
    s_frame_seq = 0u;
}

// 把解码器输出的一帧封成队列记录
static void dp_aux_capture_emit(const dp_aux_frame_t *frame) {
    dp_aux_record_t rec;
    // 序号在入队前递增，丢弃旧记录不会掩盖采集流中的缺口
    rec.seq = ++s_frame_seq;
    rec.timestamp_us = micros();
    rec.flags = frame->flags;
    rec.bit_count = frame->bit_count;
    rec.byte_count = frame->byte_count;
    rec.raw_bits = frame->reserved;
    memset(rec.data, 0, sizeof(rec.data));
    if (frame->byte_count > 0u) {
        uint8_t n = frame->byte_count;
        if (n > DP_AUX_MAX_BYTES) {
            n = DP_AUX_MAX_BYTES;
        }
        memcpy(rec.data, frame->data, n);
    }
    (void)frame_queue_push(&rec);
}

void dp_aux_capture_poll(void) {
    // 64-word 栈缓冲分批消费，4096 字节的局部数组会超出链接脚本预留的栈
    uint16_t buf[64];
    const uint32_t now_us = micros();

    uint16_t consumed = 0u;
    uint16_t n;
    while (consumed < DP_AUX_DRAIN_CHUNK &&
           (n = bsp_dp_aux_read_intervals(buf, 64u)) > 0u) {
        consumed = (uint16_t)(consumed + n);
        s_last_edge_us = now_us;
        for (uint16_t i = 0u; i < n; i++) {
            // 被限制为最大值的间隔说明这一段是空闲或慢速抖动，不是 AUX 位流，
            // 单独计数，避免它把 min_interval 拉成无意义的 21 us
            // 0 tick 是丢样标记，不参与最小值，非零短间隔仍保留供噪声诊断
            if (buf[i] >= (uint16_t)BSP_DP_AUX_GAP_TICKS) {
                s_gap_count++;
            } else if (buf[i] != 0u && buf[i] < s_decoder.min_interval_ticks) {
                s_decoder.min_interval_ticks = buf[i];
            }

            // 一段连续损坏的码流只报一次丢失标记，避免刷爆帧队列、拖慢消费
            if (buf[i] == 0u && s_loss_reported) {
                dp_aux_decoder_reset_stream(&s_decoder);
                continue;
            }

            dp_aux_frame_t frame;
            if (dp_aux_decoder_feed(&s_decoder, buf[i], &frame)) {
                if (frame.byte_count == 0u && (frame.flags & DP_AUX_FLAG_INTERVAL) != 0u) {
                    if (!s_loss_reported) {
                        dp_aux_capture_emit(&frame);
                    }
                    s_loss_reported = true;
                } else {
                    dp_aux_capture_emit(&frame);
                    if ((frame.flags & (DP_AUX_FLAG_INTERVAL | DP_AUX_FLAG_TRUNCATED)) == 0u) {
                        s_loss_reported = false;
                    }
                }
            }
        }
    }

    if (consumed == 0u && (uint32_t)(now_us - s_last_edge_us) >= CONFIG_DP_AUX_IDLE_TIMEOUT_US) {
        // 空闲收尾不需要重启捕获。在这里重启会丢掉检查环形缓冲后刚到的新边沿，
        // 下一个间隔会被限制为最大值
        dp_aux_frame_t frame;
        if (dp_aux_decoder_flush(&s_decoder, &frame)) {
            dp_aux_capture_emit(&frame);
        } else {
            dp_aux_decoder_reset_stream(&s_decoder);
        }
        // 下一帧的第一条边沿只建立新的时间参考，不与上一帧末尾的边沿相减
        bsp_dp_aux_reset_interval_reference();
        s_last_edge_us = now_us;
    }
}

void dp_aux_capture_set_enabled(bool en) {
    bsp_dp_aux_set_enabled(en);
    dp_aux_decoder_reset_stream(&s_decoder);
    s_loss_reported = false;
}

bool dp_aux_capture_is_enabled(void) {
    return bsp_dp_aux_is_enabled();
}

void dp_aux_capture_set_falling_edge(bool falling) {
    bsp_dp_aux_set_falling_edge(falling);
    dp_aux_decoder_reset_stream(&s_decoder);
    s_loss_reported = false;
    frame_queue_reset();
    // 切换捕获边沿会丢弃当前上下文，下一帧留下序号缺口
    s_frame_seq++;
}

void dp_aux_capture_clear_stats(void) {
    bsp_dp_aux_restart(false);
    dp_aux_decoder_reset_stream(&s_decoder);
    s_loss_reported = false;
    bsp_dp_aux_clear_counters();

    s_decoder.frames = 0u;
    s_decoder.valid_frames = 0u;
    s_decoder.sync_errors = 0u;
    s_decoder.min_interval_ticks = 0xFFFFu;
    s_decoder.sync_gap_count = 0u;
    s_gap_count = 0u;
    frame_queue_reset();
    // 下一帧留下序号缺口，让主机撤销清零前的配对上下文，不生成额外通知帧
    s_frame_seq++;
}

void dp_aux_capture_get_stats(dp_aux_stats_t *out) {
    if (out == NULL) {
        return;
    }
    out->edge_count = bsp_dp_aux_get_edge_count();
    out->frame_count = s_decoder.frames;
    out->valid_frame_count = s_decoder.valid_frames;
    out->sync_error_count = s_decoder.sync_errors;
    out->ring_overrun = bsp_dp_aux_get_overrun_count();
    out->capture_overrun = bsp_dp_aux_get_capture_overrun_count();
    out->queue_drop_count = frame_queue_get_drop_count();
    out->min_interval_ticks = s_decoder.min_interval_ticks;
    out->half_ticks = s_decoder.half_ticks;
    out->tick_hz_khz = (uint16_t)(CONFIG_DP_AUX_TICK_HZ / 1000u);
    out->gap_count = (uint16_t)((s_gap_count > 0xFFFFu) ? 0xFFFFu : s_gap_count);
}
