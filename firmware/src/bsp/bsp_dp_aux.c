#include "bsp/bsp_dp_aux.h"

#include "config.h"

#include <stddef.h>

#include <ch32l103.h>

// CH32L103 参考手册 11.2.3 给出 TIM2_CH3 对应 DMA1 通道 1
// LED SPI1_TX 用的是通道 3，AUX 模式下 ADC、USART4_TX、TIM4_CH1 都不能再请求通道 1
// DMA 直接把时间戳搬进内存并顺带清 CC3IF，不需要逐沿进 CPU 中断
#define DP_AUX_RING_SIZE 2048u
#define DP_AUX_RING_MASK (DP_AUX_RING_SIZE - 1u)
#define DP_AUX_DMA_FLAGS (DMA_HTIF1 | DMA_TCIF1 | DMA_TEIF1)

// DMA 循环缓冲，存的是每个选定极性的 TIM2 捕获值
static volatile uint16_t g_ring[DP_AUX_RING_SIZE];
static volatile uint32_t g_wraps;                  // DMA 绕圈次数
static volatile uint32_t g_loss_generation;        // 丢失代号，变化即代表发生过丢失
static volatile uint32_t g_overrun_count;          // 环形缓冲被覆盖的采样数
static volatile uint32_t g_capture_overrun_count;  // CC3OF 或 DMA 传输错误次数
static uint32_t g_consumed;                        // 主循环已消费到的生产者位置
static uint32_t g_counted_producer;                // 已计入 edge_count 的生产者位置
static uint32_t g_edge_count;
static uint32_t g_seen_loss;                // 主循环上次看到的丢失代号
static volatile uint8_t g_expect_complete;  // 半满和全满的相位预测
static uint16_t g_last_capture;             // 上一次捕获值，用来算间隔
static bool g_have_last;
static bool g_pending_loss;
static bool g_enabled;
static bool g_falling_edge;

static void capture_barrier(void) {
#if defined(__riscv)
    __asm__ volatile("fence iorw, iorw" ::: "memory");
#else
    __asm__ volatile("" ::: "memory");
#endif
}

// 由 DMA 中断调用，或在屏蔽该中断时调用
// 半满和全满中断每 1024 个边沿触发一次，按每微秒一个上升沿计算约为 1 ms
static void capture_service_flags(void) {
    const uint32_t flags = DMA1->INTFR & DP_AUX_DMA_FLAGS;
    if (flags != 0u) {
        // 只清观察到的标志位，不用 GIF，GIF 会清掉所有通道标志
        DMA_ClearITPendingBit(flags);
        const uint32_t phase = flags & (DMA_HTIF1 | DMA_TCIF1);
        if (phase == (DMA_HTIF1 | DMA_TCIF1) ||
            (phase == DMA_HTIF1 && g_expect_complete != 0u) ||
            (phase == DMA_TCIF1 && g_expect_complete == 0u)) {
            // 粘滞标志无法说明延迟期间绕了几圈
            // 宁可报丢失，也不能在 DMA 循环次数不确定时继续解码
            g_overrun_count++;
            g_loss_generation++;
        }
        if ((phase & DMA_TCIF1) != 0u) {
            g_wraps++;
        }
        if (phase == (DMA_HTIF1 | DMA_TCIF1)) {
            const uint32_t remaining = DMA1_Channel1->CNTR;
            g_expect_complete = remaining <= DP_AUX_RING_SIZE / 2u && remaining != 0u;
        } else if (phase != 0u) {
            g_expect_complete = (phase == DMA_HTIF1);
        }
        if ((flags & DMA_TEIF1) != 0u) {
            // DMA 总线错误会关掉通道，主循环读取时会尝试恢复
            g_capture_overrun_count++;
            g_loss_generation++;
        }
    }
    if ((TIM2->INTFR & TIM_FLAG_CC3OF) != 0u) {
        // 统计的是锁存的丢失事件，不是物理上丢掉的边沿数
        // CC3IF 归 DMA 管，如果还有未完成的请求就别动它
        TIM_ClearFlag(TIM2, TIM_FLAG_CC3OF);
        g_capture_overrun_count++;
        g_loss_generation++;
    }
}

void DMA1_Channel1_IRQHandler(void) __attribute__((interrupt("WCH-Interrupt-fast")));
void DMA1_Channel1_IRQHandler(void) {
    capture_service_flags();
}

