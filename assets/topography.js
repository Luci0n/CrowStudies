(() => {
  'use strict';
  if (window.CrowTopography) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const primary = document.createElement('canvas');
  const outgoing = document.createElement('canvas');
  primary.className = 'crow-topography';
  outgoing.className = 'crow-topography crow-topography-outgoing';
  primary.setAttribute('aria-hidden', 'true');
  outgoing.setAttribute('aria-hidden', 'true');
  document.body.prepend(outgoing);
  document.body.prepend(primary);

  const display = primary.getContext('2d');
  const outgoingDisplay = outgoing.getContext('2d');
  const buffer = document.createElement('canvas');
  const context = buffer.getContext('2d');
  const textureTile = document.createElement('canvas');
  textureTile.width = textureTile.height = 128;
  const textureContext = textureTile.getContext('2d');
  const texturePixels = textureContext.createImageData(128, 128);
  let textureState = 0x61c88647;
  for (let index = 0; index < texturePixels.data.length; index += 4) {
    textureState = Math.imul(textureState ^ textureState >>> 15, 1 | textureState);
    const noise = (textureState >>> 24) - 128;
    const shade = noise > 0 ? 212 : 22;
    texturePixels.data[index] = shade;
    texturePixels.data[index + 1] = shade;
    texturePixels.data[index + 2] = shade + (noise > 0 ? 8 : 0);
    texturePixels.data[index + 3] = 18 + Math.abs(noise >> 1);
  }
  textureContext.putImageData(texturePixels, 0, 0);
  const texturePattern = context.createPattern(textureTile, 'repeat');
  let width = 0, height = 0, dpr = 1, lastFrame = -Infinity;
  let hasPainted = false, revealOutgoing = false;

  const randomSeed = () => {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0];
  };
  const seeded = seed => () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
  const baseForms = [
    [.15,.35,.30,.26,1.06,-.18,.055,0],[.42,.48,.29,.23,.62,.34,.045,1.1],
    [.61,.61,.37,.25,.68,-.10,.050,2.3],[.76,.18,.28,.22,.67,.54,.040,3.5],
    [.81,.81,.29,.25,.79,-.24,.052,4.6],[.31,.84,.27,.20,.46,.38,.046,5.8],
    [.43,.13,.22,.18,.36,-.52,.038,2.8],[.57,.32,.18,.15,-.27,.20,.034,4.1],
    [.19,.70,.20,.17,-.19,-.36,.030,1.9]
  ];
  const makeLandscape = seed => {
    const random = seeded(seed);
    return baseForms.map(([cx,cy,rx,ry,amp,angle,wobble,phase]) => [
      cx + (random() - .5) * .23, cy + (random() - .5) * .20,
      rx * (.68 + random() * .70), ry * (.68 + random() * .70),
      amp * (.58 + random() * .92), angle + (random() - .5) * 1.05,
      wobble, phase + (random() - .5) * 2.2
    ]);
  };
  let landscape = makeLandscape(randomSeed());

  /* The terrain is a slow drift over a smooth field, but every frame used to
     rebuild the whole thing from scratch: a height sample per grid point per
     hill, a theme read that forced a style recalculation, and thirty-six fresh
     gradients. That came to about twenty-six milliseconds a frame, so it ran at
     roughly six frames a second and stuttered.

     What does not change between frames is worked out once: where each grid
     point sits in the warped space, the fixed part of its height, and the
     gradients. What is left per frame is one exponential per point per hill,
     over a field sampled every other point and smoothly filled back in, which
     the shape of the terrain is far too broad to notice. */
  let cell = 13, columns = 0, rows = 0;
  const COARSE = 2;
  let fieldColumns = 0, fieldRows = 0;
  let warpX = null, warpY = null, restingHeight = null, fieldHeight = null, values = null;
  let palette = null, glowFill = null, majorStroke = null, minorStroke = null;

  function readPalette() {
    const style = getComputedStyle(document.documentElement);
    const pick = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    palette = {
      glowA: pick('--terrain-glow-a', '76,68,168'),
      glowB: pick('--terrain-glow-b', '29,40,95'),
      majorA: pick('--terrain-major-a', '99,142,255'),
      majorB: pick('--terrain-major-b', '147,112,255'),
      majorC: pick('--terrain-major-c', '86,188,238'),
      minorA: pick('--terrain-minor-a', '104,143,224'),
      minorB: pick('--terrain-minor-b', '129,111,218'),
      minorC: pick('--terrain-minor-c', '81,158,212')
    };
    glowFill = null;
  }

  function buildPaints() {
    if (!palette) readPalette();
    glowFill = context.createRadialGradient(width * .13, height * .03, 0, width * .13, height * .03, Math.max(width, height) * .82);
    glowFill.addColorStop(0, 'rgba(' + palette.glowA + ',.22)');
    glowFill.addColorStop(.54, 'rgba(' + palette.glowB + ',.09)');
    glowFill.addColorStop(1, 'rgba(9,11,18,0)');
    majorStroke = context.createLinearGradient(0, 0, width, height);
    majorStroke.addColorStop(0, 'rgba(' + palette.majorA + ',.38)');
    majorStroke.addColorStop(.52, 'rgba(' + palette.majorB + ',.50)');
    majorStroke.addColorStop(1, 'rgba(' + palette.majorC + ',.34)');
    minorStroke = context.createLinearGradient(0, 0, width, height);
    minorStroke.addColorStop(0, 'rgba(' + palette.minorA + ',.14)');
    minorStroke.addColorStop(.55, 'rgba(' + palette.minorB + ',.21)');
    minorStroke.addColorStop(1, 'rgba(' + palette.minorC + ',.13)');
  }

  function buildField() {
    cell = Math.max(11, Math.min(13, Math.round(width / 108)));
    columns = Math.ceil(width / cell) + 1;
    rows = Math.ceil(height / cell) + 1;
    fieldColumns = Math.ceil((columns - 1) / COARSE) + 1;
    fieldRows = Math.ceil((rows - 1) / COARSE) + 1;
    const count = fieldColumns * fieldRows;
    warpX = new Float32Array(count);
    warpY = new Float32Array(count);
    restingHeight = new Float32Array(count);
    fieldHeight = new Float32Array(count);
    values = new Float32Array(columns * rows);
    for (let row = 0; row < fieldRows; row++) {
      for (let column = 0; column < fieldColumns; column++) {
        const u = column * COARSE * cell / width;
        const v = row * COARSE * cell / height;
        const px = u + .052 * Math.sin(v * 7.2) + .026 * Math.sin(u * 5.1 + v * 3.4);
        const py = v + .047 * Math.sin(u * 6.0 - .6) + .022 * Math.cos(v * 6.7 - u * 2.2);
        const at = row * fieldColumns + column;
        warpX[at] = px;
        warpY[at] = py;
        restingHeight[at] = -.23 + .075 * Math.sin(px * 4.1 + py * 1.8) + .045 * Math.cos(py * 5.3 - px * 1.2);
      }
    }
  }

  function raiseHills(time) {
    const count = fieldColumns * fieldRows;
    fieldHeight.set(restingHeight);
    for (let hill = 0; hill < landscape.length; hill++) {
      const form = landscape[hill];
      const phase = form[7];
      const centreX = form[0] + .007 * Math.sin(time * .33 + phase);
      const centreY = form[1] + .006 * Math.cos(time * .29 + phase * .8);
      const spreadX = 1 / (form[2] * form[2]);
      const spreadY = 1 / (form[3] * form[3]);
      const cosine = Math.cos(form[5]), sine = Math.sin(form[5]);
      const amp = form[4] * (1 + form[6] * Math.sin(time * .43 + phase));
      for (let at = 0; at < count; at++) {
        const dx = warpX[at] - centreX, dy = warpY[at] - centreY;
        const along = dx * cosine + dy * sine;
        const across = dy * cosine - dx * sine;
        fieldHeight[at] += amp * Math.exp(-(along * along * spreadX + across * across * spreadY));
      }
    }
  }

  function fillBetween() {
    for (let row = 0; row < rows; row++) {
      const sourceRow = row / COARSE;
      const rowA = Math.min(fieldRows - 1, sourceRow | 0);
      const rowB = Math.min(fieldRows - 1, rowA + 1);
      const downwards = sourceRow - rowA;
      const offsetA = rowA * fieldColumns, offsetB = rowB * fieldColumns;
      const out = row * columns;
      for (let column = 0; column < columns; column++) {
        const sourceColumn = column / COARSE;
        const columnA = Math.min(fieldColumns - 1, sourceColumn | 0);
        const columnB = Math.min(fieldColumns - 1, columnA + 1);
        const across = sourceColumn - columnA;
        const top = fieldHeight[offsetA + columnA] + (fieldHeight[offsetA + columnB] - fieldHeight[offsetA + columnA]) * across;
        const bottom = fieldHeight[offsetB + columnA] + (fieldHeight[offsetB + columnB] - fieldHeight[offsetB + columnA]) * across;
        values[out + column] = top + (bottom - top) * downwards;
      }
    }
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    primary.width = outgoing.width = buffer.width = width * dpr;
    primary.height = outgoing.height = buffer.height = height * dpr;
    primary.style.width = outgoing.style.width = width + 'px';
    primary.style.height = outgoing.style.height = height + 'px';
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildField();
    buildPaints();
    lastFrame = -Infinity;
  }

  const table = {
    1:[[3,0]],2:[[0,1]],3:[[3,1]],4:[[1,2]],5:[[3,0],[1,2]],6:[[0,2]],7:[[3,2]],
    8:[[2,3]],9:[[0,2]],10:[[0,1],[2,3]],11:[[1,2]],12:[[1,3]],13:[[0,1]],14:[[3,0]]
  };

  function draw(now = 0) {
    if (!reduce && now - lastFrame < 32) {
      requestAnimationFrame(draw);
      return;
    }
    lastFrame = now;
    const time = reduce ? 0 : now * .00012;
    if (!values) buildField();
    if (!glowFill) buildPaints();
    context.clearRect(0, 0, width, height);
    context.fillStyle = glowFill;
    context.fillRect(0, 0, width, height);

    raiseHills(time);
    fillBetween();

    const edgePoint = (edge, level, column, row, a, b, c, d) => {
      const points = [[column * cell,row * cell,a],[(column + 1) * cell,row * cell,b],[(column + 1) * cell,(row + 1) * cell,c],[column * cell,(row + 1) * cell,d]];
      const pair = [[0,1],[1,2],[2,3],[3,0]][edge];
      const start = points[pair[0]], end = points[pair[1]];
      const ratio = (level - start[2]) / (end[2] - start[2]);
      return { x: start[0] + (end[0] - start[0]) * ratio, y: start[1] + (end[1] - start[1]) * ratio };
    };

    for (let band = 0; band < 18; band++) {
      const level = -.20 + band * .102;
      context.beginPath();
      for (let row = 0; row < rows - 1; row++) {
        const here = row * columns, below = here + columns;
        for (let column = 0; column < columns - 1; column++) {
          const a = values[here + column], b = values[here + column + 1];
          const c = values[below + column + 1], d = values[below + column];
          const mask = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
          if (mask === 0 || mask === 15) continue;
          const edges = table[mask];
          if (!edges) continue;
          for (let pair = 0; pair < edges.length; pair++) {
            const start = edgePoint(edges[pair][0], level, column, row, a, b, c, d);
            const end = edgePoint(edges[pair][1], level, column, row, a, b, c, d);
            context.moveTo(start.x, start.y);
            context.lineTo(end.x, end.y);
          }
        }
      }
      const major = band % 5 === 0;
      context.strokeStyle = major ? majorStroke : minorStroke;
      context.lineWidth = major ? 1.22 : .72;
      context.stroke();
    }
    if (texturePattern) {
      context.globalAlpha = .10;
      context.fillStyle = texturePattern;
      context.fillRect(0, 0, width, height);
      context.globalAlpha = 1;
    }
    display.setTransform(1, 0, 0, 1, 0, 0);
    display.clearRect(0, 0, primary.width, primary.height);
    display.drawImage(buffer, 0, 0);
    if (!hasPainted) {
      hasPainted = true;
      primary.style.opacity = '.98';
    }
    if (revealOutgoing) {
      revealOutgoing = false;
      requestAnimationFrame(() => { outgoing.style.opacity = '0'; });
    }
    if (!reduce) requestAnimationFrame(draw);
  }

  function changeSeed() {
    outgoing.style.transition = 'none';
    outgoingDisplay.setTransform(1, 0, 0, 1, 0, 0);
    outgoingDisplay.clearRect(0, 0, outgoing.width, outgoing.height);
    outgoingDisplay.drawImage(primary, 0, 0);
    outgoing.style.opacity = '.98';
    void outgoing.offsetWidth;
    outgoing.style.transition = 'opacity 1.15s cubic-bezier(.16,1,.3,1)';
    landscape = makeLandscape(randomSeed());
    revealOutgoing = true;
    lastFrame = -Infinity;
    requestAnimationFrame(draw);
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { resize(); draw(); }, 160);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { lastFrame = -Infinity; requestAnimationFrame(draw); }
  });
  resize();
  draw();
  new MutationObserver(() => { readPalette(); lastFrame = -Infinity; })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
  try {
    window.matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => { readPalette(); lastFrame = -Infinity; });
  } catch (error) {}

  window.CrowTopography = { changeSeed };
})();