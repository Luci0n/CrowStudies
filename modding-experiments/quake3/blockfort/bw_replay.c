/* bw_replay: re-run a recorded blockworld session standalone (no Quake 3) and check the world
   hash after every physics tick against what the mashup recorded.
   usage: bw_replay session.rec [snapshots.bin N]  (also dump the whole world every N ticks) */
#include "blockworld.h"
#include <stdlib.h>
#include <string.h>

int main(int argc, char **argv) {
	FILE *f = fopen(argv[1], "rb"), *snap = argc > 3 ? fopen(argv[2], "wb") : NULL;
	int every = argc > 3 ? atoi(argv[3]) : 0;
	char line[256];
	int w, h, l, x, y, z, b, t, ok = 0, bad = 0, firstbad = -1;
	unsigned seed;
	unsigned long long want;
	unsigned char *blocks;
	if (!f || !fgets(line, sizeof line, f) || sscanf(line, "INIT %d %d %d %u", &w, &h, &l, &seed) != 4) return 2;
	blocks = malloc((size_t)w * h * l);
	if (fread(blocks, 1, (size_t)w * h * l, f) != (size_t)w * h * l) return 2;
	fgetc(f);
	bw_init(w, h, l, blocks, seed);
	while (fgets(line, sizeof line, f)) {
		if (sscanf(line, "C %d %d %d %d", &x, &y, &z, &b) == 4) bw_change(x, y, z, b);
		else if (sscanf(line, "T %d %llx", &t, &want) == 2) {
			bw_tick();
			if (bw_hash() == want) ok++; else { if (firstbad < 0) firstbad = t; bad++; }
			if (snap && t % every == 0) {
				int xx, yy, zz;
				fwrite(&t, 4, 1, snap);
				for (yy = 0; yy < h; yy++) for (zz = 0; zz < l; zz++) for (xx = 0; xx < w; xx++) fputc(bw_get(xx, yy, zz), snap);
			}
		}
	}
	printf("replayed %d ticks: %d match, %d differ (first at tick %d)\n", ok + bad, ok, bad, firstbad);
	return bad != 0;
}
