#include "dp_aux/frame_queue.h"

#include "chry_ringbuffer.h"

#include <stddef.h>
#include <string.h>

// 4 KB 环形缓冲，128 条记录
// 按 AUX 突发背压取值，HID 一个 report 每毫秒，一段突发必须能整体缓下来，而不是只放一帧
#define FRAME_QUEUE_SIZE 4096u

#if (FRAME_QUEUE_SIZE < 2u) || (FRAME_QUEUE_SIZE & (FRAME_QUEUE_SIZE - 1u))
#error "FRAME_QUEUE_SIZE 必须是 2 的幂"
#endif

static uint8_t s_pool[FRAME_QUEUE_SIZE];
static chry_ringbuffer_t s_rb;
static uint32_t s_drop_count;

void frame_queue_init(void) {
    (void)chry_ringbuffer_init(&s_rb, s_pool, FRAME_QUEUE_SIZE);
    s_drop_count = 0u;
}

bool frame_queue_push(const dp_aux_record_t *rec) {
    if (rec == NULL) {
        return false;
    }

    // 固定大小记录，空间不够就先丢最旧的一条，保证最新数据一定进得去
    while (chry_ringbuffer_get_free(&s_rb) < (uint32_t)sizeof(*rec)) {
        if (chry_ringbuffer_check_empty(&s_rb)) {
            s_drop_count++;
            return false;
        }
        (void)chry_ringbuffer_drop(&s_rb, (uint32_t)sizeof(*rec));
        s_drop_count++;
    }

    if (chry_ringbuffer_write(&s_rb, (void *)rec, (uint32_t)sizeof(*rec)) != (uint32_t)sizeof(*rec)) {
        s_drop_count++;
        return false;
    }
    return true;
}

bool frame_queue_pop(dp_aux_record_t *rec) {
    if (rec == NULL) {
        return false;
    }
    if (chry_ringbuffer_get_used(&s_rb) < (uint32_t)sizeof(*rec)) {
        return false;
    }
    if (chry_ringbuffer_read(&s_rb, rec, (uint32_t)sizeof(*rec)) != (uint32_t)sizeof(*rec)) {
        return false;
    }
    return true;
}

uint32_t frame_queue_get_count(void) {
    return chry_ringbuffer_get_used(&s_rb) / (uint32_t)sizeof(dp_aux_record_t);
}

uint32_t frame_queue_get_drop_count(void) {
    return s_drop_count;
}

void frame_queue_reset(void) {
    chry_ringbuffer_reset(&s_rb);
    s_drop_count = 0u;
}
