#include "blockworld.h"
#include <string.h>
#include <stdlib.h>
#include "Core.h"
#include "World.h"
#include "Block.h"
#include "BlockPhysics.h"
#include "Lighting.h"
#include "Game.h"
#include "Audio.h"

extern unsigned long long bw_clock_seed;
extern struct IGameComponent Blocks_Component, Lighting_Component;
static bw_change_fn observer;
static void *observer_ud;
static FILE *rec;
static int ticks;

/* Game.c's Game_UpdateBlock without the renderer/weather calls */
void Game_UpdateBlock(int x, int y, int z, BlockID block) {
	BlockID old = World_GetBlock(x, y, z);
	World_SetBlock(x, y, z, block);
	Lighting.OnBlockChanged(x, y, z, old, block);
	if (observer) observer(x, y, z, old, block, observer_ud);
}

/* Game.c's Game_ChangeBlock with the singleplayer connection's SendBlock (Server.c) */
void Game_ChangeBlock(int x, int y, int z, BlockID block) {
	BlockID old = World_GetBlock(x, y, z);
	Game_UpdateBlock(x, y, z, block);
	Physics_OnBlockChanged(x, y, z, old, block);
}

void bw_init(int w, int h, int l, const unsigned char *blocks, unsigned seed) {
	BlockRaw *mem = (BlockRaw *)malloc((size_t)w * h * l);
	memcpy(mem, blocks, (size_t)w * h * l);
	bw_clock_seed = seed;
	GameVersion_Load();             /* Game.c does this before initialising components */
	Blocks_Component.Init();
	Lighting_Component.Init();
	Env_Reset();
	Env.EdgeBlock = BLOCK_AIR;      /* no ocean around the map edge */
	Physics_Init();
	World_SetNewMap(mem, w, h, l);  /* raises MapLoaded -> Physics_OnNewMapLoaded */
	Lighting_Component.OnNewMapLoaded();
	ticks = 0;
	if (rec) {
		fprintf(rec, "INIT %d %d %d %u\n", w, h, l, seed);
		fwrite(blocks, 1, (size_t)w * h * l, rec);
		fprintf(rec, "\n");
	}
}

void bw_set_observer(bw_change_fn fn, void *ud) { observer = fn; observer_ud = ud; }
void bw_record(FILE *f) { rec = f; }

int bw_get(int x, int y, int z) {
	if (!World_Contains(x, y, z)) return BLOCK_AIR;
	return World_GetBlock(x, y, z);
}

void bw_change(int x, int y, int z, int block) {
	if (!World_Contains(x, y, z)) return;
	if (rec) fprintf(rec, "C %d %d %d %d\n", x, y, z, block);
	Game_ChangeBlock(x, y, z, (BlockID)block);
}

unsigned long long bw_hash(void) {
	unsigned long long h = 1469598103934665603ULL;
	int i;
	for (i = 0; i < World.Volume; i++) { h ^= World.Blocks[i]; h *= 1099511628211ULL; }
	return h;
}

void bw_tick(void) {
	Physics_Tick();
	ticks++;
	if (rec) fprintf(rec, "T %d %016llx\n", ticks, bw_hash());
}

int bw_dims(int *w, int *h, int *l) { *w = World.Width; *h = World.Height; *l = World.Length; return World.Volume; }
int bw_collides(int b) { return Blocks.Collide[b] == COLLIDE_SOLID; }
int bw_resists_blast(int b) {
	return (b >= BLOCK_WATER && b <= BLOCK_STILL_LAVA) ||
		(Blocks.ExtendedCollide[b] == COLLIDE_SOLID && (Blocks.DigSounds[b] == SOUND_METAL || Blocks.DigSounds[b] == SOUND_STONE));
}
