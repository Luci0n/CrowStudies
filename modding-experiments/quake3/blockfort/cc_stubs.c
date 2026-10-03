/* Platform layer for ClassiCube's game modules inside the Quake 3 server.
   Memory maps to libc. Time is replaced by a seed (Random_SeedFromCurrentTime is the only user
   on our paths), so physics is deterministic. Anything else aborts loudly if ever reached. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

unsigned long long bw_clock_seed;     /* set by blockworld.c */
unsigned long long Stopwatch_Measure(void) { return bw_clock_seed; }

void *Mem_TryAlloc(unsigned n, unsigned s) { return malloc((size_t)n * s); }
void *Mem_TryAllocCleared(unsigned n, unsigned s) { return calloc(n, s); }
void *Mem_Alloc(unsigned n, unsigned s, const char *p) { void *m = calloc(n, s); if (!m) { fprintf(stderr, "OOM %s\n", p); abort(); } return m; }
void *Mem_Realloc(void *m, unsigned n, unsigned s, const char *p) { m = realloc(m, (size_t)n * s); if (!m) abort(); return m; }
void  Mem_Free(void *m) { free(m); }
void *Mem_Set(void *d, unsigned char v, unsigned n) { return memset(d, v, n); }
void *Mem_Copy(void *d, const void *s, unsigned n) { return memcpy(d, s, n); }
int   Mem_Equal(const void *a, const void *b, unsigned n) { return memcmp(a, b, n) == 0; }

/* Options: always the built-in default (ClassiCube's defaults: physics on, classic lighting) */
int Options_GetBool(const char *key, int def) { (void)key; return def; }
int Options_GetInt(const char *key, int lo, int hi, int def) { (void)key; (void)lo; (void)hi; return def; }
int Options_GetEnum(const char *key, int def, const char *const *names, int n) { (void)key; (void)names; (void)n; return def; }

/* No renderer, chat or UI in a dedicated server */
void Chat_AddRaw(const char *s) { (void)s; }
void MapRenderer_Refresh(void) { }
void MapRenderer_RefreshChunk(int cx, int cy, int cz) { (void)cx; (void)cy; (void)cz; }
void Builder_ApplyActive(void) { }
void FancyLighting_OnInit(void) { }

#define UNREACHABLE(name) void name(void) { fprintf(stderr, "ClassiCube shim: unexpected call to %s\n", #name); abort(); }
UNREACHABLE(AABB_Intersects) UNREACHABLE(AABB_Make) UNREACHABLE(Directory_Create2)
UNREACHABLE(FancyLighting_SetActive) UNREACHABLE(GeneratingScreen_Show) UNREACHABLE(Inventory_AddDefault)
UNREACHABLE(Inventory_Remove) UNREACHABLE(Logger_IOWarn2) UNREACHABLE(Logger_WarnFunc)
UNREACHABLE(Platform_EncodePath) UNREACHABLE(Process_Abort2) UNREACHABLE(Stream_CreatePath)
UNREACHABLE(Stream_OpenPath) UNREACHABLE(Stream_ReadLine) UNREACHABLE(Stream_ReadonlyBuffered)
UNREACHABLE(Stream_WriteLine) UNREACHABLE(Thread_Detach) UNREACHABLE(Thread_Run) UNREACHABLE(Window_ShowDialog)
int ReturnCode_DirectoryExists, ReturnCode_FileNotFound;
