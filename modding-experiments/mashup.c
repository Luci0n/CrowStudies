/* DODGEBALL: Dodge and Bounce recompiled and linked into one executable.
 *
 * Mods (hooks inserted by recomp.py at addresses found by re_scan.py):
 *   hook_ball_hazard - before Dodge tests VF after drawing the rock, Bounce's
 *                      ball is drawn into Dodge's world. If it lands on the
 *                      player, VF is set, so Dodge's own "hit" code runs.
 *   hook_score       - each rock Dodge counts as dodged speeds up Bounce's ball.
 *
 * Writes one 128x32 frame (Dodge | Bounce) per tick to stdout as raw bytes.
 */
#include "runtime.h"

extern const unsigned char dodge_rom[], bounce_rom[];
extern const unsigned dodge_rom_len, bounce_rom_len;
void dodge_frame(chip8_t *s);
void bounce_frame(chip8_t *s);

/* Register meanings read off the disassembly (DRW V0,V1 in Bounce, LD V4,26 /
 * DRW V0,V4 in Dodge, LD V7,V5 step loop in Bounce). */
enum { BALL_X = 0, BALL_Y = 1, BALL_SPEED = 5, PLAYER_ROW = 26, PLAYER_X = 0, ROCK_X = 1 };

static chip8_t dodge, bounce;
static uint8_t shown_dodge[W * H], shown_bounce[W * H];
static int ball_x, ball_y;  /* where Bounce last showed its ball */

/* "Vsync" hooks: each game sets its delay timer once its frame is fully drawn,
 * so that is the moment to present the screen (avoids mid-redraw flicker). */
void hook_present_dodge(chip8_t *s) { memcpy(shown_dodge, s->fb, sizeof shown_dodge); }
void hook_present_bounce(chip8_t *s) {
    memcpy(shown_bounce, s->fb, sizeof shown_bounce);
    ball_x = s->V[BALL_X] % W;
    ball_y = s->V[BALL_Y] % H;
}

void hook_ball_hazard(chip8_t *s) {
    int bx = ball_x, by = ball_y, hit = 0;
    for (int dy = 0; dy < 2 && by + dy < H; dy++)
        for (int dx = 0; dx < 2 && bx + dx < W; dx++) {
            int i = (by + dy) * W + bx + dx;
            if (s->fb[i] && by + dy >= PLAYER_ROW) hit = 1;
            s->fb[i] = 1;
        }
    if (hit) s->V[0xF] = 1;
}

void hook_score(chip8_t *s) {
    (void)s;
    if (bounce.V[BALL_SPEED] < 3) bounce.V[BALL_SPEED]++;
}

/* A tiny trainer-style bot so the recording is watchable: steer away from the
 * nearest hazard once it gets close to the player's row. */
static uint16_t autopilot(void) {
    int px = dodge.V[PLAYER_X] + 4;
    int threats[2] = { dodge.V[ROCK_X] + 4, ball_y > 14 ? ball_x + 1 : -100 };
    for (int i = 0; i < 2; i++) {
        int d = threats[i] - px;
        if (d > -10 && d < 10) return d >= 0 ? 1 << 4 : 1 << 6;
    }
    return 0;
}

int main(int argc, char **argv) {
    int frames = argc > 1 ? atoi(argv[1]) : 600;
    c8_init(&dodge, dodge_rom, dodge_rom_len, 1);
    c8_init(&bounce, bounce_rom, bounce_rom_len, 99);
    uint8_t out[H][2 * W];
    for (int f = 0; f < frames; f++) {
        bounce.keys = 0;
        dodge.keys = autopilot();
        bounce_frame(&bounce);
        dodge_frame(&dodge);
        c8_tick(&bounce);
        c8_tick(&dodge);
        for (int y = 0; y < H; y++) {
            memcpy(out[y], shown_dodge + y * W, W);
            memcpy(out[y] + W, shown_bounce + y * W, W);
        }
        fwrite(out, sizeof out, 1, stdout);
    }
    fprintf(stderr, "dodge score V3=%d, bounce speed V5=%d, bounces V4=%d\n",
            dodge.V[3], bounce.V[BALL_SPEED], bounce.V[4]);
    return 0;
}
