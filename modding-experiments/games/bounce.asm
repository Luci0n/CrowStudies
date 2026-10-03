; BOUNCE - a ball bounces around the screen and counts wall hits.
start:
  LD V0, 10          ; ball x
  LD V1, 5           ; ball y
  LD V2, 1           ; dx
  LD V3, 1           ; dy
  LD V4, 0           ; bounce counter
  LD V5, 1           ; steps per frame
loop:
  CLS
  LD I, ball
  DRW V0, V1, 2
  CALL draw_count
  LD V6, 1
  LD DT, V6
wait:
  LD V6, DT
  SE V6, 0
  JP wait
  LD V7, V5
step:
  ADD V0, V2
  ADD V1, V3
  SE V0, 0
  JP chkx2
  JP flipx
chkx2:
  SE V0, 62
  JP chky
flipx:
  LD V8, 0
  SUB V8, V2
  LD V2, V8
  ADD V4, 1
chky:
  SE V1, 0
  JP chky2
  JP flipy
chky2:
  SE V1, 30
  JP stepdone
flipy:
  LD V8, 0
  SUB V8, V3
  LD V3, V8
  ADD V4, 1
stepdone:
  ADD V7, -1
  SE V7, 0
  JP step
  JP loop

draw_count:
  LD I, save
  LD [I], V4
  LD I, bcd
  LD B, V4
  LD V2, [I]
  LD V8, 54
  LD V9, 0
  LD F, V1
  DRW V8, V9, 5
  ADD V8, 5
  LD F, V2
  DRW V8, V9, 5
  LD I, save
  LD V4, [I]
  RET

ball:
  DB 0xC0, 0xC0
save:
  DB 0, 0, 0, 0, 0
bcd:
  DB 0, 0, 0
