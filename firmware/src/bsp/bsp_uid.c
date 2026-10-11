#include "bsp/bsp_uid.h"

#include <ch32l103.h>

static void uid_hex8(uint8_t value, char *out) {
    static const char hex[] = "0123456789ABCDEF";
    out[0] = hex[(value >> 4) & 0x0F];
    out[1] = hex[value & 0x0F];
}

uint32_t bsp_get_chip_id(void) {
    return DBGMCU_GetCHIPID();
}

// 把 8 字节 UID 转成 16 个十六进制字符，用于 USB 序列号
void bsp_get_uid_hex16(char out_hex[BSP_UID_HEX16_STR_LEN]) {
    if (out_hex == 0) return;
    const uint32_t uid1 = CHIP_UID_1;
    const uint32_t uid2 = CHIP_UID_2;
    const uint32_t uid_words[2] = {uid1, uid2};

    for (uint8_t i = 0; i < 8; i++) {
        const uint32_t word = uid_words[i >> 2];
        const uint8_t value = (uint8_t)((word >> ((i & 0x03u) * 8u)) & 0xFFu);
        uid_hex8(value, &out_hex[i * 2]);
    }
    out_hex[BSP_UID_HEX16_STR_LEN - 1] = '\0';
}