// 屏蔽 DMA 记账中断时 DMA 仍在捕获
// 读完 CNTR 后要再确认一次 TC，这样快照期间发生的绕圈只会被计一次
static uint32_t capture_producer_locked(void) {
    uint32_t remaining;
    do {
        capture_service_flags();
        remaining = DMA1_Channel1->CNTR;
    } while ((DMA1->INTFR & DMA_TCIF1) != 0u);
    capture_barrier();
    // CNTR 在循环重载前会短暂为 0
    // 记账完传输完成标志后，这属于新的 DMA 循环，不是上一轮再增加一圈
    const uint32_t produced = g_wraps * DP_AUX_RING_SIZE +
                              ((DP_AUX_RING_SIZE - remaining) & DP_AUX_RING_MASK);
    const uint32_t added = produced - g_counted_producer;
    if (added > 0x7FFFFFFFu) {
        // 在 DMA 重载边界上的快照不能让消费位置倒退，先丢弃本次结果，等待下一次稳定快照
        g_overrun_count++;
        g_loss_generation++;
        return g_counted_producer;
    }
    g_edge_count += added;
    g_counted_producer = produced;
    return produced;
}

static uint32_t capture_snapshot(uint32_t *loss) {
    const uint32_t irq_enabled = NVIC_GetStatusIRQ(DMA1_Channel1_IRQn);
    NVIC_DisableIRQ(DMA1_Channel1_IRQn);
    const uint32_t produced = capture_producer_locked();
    *loss = g_loss_generation;
    if (irq_enabled != 0u) {
        NVIC_EnableIRQ(DMA1_Channel1_IRQn);
    }
    return produced;
}

void bsp_dp_aux_init(void) {
    OPCM_Unlock();

    // AUX_P 和 AUX_N 作为比较器模拟输入
    RCC_PB2PeriphClockCmd(CONFIG_DP_AUX_GPIO_CLK, ENABLE);
    GPIO_InitTypeDef gpio = {0};
    gpio.GPIO_Pin = (uint16_t)(CONFIG_DP_AUX_PIN_P | CONFIG_DP_AUX_PIN_N);
    gpio.GPIO_Speed = GPIO_Speed_50MHz;
    gpio.GPIO_Mode = GPIO_Mode_AIN;
    GPIO_Init(CONFIG_DP_AUX_GPIO_PORT, &gpio);

    // CMP3 正端 CH0 对应 PB5，负端 CH0 对应 PB3，输出接到内部 TIM2
    CMP_InitTypeDef cmp = {0};
    cmp.CMP_NUM = CMP3;
    cmp.Mode = OUT_IO_TIM2;
    cmp.NSEL = CMP_CHN0;
    cmp.PSEL = CMP_CHP_0;
#if (CONFIG_DP_AUX_CMP_HYSTERESIS != 0U)
    cmp.HYEN = CMP_HYEN1;
#else
    cmp.HYEN = CMP_HYEN0;
#endif
    OPA_CMP_Init(&cmp);
    OPA_CMP_Cmd(CMP3, DISABLE);

    // TIM2 自由运行在捕获 tick，默认 12 MHz，CH3 默认捕获上升沿
    RCC_PB1PeriphClockCmd(RCC_PB1Periph_TIM2, ENABLE);
    TIM_TimeBaseInitTypeDef time_base = {0};
    time_base.TIM_Period = 0xFFFFu;
    time_base.TIM_Prescaler = (uint16_t)((CONFIG_DP_AUX_TIMER_HZ / CONFIG_DP_AUX_TICK_HZ) - 1u);
    time_base.TIM_ClockDivision = TIM_CKD_DIV1;
    time_base.TIM_CounterMode = TIM_CounterMode_Up;
    TIM_TimeBaseInit(TIM2, &time_base);

    TIM_ICInitTypeDef ic = {0};
    ic.TIM_Channel = TIM_Channel_3;
    ic.TIM_ICPolarity = TIM_ICPolarity_Rising;
    ic.TIM_ICSelection = TIM_ICSelection_DirectTI;
    ic.TIM_ICPrescaler = TIM_ICPSC_DIV1;
    ic.TIM_ICFilter = (uint16_t)CONFIG_DP_AUX_IC3F;
    TIM_ICInit(TIM2, &ic);
    TIM_ITConfig(TIM2, TIM_IT_CC3, DISABLE);
    NVIC_DisableIRQ(TIM2_IRQn);

    // DMA1 通道 1 把 TIM2_CH3 搬到 g_ring，循环模式，半满和全满及错误中断
    RCC_HBPeriphClockCmd(RCC_HBPeriph_DMA1, ENABLE);
    DMA_DeInit(DMA1_Channel1);
    DMA_InitTypeDef dma = {0};
    dma.DMA_PeripheralBaseAddr = (uint32_t)(uintptr_t)&TIM2->CH3CVR;
    dma.DMA_MemoryBaseAddr = (uint32_t)(uintptr_t)g_ring;
    dma.DMA_DIR = DMA_DIR_PeripheralSRC;
    dma.DMA_BufferSize = DP_AUX_RING_SIZE;
    dma.DMA_PeripheralInc = DMA_PeripheralInc_Disable;
    dma.DMA_MemoryInc = DMA_MemoryInc_Enable;
    dma.DMA_PeripheralDataSize = DMA_PeripheralDataSize_HalfWord;
    dma.DMA_MemoryDataSize = DMA_MemoryDataSize_HalfWord;
    dma.DMA_Mode = DMA_Mode_Circular;
    dma.DMA_Priority = DMA_Priority_VeryHigh;
    dma.DMA_M2M = DMA_M2M_Disable;
    DMA_Init(DMA1_Channel1, &dma);
    DMA_ITConfig(DMA1_Channel1, DMA_IT_HT | DMA_IT_TC | DMA_IT_TE, ENABLE);
    NVIC_SetPriority(DMA1_Channel1_IRQn, 0);
    NVIC_EnableIRQ(DMA1_Channel1_IRQn);

    g_edge_count = 0u;
    g_overrun_count = 0u;
    g_capture_overrun_count = 0u;
    g_loss_generation = 0u;
    g_wraps = 0u;
    g_counted_producer = 0u;
    g_falling_edge = false;
    TIM_Cmd(TIM2, ENABLE);
    g_enabled = true;
    bsp_dp_aux_restart(false);
    OPA_CMP_Cmd(CMP3, ENABLE);
}

