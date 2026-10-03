; DODGE - move with keys 4/6, avoid the falling rock.
; Every rock you dodge adds a point; getting hit resets the score.
start:
  LD V0, 28          ; player x
  LD V3, 0           ; score
  LD V5, 1           ; rock fall speed (pixels per frame)
new_rock:
  RND V1, 0x38       ; rock x
  LD V2, 0           ; rock y
loop:
  CLS
  LD I, player
  LD V4, 26
  DRW V0, V4, 4
  LD I, rock
  DRW V1, V2, 4
  SE VF, 0
  JP hit
  CALL draw_score
  LD V6, 1           ; wait one tick
  LD DT, V6
wait:
  LD V6, DT
  SE V6, 0
  JP wait
  LD V6, 4
  SKNP V6
  ADD V0, -2
  LD V6, 6
  SKNP V6
  ADD V0, 2
  LD V6, 0x3F
  AND V0, V6
  ADD V2, V5         ; rock falls
  LD V6, 30
  SUB V6, V2         ; VF = 1 while rock is still on screen
  SE VF, 0
  JP loop
  ADD V3, 1          ; dodged
  JP new_rock
hit:
  LD V3, 0
  JP new_rock

draw_score:
  LD I, save
  LD [I], V3
  LD I, bcd
  LD B, V3
  LD V2, [I]
  LD V8, 54
  LD V9, 0
  LD F, V1
  DRW V8, V9, 5
  ADD V8, 5
  LD F, V2
  DRW V8, V9, 5
  LD I, save
  LD V3, [I]
  RET

player:
  DB 0x18, 0x3C, 0x7E, 0xFF
rock:
  DB 0x3C, 0x7E, 0x7E, 0x3C
save:
  DB 0, 0, 0, 0
bcd:
  DB 0, 0, 0
