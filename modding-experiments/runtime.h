/* Shared runtime for recompiled CHIP-8 games. Mirrors chip8.py exactly. */
#ifndef RUNTIME_H
#define RUNTIME_H
#include <stdint.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>

#define W 64
#define H 32
#define IPF 500

typedef struct {
    uint8_t mem[4096];
    uint8_t V[16];
    uint16_t I, pc, stack[16];
    int sp;
    uint8_t dt, st;
    uint8_t fb[W * H];
    uint16_t keys;
    uint32_t rng;
} chip8_t;

static const uint8_t FONT[80] = {
    0xF0,0x90,0x90,0x90,0xF0, 0x20,0x60,0x20,0x20,0x70, 0xF0,0x10,0xF0,0x80,0xF0,
    0xF0,0x10,0xF0,0x10,0xF0, 0x90,0x90,0xF0,0x10,0x10, 0xF0,0x80,0xF0,0x10,0xF0,
    0xF0,0x80,0xF0,0x90,0xF0, 0xF0,0x10,0x20,0x40,0x40, 0xF0,0x90,0xF0,0x90,0xF0,
    0xF0,0x90,0xF0,0x10,0xF0, 0xF0,0x90,0xF0,0x90,0x90, 0xE0,0x90,0xE0,0x90,0xE0,
    0xF0,0x80,0x80,0x80,0xF0, 0xE0,0x90,0x90,0x90,0xE0, 0xF0,0x80,0xF0,0x80,0xF0,
    0xF0,0x80,0xF0,0x80,0x80,
};

static inline void c8_init(chip8_t *s, const uint8_t *rom, size_t len, uint32_t seed) {
    memset(s, 0, sizeof *s);
    memcpy(s->mem, FONT, sizeof FONT);
    memcpy(s->mem + 0x200, rom, len);
    s->pc = 0x200;
    s->rng = seed;
}

static inline uint8_t c8_rand(chip8_t *s) {
    s->rng = s->rng * 1103515245u + 12345u;
    return (s->rng >> 16) & 0xFF;
}

static inline void c8_draw(chip8_t *s, int x, int y, int n) {
    int x0 = s->V[x] % W, y0 = s->V[y] % H, hit = 0;
    for (int row = 0; row < n && y0 + row < H; row++) {
        uint8_t bits = s->mem[(s->I + row) & 0xFFF];
        for (int col = 0; col < 8 && x0 + col < W; col++)
            if (bits & (0x80 >> col)) {
                int i = (y0 + row) * W + x0 + col;
                hit |= s->fb[i];
                s->fb[i] ^= 1;
            }
    }
    s->V[0xF] = hit;
}

static inline void c8_tick(chip8_t *s) {
    if (s->dt) s->dt--;
    if (s->st) s->st--;
}

static inline uint32_t c8_hash(const chip8_t *s) {
    uint32_t h = 0x811C9DC5u;
#define MIX(b) h = (h ^ (uint8_t)(b)) * 0x01000193u
    for (int i = 0; i < W * H; i++) MIX(s->fb[i]);
    for (int i = 0; i < 16; i++) MIX(s->V[i]);
    MIX(s->I & 0xFF); MIX(s->I >> 8);
#undef MIX
    return h;
}
#endif
