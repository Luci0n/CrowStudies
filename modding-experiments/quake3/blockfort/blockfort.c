/* BLOCKFORT: ClassiCube's block world running inside OpenArena's (recompiled) game logic.

   Linked into the AOT build of qagame.qvm. qvmrecomp.py --hook routes two QVM functions found by
   qvm_re.py through this file:
     G_RunFrame      -> bf_runframe : run the frame, then one ClassiCube physics tick, then sync
     G_RadiusDamage  -> bf_radius   : every Quake explosion also hits the block world
   and it calls the game's own recompiled G_Spawn / G_FreeEntity / G_Damage / G_RadiusDamage, so
   kills, scores and obituaries go through OpenArena's normal code.

   Mechanics (both directions):
     MC -> Q3  solid blocks are solid entities (one per vertical run): they stop players and shots
     Q3 -> MC  explosions break blocks in range unless ClassiCube's BlocksTNT rule says they resist
     Q3 -> MC -> Q3  TNT caught in a blast detonates via ClassiCube's own TNT handler, and the
               detonation is a Quake explosion credited to whoever set it off (so TNT chains)
     MC -> Q3  sand/gravel that falls onto a player crushes them; lava burns
   BLOCKFORT_OFF=1 makes both hooks pure pass-throughs (used to prove the hook layer is invisible). */
#include "aot.h"
#include "blockworld.h"
#include "re_symbols.h"
#include "q3offsets.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

/* the RE (trap_LocateGameData's size argument) and the GPL headers must agree on gentity_t */
_Static_assert(RE_SIZEOF_GENTITY == SIZEOF_GENTITY, "gentity_t size mismatch between RE and headers");

#define CELL 32.0f                 /* Quake units per block (a player is 30x30x56) */
#define WX 15
#define WY 10
#define WZ 15
#define MAX_RUNS 4

static int off = -1, built, levelTime, radius_depth;
static float base[3];              /* Quake position of block (0,0,0)'s corner */
static int colEnt[WX][WZ][MAX_RUNS];
static unsigned char dirty[WX][WZ];
static FILE *evlog;
static int classname_ptr;          /* a literal string already in the QVM */

/* --- events gathered from ClassiCube's change callback --- */
#define MAXQ 256
static struct { int x, y, z; } landed[MAXQ];
static int nlanded;

