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

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    primary.width = outgoing.width = buffer.width = width * dpr;
    primary.height = outgoing.height = buffer.height = height * dpr;
    primary.style.width = outgoing.style.width = width + 'px';
    primary.style.height = outgoing.style.height = height + 'px';
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    lastFrame = -Infinity;
  }

  const table = {
    1:[[3,0]],2:[[0,1]],3:[[3,1]],4:[[1,2]],5:[[3,0],[1,2]],6:[[0,2]],7:[[3,2]],
    8:[[2,3]],9:[[0,2]],10:[[0,1],[2,3]],11:[[1,2]],12:[[1,3]],13:[[0,1]],14:[[3,0]]
  };

  function draw(now = 0) {
    if (!reduce && now - lastFrame < 105) {
      requestAnimationFrame(draw);
      return;
    }
    lastFrame = now;
    const time = reduce ? 0 : now * .00012;
    context.clearRect(0, 0, width, height);
    const glow = context.createRadialGradient(width * .13, height * .03, 0, width * .13, height * .03, Math.max(width, height) * .82);
    glow.addColorStop(0, 'rgba(76,68,168,.22)');
    glow.addColorStop(.54, 'rgba(29,40,95,.09)');
    glow.addColorStop(1, 'rgba(9,11,18,0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);
    const cell = Math.max(11, Math.min(13, Math.round(width / 108)));
    const columns = Math.ceil(width / cell) + 1;
    const rows = Math.ceil(height / cell) + 1;

    const heightAt = (x, y) => {
      const u = x / width, v = y / height;
      const px = u + .052 * Math.sin(v * 7.2) + .026 * Math.sin(u * 5.1 + v * 3.4);
      const py = v + .047 * Math.sin(u * 6.0 - .6) + .022 * Math.cos(v * 6.7 - u * 2.2);
      let level = -.23 + .075 * Math.sin(px * 4.1 + py * 1.8) + .045 * Math.cos(py * 5.3 - px * 1.2);
      landscape.forEach(([cx,cy,rx,ry,amp,angle,wobble,phase]) => {
        const dx = px - (cx + .007 * Math.sin(time * .33 + phase));
        const dy = py - (cy + .006 * Math.cos(time * .29 + phase * .8));
        const cosine = Math.cos(angle), sine = Math.sin(angle);
        const along = dx * cosine + dy * sine;
        const across = -dx * sine + dy * cosine;
        const pulse = 1 + wobble * Math.sin(time * .43 + phase);
        level += amp * pulse * Math.exp(-(along * along / (rx * rx) + across * across / (ry * ry)));
      });
      return level;
    };
    const values = Array.from({ length: rows }, (_, row) =>
      Array.from({ length: columns }, (_, column) => heightAt(column * cell, row * cell))
    );
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
      for (let row = 0; row < rows - 1; row++) for (let column = 0; column < columns - 1; column++) {
        const a = values[row][column], b = values[row][column + 1], c = values[row + 1][column + 1], d = values[row + 1][column];
        const mask = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
        (table[mask] || []).forEach(([first, last]) => {
          const start = edgePoint(first, level, column, row, a, b, c, d);
          const end = edgePoint(last, level, column, row, a, b, c, d);
          context.moveTo(start.x, start.y);
          context.lineTo(end.x, end.y);
        });
      }
      const major = band % 5 === 0;
      const colour = context.createLinearGradient(0, 0, width, height);
      if (major) {
        colour.addColorStop(0, 'rgba(99,142,255,.38)');
        colour.addColorStop(.52, 'rgba(147,112,255,.50)');
        colour.addColorStop(1, 'rgba(86,188,238,.34)');
        context.shadowBlur = 0;
        context.lineWidth = 1.22;
      } else {
        colour.addColorStop(0, 'rgba(104,143,224,.14)');
        colour.addColorStop(.55, 'rgba(129,111,218,.21)');
        colour.addColorStop(1, 'rgba(81,158,212,.13)');
        context.shadowBlur = 0;
        context.lineWidth = .72;
      }
      context.strokeStyle = colour;
      context.stroke();
      context.shadowBlur = 0;
    }
    if (texturePattern) {
      context.globalAlpha = .24;
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
  window.CrowTopography = { changeSeed };
})();