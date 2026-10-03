/* blockworld: ClassiCube's own block physics (BlockPhysics.c, Lighting.c, World.c, Block.c,
   Generator.c ... compiled unmodified) driven headless through ClassiCube's singleplayer entry
   points: Game_ChangeBlock -> Physics_OnBlockChanged for edits, Physics_Tick at 20 Hz. */
#ifndef BLOCKWORLD_H
#define BLOCKWORLD_H
#include <stdio.h>

/* classic block ids (ClassiCube BlockID.h) */
enum { BW_AIR = 0, BW_STONE = 1, BW_GRASS = 2, BW_DIRT = 3, BW_COBBLE = 4, BW_WOOD = 5, BW_SAPLING = 6,
       BW_BEDROCK = 7, BW_WATER = 8, BW_STILL_WATER = 9, BW_LAVA = 10, BW_STILL_LAVA = 11, BW_SAND = 12,
       BW_GRAVEL = 13, BW_LOG = 17, BW_LEAVES = 18, BW_SPONGE = 19, BW_GLASS = 20, BW_BRICK = 45,
       BW_TNT = 46, BW_OBSIDIAN = 49 };

typedef void (*bw_change_fn)(int x, int y, int z, int old, int now, void *ud);

void bw_init(int w, int h, int l, const unsigned char *blocks, unsigned seed);
void bw_set_observer(bw_change_fn fn, void *ud);   /* every block change, from any source */
int  bw_get(int x, int y, int z);                  /* BW_AIR outside the world */
void bw_change(int x, int y, int z, int block);    /* a "player" edit: Game_ChangeBlock */
void bw_tick(void);                                /* one ClassiCube physics tick */
unsigned long long bw_hash(void);
int  bw_dims(int *w, int *h, int *l);
/* block properties straight from ClassiCube's tables */
int  bw_collides(int block);                       /* COLLIDE_SOLID */
int  bw_resists_blast(int block);                  /* ClassiCube's BlocksTNT() rule */
/* record every input + per-tick hash, so bw_replay can re-run the world on its own */
void bw_record(FILE *f);
#endif