static void ev(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
#include <stdarg.h>
static void ev(const char *fmt, ...) {
	va_list a;
	if (!evlog) return;
	fprintf(evlog, "%d ", levelTime);
	va_start(a, fmt); vfprintf(evlog, fmt, a); va_end(a);
	fputc('\n', evlog);
}

static void on_change(int x, int y, int z, int old, int now, void *ud) {
	(void)ud;
	if (x >= 0 && x < WX && z >= 0 && z < WZ) dirty[x][z] = 1;
	if (built && (now == BW_SAND || now == BW_GRAVEL) && !bw_collides(old) && nlanded < MAXQ) {
		landed[nlanded].x = x; landed[nlanded].y = y; landed[nlanded].z = z; nlanded++;
	}
}

/* --- calling into the VM from native code --- */
static float LDF(int a) { return F(LD4(a)); }
static void STF(int a, float f) { ST4(a, I(f)); }
static int ent_addr(int n) { return G_ENTITIES + n * SIZEOF_GENTITY; }

static int vm_call(int ps, int (*f)(int), int nargs, const int *args) {
	int sps = ps - 1024, i;           /* frames below the caller's stack pointer are free */
	for (i = 0; i < nargs; i++) RAW4(sps + 8 + 4 * i) = args[i];
	RAW4(sps) = -1;
	return f(sps);
}
static void link_entity(int ps, int ent) {
	int sps = ps - 1024;
	RAW4(sps + 8) = ent;
	aot_syscall(sps, SYS_G_LINKENTITY);
}

/* --- keep Quake entities in step with the block world, one entity per solid run --- */
/* bedrock marks cells inside the Quake map's own walls: solid for ClassiCube, but the BSP already
   blocks Quake there, so it gets no entity */
static int needs_entity(int b) { return bw_collides(b) && b != BW_BEDROCK; }

static void sync_column(int ps, int x, int z) {
	int k, y, n = 0;
	for (k = 0; k < MAX_RUNS; k++) {
		if (colEnt[x][z][k]) { int a = colEnt[x][z][k]; vm_call(ps, F_G_FreeEntity, 1, &a); colEnt[x][z][k] = 0; }
	}
	for (y = 0; y < WY && n < MAX_RUNS; ) {
		int y0, e;
		if (!needs_entity(bw_get(x, y, z))) { y++; continue; }
		y0 = y;
		while (y < WY && needs_entity(bw_get(x, y, z))) y++;
		e = vm_call(ps, F_G_Spawn, 0, NULL);
		if (!e) break;
		RAW4(e + OFS_CLASSNAME) = classname_ptr;
		RAW4(e + OFS_S_ETYPE) = 0;   /* ET_GENERAL */
		STF(e + OFS_R_MINS + 0, 0); STF(e + OFS_R_MINS + 4, 0); STF(e + OFS_R_MINS + 8, 0);
		STF(e + OFS_R_MAXS + 0, CELL); STF(e + OFS_R_MAXS + 4, CELL); STF(e + OFS_R_MAXS + 8, CELL * (y - y0));
		/* ClassiCube (x, y-up, z) -> Quake (x, y, z-up) */
		STF(e + OFS_R_CURRENTORIGIN + 0, base[0] + x * CELL);
		STF(e + OFS_R_CURRENTORIGIN + 4, base[1] + z * CELL);
		STF(e + OFS_R_CURRENTORIGIN + 8, base[2] + y0 * CELL);
		memcpy(img + e + OFS_S_POS_TRBASE, img + e + OFS_R_CURRENTORIGIN, 12);
		RAW4(e + OFS_R_CONTENTS) = CONTENTS_SOLID_V;
		link_entity(ps, e);
		colEnt[x][z][n++] = e;
	}
	dirty[x][z] = 0;
}

static void sync_all(int ps) {
	int x, z;
	for (x = 0; x < WX; x++) for (z = 0; z < WZ; z++) if (dirty[x][z]) sync_column(ps, x, z);
}

/* living players */
static int player(int i) {
	int e = ent_addr(i);
	return RAW4(e + OFS_INUSE) && RAW4(e + OFS_CLIENT) && RAW4(e + OFS_HEALTH) > 0 ? e : 0;
}
static int overlaps(int e, int x, int y, int z) {
	float lo[3] = { base[0] + x * CELL, base[1] + z * CELL, base[2] + y * CELL };
	int k;
	for (k = 0; k < 3; k++) {
		float o = LDF(e + OFS_R_CURRENTORIGIN + 4 * k);
		if (o + LDF(e + OFS_R_MAXS + 4 * k) <= lo[k] || o + LDF(e + OFS_R_MINS + 4 * k) >= lo[k] + CELL) return 0;
	}
	return 1;
}
static void damage(int ps, int targ, int attacker, int dmg, int mod) {
	int a[8] = { targ, attacker, attacker, 0, 0, dmg, 0, mod };
	vm_call(ps, F_G_Damage, 8, a);
}

/* --- the fort, around the first rocket launcher on the map --- */
static void build_fort(int ps) {
	static unsigned char b[WY][WZ][WX];
	int i, x, y, z, item = 0;
	for (i = MAX_CLIENTS_V; i < 1022 && !item; i++) {
		int e = ent_addr(i), cn = RAW4(e + OFS_CLASSNAME);
		if (RAW4(e + OFS_INUSE) && cn && !strcmp((char *)img + (cn & mask), "weapon_rocketlauncher")) item = e;
	}
	if (!item) { ev("no rocket launcher on this map; no fort"); built = -1; return; }
	base[0] = LDF(item + OFS_R_CURRENTORIGIN + 0) - (WX / 2) * CELL - CELL / 2;
	base[1] = LDF(item + OFS_R_CURRENTORIGIN + 4) - (WZ / 2) * CELL - CELL / 2;
	base[2] = LDF(item + OFS_R_CURRENTORIGIN + 8) - 15.0f;   /* items rest with mins.z = -15 on the floor */
	memset(b, 0, sizeof b);
	for (x = 3; x <= 11; x++) for (z = 3; z <= 11; z++) {
		int edge = x == 3 || x == 11 || z == 3 || z == 11, door = (x == 7 || z == 7);
		for (y = 0; y <= 2; y++) if (edge && !(door && y <= 1)) b[y][z][x] = BW_WOOD;   /* plank walls, 4 doors */
		b[3][z][x] = BW_WOOD;                                                               /* plank ceiling */
		if (x > 3 && x < 11 && z > 3 && z < 11) b[4][z][x] = BW_SAND;                       /* sandbags on it */
	}
	for (x = 3; x <= 7; x++) for (z = 3; z <= 7; z++) {                                  /* water tank (glass) */
		b[5][z][x] = (x == 3 || x == 7 || z == 3 || z == 7) ? BW_GLASS : BW_WATER;
		b[5][z][x + 4] = (x == 3 || x == 7 || z == 3 || z == 7) ? BW_GLASS : BW_LAVA;    /* lava tank beside it */
	}
	b[1][4][4] = b[1][4][10] = b[1][10][4] = b[1][10][10] = BW_TNT;                        /* TNT in the corners */
	b[0][4][4] = b[0][4][10] = b[0][10][4] = b[0][10][10] = BW_WOOD;
	for (x = 0; x < WX; x += 14) for (z = 0; z < WZ; z += 14)                              /* gravel heaps outside */
		for (y = 0; y < 3; y++) b[y][z ? z - 1 : 1][x ? x - 1 : 1] = BW_GRAVEL;
	/* make the two worlds agree on geometry: a cell whose centre is inside the map is bedrock */
	{
		int sps = ps - 1024, vec = ps - 256;
		for (y = 0; y < WY; y++) for (z = 0; z < WZ; z++) for (x = 0; x < WX; x++) {
			STF(vec + 0, base[0] + (x + 0.5f) * CELL);
			STF(vec + 4, base[1] + (z + 0.5f) * CELL);
			STF(vec + 8, base[2] + (y + 0.5f) * CELL);
			RAW4(sps + 8) = vec; RAW4(sps + 12) = -1;
			if (aot_syscall(sps, SYS_G_POINT_CONTENTS) & CONTENTS_SOLID_V) b[y][z][x] = BW_BEDROCK;
		}
	}
	/* never entomb anyone: leave cells that already hold a player empty */
	for (i = 0; i < MAX_CLIENTS_V; i++) {
		int e = player(i);
		if (e) for (y = 0; y < WY; y++) for (z = 0; z < WZ; z++) for (x = 0; x < WX; x++)
			if (b[y][z][x] && overlaps(e, x, y, z)) b[y][z][x] = 0;
	}
	bw_set_observer(on_change, NULL);
	if (getenv("BLOCKFORT_REC")) bw_record(fopen(getenv("BLOCKFORT_REC"), "wb"));
	bw_init(WX, WY, WZ, &b[0][0][0], 1234);
	for (x = 0; x < WX; x++) for (z = 0; z < WZ; z++) dirty[x][z] = 1;
	built = 1;
	sync_all(ps);
	{
		int rock = 0;
		for (y = 0; y < WY; y++) for (z = 0; z < WZ; z++) for (x = 0; x < WX; x++) rock += b[y][z][x] == BW_BEDROCK;
		ev("fort built at %.0f %.0f %.0f (%d cells inside map geometry)", base[0], base[1], base[2], rock);
	}
}

/* positions every 0.5 s, for the GIF and the A/B stats */
static void log_positions(void) {
	int i;
	if (!evlog || levelTime % 500) return;
	fprintf(evlog, "%d pos", levelTime);
	for (i = 0; i < MAX_CLIENTS_V; i++) {
		int e = player(i);
		if (e) fprintf(evlog, " %d:%.0f,%.0f,%.0f", i, LDF(e + OFS_R_CURRENTORIGIN), LDF(e + OFS_R_CURRENTORIGIN + 4), LDF(e + OFS_R_CURRENTORIGIN + 8));
	}
	fputc('\n', evlog);
}

/* --- hooks --- */
int bf_runframe(int ps, int (*orig)(int)) {
	int r, i, k, x, y, z;
	static int lastLava;
	if (off < 0) {
		off = getenv("BLOCKFORT_OFF") != NULL;
		if (getenv("BLOCKFORT_LOG")) evlog = fopen(getenv("BLOCKFORT_LOG"), "w");
		classname_ptr = LIT_FUNC_STATIC;
	}
	r = orig(ps);
	levelTime = LD4(ps + 8);
	if (off) { log_positions(); return r; }   /* read-only: the A/B baseline */
	if (!built && levelTime >= 3000) build_fort(ps);
	if (built != 1) return r;

	bw_tick();                               /* ClassiCube runs at 20 Hz, like sv_fps 20 */
	for (k = 0; k < nlanded; k++)            /* falling sand/gravel lands on someone */
		for (i = 0; i < MAX_CLIENTS_V; i++) {
			int e = player(i);
			if (e && overlaps(e, landed[k].x, landed[k].y, landed[k].z)) {
				ev("crush client %d at %d,%d,%d", i, landed[k].x, landed[k].y, landed[k].z);
				damage(ps, e, 0, 60, MOD_CRUSH_V);
			}
		}
	nlanded = 0;
	if (levelTime - lastLava >= 500) {       /* lava contact, twice a second */
		lastLava = levelTime;
		for (i = 0; i < MAX_CLIENTS_V; i++) {
			int e = player(i), hit = 0;
			if (!e) continue;
			for (y = 0; y < WY && !hit; y++) for (z = 0; z < WZ && !hit; z++) for (x = 0; x < WX && !hit; x++) {
				int b = bw_get(x, y, z);
				if ((b == BW_LAVA || b == BW_STILL_LAVA) && overlaps(e, x, y, z)) hit = 1;
			}
			if (hit) { ev("lava client %d", i); damage(ps, e, 0, 15, MOD_LAVA_V); }
		}
	}
	sync_all(ps);
	log_positions();
	return r;
}

/* G_RadiusDamage(vec3_t origin, gentity_t *attacker, float damage, float radius, gentity_t *ignore, int mod) */
int bf_radius(int ps, int (*orig)(int)) {
	int r = orig(ps), attacker, x, y, z, broken = 0, k, ntnt = 0;
	float o[3], rad, reach;
	struct { int x, y, z; } tnt[64];
	if (off || built != 1) return r;
	for (k = 0; k < 3; k++) o[k] = LDF(LD4(ps + 8) + 4 * k);
	attacker = LD4(ps + 12);
	rad = LDF(ps + 20);
	reach = rad * 0.5f;
	for (y = 0; y < WY; y++) for (z = 0; z < WZ; z++) for (x = 0; x < WX; x++) {
		float c[3] = { base[0] + (x + 0.5f) * CELL, base[1] + (z + 0.5f) * CELL, base[2] + (y + 0.5f) * CELL };
		float d = sqrtf((c[0] - o[0]) * (c[0] - o[0]) + (c[1] - o[1]) * (c[1] - o[1]) + (c[2] - o[2]) * (c[2] - o[2]));
		int b = bw_get(x, y, z);
		if (d > reach || b == BW_AIR || bw_resists_blast(b)) continue;
		if (b == BW_TNT) { if (ntnt < 64) { tnt[ntnt].x = x; tnt[ntnt].y = y; tnt[ntnt].z = z; ntnt++; } continue; }
		bw_change(x, y, z, BW_AIR);
		broken++;
	}
	if (broken) ev("blast at %.0f %.0f %.0f mod %d broke %d blocks", o[0], o[1], o[2], LD4(ps + 28), broken);
	/* TNT: re-placing it runs ClassiCube's OnPlace[TNT] (its detonation), then a Quake blast */
	for (k = 0; k < ntnt && radius_depth < 8; k++) {
		int args[6], sps = ps - 2048, vec = ps - 256;
		if (bw_get(tnt[k].x, tnt[k].y, tnt[k].z) != BW_TNT) continue;
		bw_change(tnt[k].x, tnt[k].y, tnt[k].z, BW_TNT);
		ev("tnt at %d,%d,%d set off by entity %d", tnt[k].x, tnt[k].y, tnt[k].z,
		   attacker ? (attacker - G_ENTITIES) / SIZEOF_GENTITY : -1);
		STF(vec + 0, base[0] + (tnt[k].x + 0.5f) * CELL);
		STF(vec + 4, base[1] + (tnt[k].z + 0.5f) * CELL);
		STF(vec + 8, base[2] + (tnt[k].y + 0.5f) * CELL);
		args[0] = vec; args[1] = attacker; args[2] = I(120.0f); args[3] = I(200.0f); args[4] = 0;
		args[5] = MOD_GRENADE_SPLASH_V;
		for (x = 0; x < 6; x++) RAW4(sps + 8 + 4 * x) = args[x];
		RAW4(sps) = -1;
		radius_depth++;
		bf_radius(sps, F_G_RadiusDamage);   /* through the hook, so TNT can set off TNT */
		radius_depth--;
	}
	return r;
}
