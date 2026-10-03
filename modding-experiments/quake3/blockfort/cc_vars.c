/* ClassiCube globals that the linked modules reference but this headless build has no use for.
   Defined with ClassiCube's own types so their layout is right; all zero. */
#include "Core.h"
#include "TexturePack.h"
#include "Entity.h"
#include "Event.h"
#include "Game.h"
#include "Picking.h"

struct _Atlas2DData Atlas2D;
struct _EntitiesData Entities;
struct RayTracer Game_SelectedPos;
cc_string Game_Username;
struct GameVersion Game_Version;
/* Classic mode off: ClassiCube only enables TNT and cobblestone slabs outside classic mode */
cc_bool Game_ClassicMode = false;