void bsp_dp_aux_set_enabled(bool en) {
    OPA_CMP_Cmd(CMP3, DISABLE);
    g_enabled = en;
    bsp_dp_aux_restart(true);
    if (en) {
        OPA_CMP_Cmd(CMP3, ENABLE);
    }
}

bool bsp_dp_aux_is_enabled(void) {
    return g_enabled;
}

void bsp_dp_aux_set_falling_edge(bool falling) {
    TIM_ICInitTypeDef ic = {0};

    OPA_CMP_Cmd(CMP3, DISABLE);
    g_falling_edge = falling;
    TIM_DMACmd(TIM2, TIM_DMA_CC3, DISABLE);
    DMA_Cmd(DMA1_Channel1, DISABLE);
    ic.TIM_Channel = TIM_Channel_3;
    ic.TIM_ICPolarity = falling ? TIM_ICPolarity_Falling : TIM_ICPolarity_Rising;
    ic.TIM_ICSelection = TIM_ICSelection_DirectTI;
    ic.TIM_ICPrescaler = TIM_ICPSC_DIV1;
    ic.TIM_ICFilter = (uint16_t)CONFIG_DP_AUX_IC3F;
    TIM_ICInit(TIM2, &ic);
    bsp_dp_aux_restart(false);
    if (g_enabled) {
        OPA_CMP_Cmd(CMP3, ENABLE);
    }
}

// 丢弃积压，把消费位置追到生产者，并插入一个丢样标记
static void capture_discard(uint32_t produced, uint32_t loss) {
    g_consumed = produced;
    g_seen_loss = loss;
    g_have_last = false;
    g_pending_loss = true;
}

static void capture_note_overwrite(uint32_t count) {
    // DMA 中断也会改这个计数器，保护读改写
    const uint32_t irq_enabled = NVIC_GetStatusIRQ(DMA1_Channel1_IRQn);
    NVIC_DisableIRQ(DMA1_Channel1_IRQn);
    g_overrun_count += count;
    if (irq_enabled != 0u) {
        NVIC_EnableIRQ(DMA1_Channel1_IRQn);
    }
}

