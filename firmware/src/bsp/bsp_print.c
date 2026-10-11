#include "bsp/bsp_print.h"

#include <stddef.h>

#include <ch32l103.h>

// 支持的日志输出通道，DEBUG 取值为 PRINT_SDI、PRINT_UARTx 或 PRINT_DISABLE
typedef struct {
    USART_TypeDef *usart;
    GPIO_TypeDef *gpio;
    uint16_t pin;
    uint32_t usart_rcc;
    uint32_t gpio_rcc;
    uint8_t usart_on_apb1;
} uart_config_t;

#if (DEBUG >= PRINT_UART1 && DEBUG <= PRINT_UART3)
static const uart_config_t uart_configs[] = {
    {USART1, GPIOA, GPIO_Pin_9, RCC_PB2Periph_USART1, RCC_PB2Periph_GPIOA, 0},
    {USART2, GPIOA, GPIO_Pin_2, RCC_PB1Periph_USART2, RCC_PB2Periph_GPIOA, 1},
    {USART3, GPIOB, GPIO_Pin_10, RCC_PB1Periph_USART3, RCC_PB2Periph_GPIOB, 1},
};
#endif

void bsp_print_init(uint32_t baudrate) {
#if (DEBUG == PRINT_SDI)
    // SDI 是 WCH-Link 的调试串口，通过 DEBUG_DATA0/1 寄存器收发
    *(DEBUG_DATA0_ADDRESS) = 0;
#elif (DEBUG >= PRINT_UART1 && DEBUG <= PRINT_UART3)
    const uart_config_t *cfg = &uart_configs[DEBUG - 1];

    if (cfg->usart_on_apb1) {
        RCC_PB1PeriphClockCmd(cfg->usart_rcc, ENABLE);
    } else {
        RCC_PB2PeriphClockCmd(cfg->usart_rcc, ENABLE);
    }
    RCC_PB2PeriphClockCmd(cfg->gpio_rcc, ENABLE);

    GPIO_InitTypeDef gpio_init = {
        .GPIO_Pin = cfg->pin,
        .GPIO_Speed = GPIO_Speed_50MHz,
        .GPIO_Mode = GPIO_Mode_AF_PP,
    };
    GPIO_Init(cfg->gpio, &gpio_init);

    USART_InitTypeDef usart_init = {
        .USART_BaudRate = baudrate,
        .USART_WordLength = USART_WordLength_8b,
        .USART_StopBits = USART_StopBits_1,
        .USART_Parity = USART_Parity_No,
        .USART_HardwareFlowControl = USART_HardwareFlowControl_None,
        .USART_Mode = USART_Mode_Tx,
    };

    USART_Init(cfg->usart, &usart_init);
    USART_Cmd(cfg->usart, ENABLE);
#else
    (void)baudrate;
#endif
}

__attribute__((used)) int _write(int fd, char *buf, int size) {
    (void)fd;
    if (size <= 0) {
        return 0;
    }

#if (DEBUG == PRINT_SDI)
    int offset = 0;
    int remain = size;
    const uint8_t *src = (const uint8_t *)buf;

    while (remain > 0) {
        // 等待上一次传输完成
        while (*(DEBUG_DATA0_ADDRESS) != 0u);

        const int chunk = (remain > 7) ? 7 : remain;
        uint32_t d0 = (uint32_t)chunk;
        uint32_t d1 = 0u;

        for (int i = 0; i < chunk && i < 3; i++) {
            d0 |= ((uint32_t)src[offset + i]) << (8 * (i + 1));
        }
        for (int i = 3; i < chunk; i++) {
            d1 |= ((uint32_t)src[offset + i]) << (8 * (i - 3));
        }

        *(DEBUG_DATA1_ADDRESS) = d1;
        *(DEBUG_DATA0_ADDRESS) = d0;

        offset += chunk;
        remain -= chunk;
    }
#elif (DEBUG >= PRINT_UART1 && DEBUG <= PRINT_UART3)
    static USART_TypeDef *uart_map[] = {NULL, USART1, USART2, USART3};
    USART_TypeDef *uart = uart_map[DEBUG];
    for (int i = 0; i < size; i++) {
        while (USART_GetFlagStatus(uart, USART_FLAG_TC) == RESET);
        USART_SendData(uart, (uint8_t)*buf++);
    }
#else
    (void)buf;
#endif
    return size;
}

// newlib 需要 _sbrk 才能用 printf，这里在链接脚本给出的堆区间里分配
__attribute__((used)) void *_sbrk(ptrdiff_t incr) {
    extern char _end[];
    extern char _heap_end[];
    static char *curbrk = _end;

    if ((curbrk + incr < _end) || (curbrk + incr > _heap_end)) return (void *)-1;

    curbrk += incr;
    return curbrk - incr;
}
