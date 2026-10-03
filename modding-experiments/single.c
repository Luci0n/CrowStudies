/* Runs one recompiled game. Reads one key mask (hex) per frame from stdin and
 * prints the state hash after each frame, for comparison with chip8.py. */
#include "runtime.h"

#define CAT_(a, b) a##b
#define CAT(a, b) CAT_(a, b)
extern const unsigned char CAT(GAME, _rom)[];
extern const unsigned CAT(GAME, _rom_len);
void CAT(GAME, _frame)(chip8_t *s);

int main(void) {
    static chip8_t s;
    c8_init(&s, CAT(GAME, _rom), CAT(GAME, _rom_len), 1);
    unsigned keys;
    while (scanf("%x", &keys) == 1) {
        s.keys = keys;
        CAT(GAME, _frame)(&s);
        c8_tick(&s);
        printf("%08x\n", c8_hash(&s));
    }
    return 0;
}