uint16_t bsp_dp_aux_read_intervals(uint16_t *out, uint16_t max) {
    if (out == NULL || max == 0u) {
        return 0u;
    }
    uint32_t loss;
    uint32_t produced = capture_snapshot(&loss);
    if (g_enabled && (DMA1_Channel1->CFGR & DMA_CFGR1_EN) == 0u) {
        // DMA 通道被总线错误关掉了，尝试恢复
        bsp_dp_aux_restart(true);
        produced = capture_snapshot(&loss);
    }
    if (loss != g_seen_loss) {
        // 锁存的硬件丢失无法定位到某个精确时间点，丢弃积压，不输出半损坏的采样
        capture_discard(produced, loss);
    }
    if ((uint32_t)(produced - g_consumed) > DP_AUX_RING_SIZE) {
        capture_note_overwrite(produced - g_consumed - DP_AUX_RING_SIZE);
        capture_discard(produced, loss);
    }
    uint16_t count = 0u;
    if (g_pending_loss) {
        out[count++] = 0u;
        g_pending_loss = false;
    }
    const uint32_t start = g_consumed;
    uint32_t cursor = start;
    uint16_t last = g_last_capture;
    bool have_last = g_have_last;
    while (count < max && cursor != produced) {
        const uint16_t captured = g_ring[cursor & DP_AUX_RING_MASK];
        cursor++;
        if (have_last) {
            const uint16_t delta = (uint16_t)(captured - last);
            // 小于一个 tick 的重复值按丢样标记处理，绝不猜成某个位
            out[count++] = (delta > BSP_DP_AUX_GAP_TICKS) ? BSP_DP_AUX_GAP_TICKS : delta;
        }
        last = captured;
        have_last = true;
    }
    // 拷贝期间 DMA 会覆盖最旧的条目，拷贝之后再校验一次，一旦发现撕裂就整批丢弃
    const uint32_t after = capture_snapshot(&loss);
    if (loss != g_seen_loss || (uint32_t)(after - start) > DP_AUX_RING_SIZE) {
        if ((uint32_t)(after - start) > DP_AUX_RING_SIZE) {
            capture_note_overwrite(after - start - DP_AUX_RING_SIZE);
        }
        capture_discard(after, loss);
        g_pending_loss = false;
        out[0] = 0u;
        return 1u;
    }
    g_consumed = cursor;
    g_last_capture = last;
    g_have_last = have_last;
    return count;
}

void bsp_dp_aux_reset_interval_reference(void) {
    g_have_last = false;
}

void bsp_dp_aux_restart(bool notify_loss) {
    const uint32_t irq_enabled = NVIC_GetStatusIRQ(DMA1_Channel1_IRQn);
    NVIC_DisableIRQ(DMA1_Channel1_IRQn);
    TIM_DMACmd(TIM2, TIM_DMA_CC3, DISABLE);
    DMA_Cmd(DMA1_Channel1, DISABLE);
    (void)capture_producer_locked();
    DMA_ClearITPendingBit(DP_AUX_DMA_FLAGS);
    DMA_SetCurrDataCounter(DMA1_Channel1, DP_AUX_RING_SIZE);
    TIM_ClearFlag(TIM2, TIM_FLAG_CC3 | TIM_FLAG_CC3OF);
    g_wraps = 0u;
    g_counted_producer = 0u;
    g_expect_complete = 0u;
    g_loss_generation++;
    capture_discard(0u, g_loss_generation);
    // 主动初始化和清零只重置采样参考，不向解码器报告丢样
    g_pending_loss = notify_loss;
    if (g_enabled) {
        DMA_Cmd(DMA1_Channel1, ENABLE);
        TIM_DMACmd(TIM2, TIM_DMA_CC3, ENABLE);
    }
    if (irq_enabled != 0u) {
        NVIC_EnableIRQ(DMA1_Channel1_IRQn);
    }
}

uint32_t bsp_dp_aux_get_edge_count(void) {
    uint32_t loss;
    (void)capture_snapshot(&loss);
    return g_edge_count;
}

uint32_t bsp_dp_aux_get_overrun_count(void) {
    return g_overrun_count;
}

uint32_t bsp_dp_aux_get_capture_overrun_count(void) {
    return g_capture_overrun_count;
}

void bsp_dp_aux_clear_counters(void) {
    const uint32_t irq_enabled = NVIC_GetStatusIRQ(DMA1_Channel1_IRQn);
    NVIC_DisableIRQ(DMA1_Channel1_IRQn);
    (void)capture_producer_locked();
    g_edge_count = 0u;
    g_overrun_count = 0u;
    g_capture_overrun_count = 0u;
    if (irq_enabled != 0u) {
        NVIC_EnableIRQ(DMA1_Channel1_IRQn);
    }
}
