// Creature Sokoban — push companions onto glowing goals.
// Sokoban rules with the Little Creatures scene aesthetic: hop animation,
// idle breathing, direction-change squash, footstep dust, idle sparkles,
// emote bubbles, pulsing goals, ambient wanderers around the puzzle.
(async () => {
  const { Application, Sprite, Container, Graphics } = PIXI;
  const W = 960, H = 640;
  let TILE = 40;
  const BASE_TILE = 40;
  const PUZZLE_MARGIN = 40;
  const TAU = Math.PI * 2;
  const SORT_SCALE = 4;
  let nextSortId = 0;

  const app = new Application();
  await app.init({ width: W, height: H, background: 0x777777, antialias: false, roundPixels: true });
  document.querySelector('#game').appendChild(app.canvas);

  const bg = new Sprite(await PIXI.Assets.load('bg.png'));
  bg.eventMode = 'none';
  const bgScale = Math.max(W / bg.texture.width, H / bg.texture.height);
  bg.scale.set(bgScale);
  bg.x = (W - bg.texture.width * bgScale) / 2;
  bg.y = (H - bg.texture.height * bgScale) / 2;
  app.stage.addChild(bg);

  const lc = await LC.load(app);
  const palLc = await LC.load(app, 'moveablePals.png', 8, 2);
  const { textures, shadowTex, partTex, NPCS, DOWN } = lc;

  const emoteTex = {
    heart: LC.makeTextTex(app, '♥', 0xff5577),
    bang:  LC.makeTextTex(app, '!', 0xffe066),
    spark: LC.makeTextTex(app, '*', 0xffffaa, 14),
  };

  // # wall · . floor · * goal · b box · p player · B box-on-goal · P player-on-goal
  const TUTORIAL_LEVELS = [
`########
#......#
#......#
#.p.b.*#
#......#
#......#
########`,

`##########
#........#
#.b....*.#
#........#
#.b....*.#
#........#
#.p......#
##########`,

`#########
#...#...#
#.b...*.#
#...#...#
#.b...*.#
#...#...#
#..p#...#
#########`,

`#########
#.......#
#..###..#
#..*.b..#
#.bp.*..#
#..###..#
#.......#
#########`,

`##########
#........#
#..b..*..#
#..*..b..#
#....p...#
#..b..*..#
#..*..b..#
#........#
##########`,
  ];
  const LEVELS = [
    ...TUTORIAL_LEVELS.map((map, i) => ({ title: `Tutorial ${i + 1}`, map })),
    ...((window.MICROBAN_LEVELS || []).map((level) => ({
      title: level.title || 'Microban',
      map: level.map,
    }))),
  ];

  // ── Layers ──
  // background grass tufts < tiles < goal rings < ambient shadows < ambient creatures
  // < puzzle shadows < particles < puzzle creatures < emotes
  const grassLayer = new Container();
  const tileLayer = new Container();
  const goalLayer = new Container();
  const ambientShLayer = new Container();
  const ambientLayer = new Container();
  const shadowLayer = new Container();
  const particleLayer = new Container();
  const world = new Container();
  const emoteLayer = new Container();
  const arrowLayer = new Container();
  for (const l of [grassLayer, tileLayer, goalLayer, ambientShLayer, ambientLayer, shadowLayer, particleLayer, world, emoteLayer, arrowLayer]) {
    l.eventMode = 'none';
  }
  app.stage.addChild(grassLayer, tileLayer, goalLayer, ambientShLayer, ambientLayer, shadowLayer, particleLayer, world, emoteLayer, arrowLayer);
  const arrowGfx = new Graphics();
  arrowGfx.visible = false;
  arrowLayer.addChild(arrowGfx);
  const cuedGfx = new Graphics();
  arrowLayer.addChild(cuedGfx);

  // ── Particle pool ──
  const PARTICLE_CAP = 500;
  const particlePool = [];
  const activeParticles = [];
  for (let i = 0; i < PARTICLE_CAP; i++) {
    const sp = new Sprite(partTex);
    sp.anchor.set(0.5);
    sp.visible = false;
    particleLayer.addChild(sp);
    particlePool.push({ sp, x: 0, y: 0, vx: 0, vy: 0, ay: 0, life: 0, max: 1, s0: 1, s1: 0, a0: 1 });
  }

  function emit(x, y, vx, vy, ay, life, color, s0, s1, a0) {
    const p = particlePool.pop();
    if (!p) return;
    p.x = x; p.y = y;
    p.vx = vx; p.vy = vy;
    p.ay = ay;
    p.life = p.max = life;
    p.s0 = s0; p.s1 = s1; p.a0 = a0;
    p.sp.tint = color;
    p.sp.visible = true;
    activeParticles.push(p);
  }

  // ── Grass tufts decorating the scene ──
  function spawnGrassTufts(n) {
    grassLayer.removeChildren().forEach(c => c.destroy());
    for (let i = 0; i < n; i++) {
      const g = new Graphics();
      const c = (Math.random() < 0.5) ? 0x5a5a5a : 0x888888;
      g.rect(0, 0, 1, 3).fill(c);
      g.rect(2, 1, 1, 2).fill(c);
      g.rect(-2, 1, 1, 2).fill(c);
      g.x = Math.random() * W;
      g.y = Math.random() * H;
      grassLayer.addChild(g);
    }
  }
  spawnGrassTufts(0);

  // ── Creature factory: shared animation state for player, boxes, ambient ──
  const TINTS = [0xffffff, 0xffeedd, 0xddeeff, 0xffddee, 0xeeffdd, 0xddffee, 0xfff0aa];

  function makeCreature(npc, tint, atlas = lc) {
    const atlasTextures = atlas.textures || textures;
    const atlasDown = atlas.DOWN ?? DOWN;
    const atlasNpcCount = atlas.NPCS || atlasTextures.length;
    const safeNpc = ((npc % atlasNpcCount) + atlasNpcCount) % atlasNpcCount;
    const sp = new Sprite(atlasTextures[safeNpc][atlasDown][1]);
    sp.anchor.set(0.5, 1);
    if (tint !== null) sp.tint = tint != null ? tint : TINTS[(Math.random() * TINTS.length) | 0];
    sp.scale.set(0); // birth pop-in
    sp.sortId = nextSortId++;
    sp.sortY = 0;

    const sh = new Sprite(shadowTex);
    sh.anchor.set(0.5, 0.5);

    return {
      npc: safeNpc,
      atlasTextures,
      sp, sh,
      x: 0, y: 0,            // rendered position (tweened)
      tx: 0, ty: 0,          // target position
      gx: 0, gy: 0,          // grid cell (puzzle creatures only)
      dir: atlasDown, prevDir: atlasDown,
      frame: 1, fc: 0,
      phase: Math.random() * TAU,
      bobRate: 10 + Math.random() * 4,
      birth: 1, squash: 0,
      emote: null, emoteT: 0,
      walking: false,
      idle: 0,               // ambient idle countdown
      speed: 0.3 + Math.random() * 0.7,
      role: 'wander',        // 'wander' | 'drawing' | 'watching' (ambient only)
      cheer: 0,              // 1 while celebrating
    };
  }

  function clearEmote(c) {
    if (c.emote) { emoteLayer.removeChild(c.emote); c.emote.destroy(); c.emote = null; }
  }
  function startEmote(c, kind) {
    clearEmote(c);
    const e = new Sprite(emoteTex[kind]);
    e.anchor.set(0.5, 1);
    c.emote = e;
    c.emoteT = 60;
    emoteLayer.addChild(e);
  }

  // Animate one creature given (walking, dt). Handles frame cycling, bob, breathe, squash,
  // birth, shadow, emote. Reads c.x/c.y; writes sprite/shadow/emote positions.
  let time = 0;
  function updateCreature(c, dt, walking) {
    let yOff = 0;
    // birth pop-in
    if (c.birth > 0) {
      c.birth = Math.max(0, c.birth - dt * 0.06);
      const t = 1 - c.birth;
      const overshoot = 1 + Math.sin(t * Math.PI) * 0.25;
      c.sp.scale.set(overshoot * (1 - c.birth * c.birth));
    } else {
      let sx = 1, sy = 1;
      if (c.cheer > 0) {
        const jp = time * 0.22 + c.phase;
        const bounce = Math.max(0, Math.sin(jp));
        yOff = -bounce * 9;
        sx = 1 + (1 - bounce) * 0.06;
        sy = 1 - (1 - bounce) * 0.06;
        if (particlePool.length && Math.random() < 0.05) {
          const colors = [0xff5577, 0xffe066, 0x88e0ff, 0x88ff88, 0xff88dd, 0xffffff];
          emit(c.x + (Math.random() - 0.5) * 8, c.y - 22,
               (Math.random() - 0.5) * 1.6,
               -1.4 - Math.random() * 0.8,
               0.04, 30 + Math.random() * 25,
               colors[(Math.random() * colors.length) | 0],
               0.55, 0.05, 1);
        }
      } else if (walking) {
        yOff = -Math.abs(Math.sin(time * c.bobRate * 0.05 + c.phase)) * 1.8;
      } else {
        const breathe = Math.sin(time * 0.15 + c.phase) * 0.04;
        sy = 1 + breathe;
        sx = 1 - breathe * 0.5;
      }
      if (c.squash > 0) {
        c.squash = Math.max(0, c.squash - dt * 0.12);
        sx *= 1 + c.squash * 0.25;
        sy *= 1 - c.squash * 0.2;
      }
      c.sp.scale.set(sx, sy);
    }

    // frame cycling
    if (walking) {
      const oldFc = c.fc;
      c.fc = (c.fc + dt) % 24;
      const fr = (c.fc / 8) | 0;
      if (fr !== c.frame) {
        c.frame = fr;
        c.sp.texture = c.atlasTextures[c.npc][c.dir][fr];
      }
      // footstep dust on each cycle wrap
      if (c.fc < oldFc && particlePool.length) {
        emit(c.x + (Math.random() - 0.5) * 4, c.y - 1,
             (Math.random() - 0.5) * 0.5,
             -0.2 - Math.random() * 0.3,
             -0.01, 22 + Math.random() * 10,
             0xb89c78, 0.35, 0.9, 0.7);
      }
    } else if (c.frame !== 1) {
      c.frame = 1;
      c.sp.texture = c.atlasTextures[c.npc][c.dir][1];
    }

    c.sp.x = c.x;
    c.sp.y = c.y + yOff;
    c.sh.x = c.x;
    c.sh.y = c.y - 1;
    c.sh.scale.x = 0.95 + (walking ? 0 : Math.sin(time * 0.08 + c.phase) * 0.04);
    c.sp.sortY = Math.round(c.y * SORT_SCALE);

    // emote bubble
    if (c.emote) {
      c.emoteT -= dt;
      if (c.emoteT <= 0) {
        clearEmote(c);
      } else {
        const t = 1 - c.emoteT / 60;
        c.emote.x = c.x;
        c.emote.y = c.y - 38 - t * 6;
        c.emote.alpha = c.emoteT < 15 ? c.emoteT / 15 : 1;
        c.emote.scale.set(0.9 + Math.sin(time * 0.3 + c.phase) * 0.1);
      }
    }
  }

  // ── Game state ──
  let levelIdx = 0;
  let map, cols, rows, offsetX = 0, offsetY = 0;
  let goals = [];
  let boxes = [];
  let player = null;
  let moves = 0;
  let won = false;
  let engagement = 0;     // good moves so far this attempt — drives crowd growth
  let usedRetry = false;  // sticky for the level; dampens final cheer
  let celebrating = false;
  let autoPath = [];      // queued moves from mouse pathfinding
  let autoTimer = 0;
  const AUTO_STEP_DT = 7;
  let dragPush = null;    // { box, dirX, dirY, dist, maxDist, startX, startY, hasDragged }
  let pendingClick = null; // pointerdown on a non-pal cell, awaits pointerup for pathfinding
  let cuedMoves = [];     // queued direction moves while autoPath is running
  const MAX_CUED = 4;

  function tileCenter(gx, gy) {
    return { x: offsetX + gx * TILE + TILE / 2, y: offsetY + gy * TILE + TILE / 2 + 8 };
  }

  function drawWall(x, y) {
    const g = new Graphics();
    g.rect(0, 0, TILE, TILE).fill(0x3a3148);
    g.rect(2, 2, TILE - 4, TILE - 4).fill(0x4a4258);
    g.rect(8, 6, 3, 3).fill(0x5a4f6c);
    g.rect(22, 18, 4, 3).fill(0x5a4f6c);
    g.rect(14, 28, 3, 3).fill(0x5a4f6c);
    g.x = offsetX + x * TILE;
    g.y = offsetY + y * TILE;
    tileLayer.addChild(g);
  }

  function drawFloor(x, y) {
    const g = new Graphics();
    g.rect(0, 0, TILE, TILE).fill({ color: 0xffffff, alpha: 0.06 });
    g.rect(0, TILE - 1, TILE, 1).fill({ color: 0x1c2220, alpha: 0.22 });
    g.rect(TILE - 1, 0, 1, TILE).fill({ color: 0x1c2220, alpha: 0.16 });
    g.x = offsetX + x * TILE;
    g.y = offsetY + y * TILE;
    tileLayer.addChild(g);
  }

  function makeGoalGfx(gx, gy) {
    const ring = new Graphics();
    ring.circle(0, 0, 13).stroke({ width: 2, color: 0xffe066, alpha: 0.9 });
    ring.circle(0, 0, 7).fill({ color: 0xffe066, alpha: 0.18 });
    const c = tileCenter(gx, gy);
    ring.x = c.x;
    ring.y = c.y - 10;
    ring.pulse = Math.random() * TAU;
    goalLayer.addChild(ring);
    return ring;
  }

  function destroyCreature(c, ownerLayer, shLayer) {
    clearEmote(c);
    ownerLayer.removeChild(c.sp); c.sp.destroy();
    shLayer.removeChild(c.sh); c.sh.destroy();
  }

  function clearPuzzle() {
    if (player) destroyCreature(player, world, shadowLayer);
    if (boxes) for (const b of boxes) destroyCreature(b, world, shadowLayer);
    tileLayer.removeChildren().forEach(c => c.destroy());
    goalLayer.removeChildren().forEach(c => c.destroy());
    boxes = [];
    goals = [];
    player = null;
  }

  function loadLevel(idx, soft = false) {
    if (!soft) usedRetry = false;
    else if (moves > 0 && !won) usedRetry = true;
    clearPuzzle();
    const lines = LEVELS[idx].map.split('\n');
    rows = lines.length;
    cols = Math.max(...lines.map(l => l.length));
    TILE = Math.min(BASE_TILE, Math.floor(Math.min((W - PUZZLE_MARGIN) / cols, (H - PUZZLE_MARGIN) / rows)));
    offsetX = ((W - cols * TILE) / 2) | 0;
    offsetY = ((H - rows * TILE) / 2) | 0;
    map = [];
    for (let y = 0; y < rows; y++) {
      const row = [];
      for (let x = 0; x < cols; x++) {
        const ch = lines[y][x] || ' ';
        if (ch === '#') {
          row.push('#');
          drawWall(x, y);
        } else if (ch === ' ') {
          row.push(' ');
        } else {
          row.push('.');
          drawFloor(x, y);
          if (ch === '*' || ch === 'B' || ch === 'P') {
            const ring = makeGoalGfx(x, y);
            goals.push({ x, y, ring });
          }
          if (ch === 'b' || ch === 'B') {
            const npc = (x * 5 + y * 11 + boxes.length) % palLc.NPCS;
            const b = makeCreature(npc, null, palLc);
            b.gx = x; b.gy = y;
            const tc = tileCenter(x, y);
            b.x = b.tx = tc.x;
            b.y = b.ty = tc.y;
            world.addChild(b.sp);
            shadowLayer.addChild(b.sh);
            boxes.push(b);
          }
          if (ch === 'p' || ch === 'P') {
            player = makeCreature(0, 0xfff5b8);
            player.gx = x; player.gy = y;
            const tc = tileCenter(x, y);
            player.x = player.tx = tc.x;
            player.y = player.ty = tc.y;
            world.addChild(player.sp);
            shadowLayer.addChild(player.sh);
          }
        }
      }
      while (row.length < cols) row.push(' ');
      map.push(row);
    }
    moves = 0;
    won = false;
    engagement = 0;
    celebrating = false;
    autoPath = [];
    cuedMoves = [];
    dragPush = null;
    pendingClick = null;
    arrowGfx.clear();
    arrowGfx.visible = false;
    respawnAmbient();
    // little spawn poof for each puzzle creature
    for (const c of [player, ...boxes]) {
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * TAU;
        emit(c.x, c.y - 8, Math.cos(a) * 0.8, Math.sin(a) * 0.8 - 0.4, -0.005, 20 + Math.random() * 15, 0xffe6cc, 0.5, 0, 0.9);
      }
    }
  }

  function isOnGoal(b) {
    for (const g of goals) if (g.x === b.gx && g.y === b.gy) return true;
    return false;
  }

  function tileAt(x, y) {
    if (!map[y]) return ' ';
    return map[y][x] || ' ';
  }

  function tryMove(dx, dy) {
    if (won || !player) return;
    const nx = player.gx + dx, ny = player.gy + dy;
    const t = tileAt(nx, ny);
    if (t === '#' || t === ' ') {
      // bump squash
      const newDir = LC.facing(dx, dy);
      if (newDir !== player.prevDir) { player.squash = 1; player.prevDir = newDir; }
      player.dir = newDir;
      return;
    }
    const box = boxes.find(b => b.gx === nx && b.gy === ny);
    if (box) {
      const bnx = nx + dx, bny = ny + dy;
      const tt = tileAt(bnx, bny);
      if (tt !== '.' || boxes.some(b => b.gx === bnx && b.gy === bny)) {
        const newDir = LC.facing(dx, dy);
        if (newDir !== player.prevDir) { player.squash = 1; player.prevDir = newDir; }
        player.dir = newDir;
        return;
      }
      const wasOn = isOnGoal(box);
      box.gx = bnx; box.gy = bny;
      const newOn = isOnGoal(box);
      if (!wasOn && newOn) {
        startEmote(box, 'heart');
        const tc = tileCenter(box.gx, box.gy);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU;
          emit(tc.x, tc.y - 8, Math.cos(a) * 1.2, Math.sin(a) * 1.2 - 0.3, 0.005, 30 + Math.random() * 15, 0xffe066, 0.55, 0.05, 1);
        }
        gainEngagement(2);
      } else if (wasOn && !newOn) {
        startEmote(box, 'bang');
      } else {
        gainEngagement(1);
      }
      const newDir = LC.facing(dx, dy);
      if (newDir !== box.prevDir) { box.squash = 1; box.prevDir = newDir; }
      box.dir = newDir;
    }

    player.gx = nx; player.gy = ny;
    const newDir = LC.facing(dx, dy);
    if (newDir !== player.prevDir) { player.squash = 1; player.prevDir = newDir; }
    player.dir = newDir;
    moves++;

    if (boxes.every(isOnGoal)) {
      won = true;
      triggerCelebration();
      startEmote(player, 'heart');
      for (const b of boxes) startEmote(b, 'heart');
      // celebratory burst at every goal
      for (const g of goals) {
        const tc = tileCenter(g.x, g.y);
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * TAU;
          emit(tc.x, tc.y - 8, Math.cos(a) * 1.8, Math.sin(a) * 1.8 - 0.4, 0.02, 50 + Math.random() * 20, 0xffe066, 0.6, 0, 1);
        }
      }
      setTimeout(() => {
        if (levelIdx < LEVELS.length - 1) {
          levelIdx++;
          loadLevel(levelIdx);
        } else {
          const overlay = document.createElement('div');
          overlay.className = 'center-overlay';
          overlay.innerHTML = `<div class="banner">
            <h2>All levels solved!</h2>
            <div>${moves} moves on the last one.</div>
            <div style="margin-top:8px"><button onclick="location.reload()">Replay</button>
            <a href="index.html" style="color:#9ad;margin-left:8px">Menu</a></div>
          </div>`;
          document.body.appendChild(overlay);
        }
      }, 1700);
    }
  }

  // ── Ambient creatures wandering outside the puzzle ──
  const AMBIENT_COUNT = 24;
  const ambient = [];

  function clearAmbient() {
    while (ambient.length) {
      destroyCreature(ambient.pop(), ambientLayer, ambientShLayer);
    }
  }

  function inPuzzle(x, y, pad = 8) {
    return x > offsetX - pad && x < offsetX + cols * TILE + pad
        && y > offsetY - pad && y < offsetY + rows * TILE + pad;
  }

  function pickAmbientTarget(c) {
    for (let tries = 0; tries < 10; tries++) {
      const x = 24 + Math.random() * (W - 48);
      const y = 24 + Math.random() * (H - 48);
      if (!inPuzzle(x, y, 24)) { c.tx = x; c.ty = y; return; }
    }
    c.tx = 24 + Math.random() * (W - 48);
    c.ty = 24 + Math.random() * (H - 48);
  }

  // Pick a watch position just outside the nearest puzzle edge so the NPC
  // doesn't have to cross the puzzle to get there.
  function pickWatchPos(c) {
    const px = offsetX, py = offsetY;
    const pw = cols * TILE, ph = rows * TILE;
    const ccx = px + pw / 2, ccy = py + ph / 2;
    const dx = c.x - ccx, dy = c.y - ccy;
    let side;
    if (Math.abs(dx) * ph > Math.abs(dy) * pw) side = dx < 0 ? 2 : 3;
    else side = dy < 0 ? 0 : 1;
    const margin = 14 + Math.random() * 18;
    let x, y;
    if (side === 0) { x = px + Math.random() * pw; y = py - margin; }
    else if (side === 1) { x = px + Math.random() * pw; y = py + ph + margin; }
    else if (side === 2) { x = px - margin; y = py + Math.random() * ph; }
    else { x = px + pw + margin; y = py + Math.random() * ph; }
    c.tx = Math.max(20, Math.min(W - 20, x));
    c.ty = Math.max(20, Math.min(H - 20, y));
  }

  function drawInOne() {
    const wanderers = ambient.filter(c => c.role === 'wander');
    if (!wanderers.length) return;
    const c = wanderers[(Math.random() * wanderers.length) | 0];
    c.role = 'drawing';
    c.idle = 0;
    pickWatchPos(c);
  }

  function gainEngagement(n) {
    engagement += n;
    for (let i = 0; i < n; i++) drawInOne();
  }

  function triggerCelebration() {
    celebrating = true;
    if (player) player.cheer = 1;
    for (const b of boxes) b.cheer = 1;
    for (const c of ambient) {
      if (!usedRetry && c.role === 'wander') {
        c.role = 'drawing';
        c.idle = 0;
        pickWatchPos(c);
      }
      if (c.role === 'watching') c.cheer = 1;
    }
  }

  function spawnAmbient() {
    const c = makeCreature((Math.random() * NPCS) | 0);
    // spawn outside puzzle region
    let tries = 0;
    do {
      c.x = 24 + Math.random() * (W - 48);
      c.y = 24 + Math.random() * (H - 48);
      tries++;
    } while (inPuzzle(c.x, c.y, 24) && tries < 12);
    c.tx = c.x; c.ty = c.y;
    c.sp.x = c.x; c.sp.y = c.y;
    c.idle = (Math.random() * 90) | 0;
    pickAmbientTarget(c);
    ambientLayer.addChild(c.sp);
    ambientShLayer.addChild(c.sh);
    ambient.push(c);
  }

  function respawnAmbient() {
    clearAmbient();
    for (let i = 0; i < AMBIENT_COUNT; i++) spawnAmbient();
  }

  loadLevel(0);

  // ── Mouse pathfinding ──
  function isWalkable(x, y, bs = boxes) {
    if (tileAt(x, y) !== '.') return false;
    for (const b of bs) if (b.gx === x && b.gy === y) return false;
    return true;
  }

  function findPath(sx, sy, tx, ty, bs = boxes) {
    if (sx === tx && sy === ty) return [];
    if (!isWalkable(tx, ty, bs)) return null;
    const W2 = cols;
    const startIdx = sy * W2 + sx;
    const came = new Int32Array(cols * rows).fill(-1);
    came[startIdx] = startIdx;
    const queue = [startIdx];
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    let head = 0;
    while (head < queue.length) {
      const idx = queue[head++];
      const x = idx % W2, y = (idx / W2) | 0;
      if (x === tx && y === ty) {
        const path = [];
        let cur = idx;
        while (cur !== startIdx) {
          const prev = came[cur];
          const cx = cur % W2, cy = (cur / W2) | 0;
          const px = prev % W2, py = (prev / W2) | 0;
          path.unshift({ dx: cx - px, dy: cy - py });
          cur = prev;
        }
        return path;
      }
      for (const [dx, dy] of dirs) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const nIdx = ny * W2 + nx;
        if (came[nIdx] !== -1 || !isWalkable(nx, ny, bs)) continue;
        came[nIdx] = idx;
        queue.push(nIdx);
      }
    }
    return null;
  }

  // ── Move queueing while autoPath is running ──
  // Project player + box positions forward through autoPath then cuedMoves so
  // we can validate further inputs against where the pal *will be* when the
  // queued move actually fires.
  function predictedState() {
    const bs = boxes.map(b => ({ ref: b, gx: b.gx, gy: b.gy }));
    let px = player.gx, py = player.gy;
    const all = [...autoPath, ...cuedMoves];
    for (const m of all) {
      const nx = px + m.dx, ny = py + m.dy;
      const t = tileAt(nx, ny);
      if (t === '#' || t === ' ') break;
      const box = bs.find(b => b.gx === nx && b.gy === ny);
      if (box) { box.gx = nx + m.dx; box.gy = ny + m.dy; }
      px = nx; py = ny;
    }
    return { px, py, bs };
  }

  function validateMove(dx, dy, state) {
    const nx = state.px + dx, ny = state.py + dy;
    const t = tileAt(nx, ny);
    if (t === '#' || t === ' ') return false;
    const box = state.bs.find(b => b.gx === nx && b.gy === ny);
    if (box) {
      const bnx = nx + dx, bny = ny + dy;
      if (tileAt(bnx, bny) !== '.') return false;
      if (state.bs.some(b => b !== box && b.gx === bnx && b.gy === bny)) return false;
    }
    return true;
  }

  function tryQueueMove(dx, dy) {
    if (won || !player) return false;
    if (cuedMoves.length >= MAX_CUED) return false;
    const state = predictedState();
    if (!validateMove(dx, dy, state)) return false;
    cuedMoves.push({ dx, dy });
    return true;
  }

  function tryQueuePath(tgx, tgy) {
    if (won || !player) return false;
    if (cuedMoves.length >= MAX_CUED) return false;
    const state = predictedState();
    const path = findPath(state.px, state.py, tgx, tgy, state.bs);
    if (!path || !path.length) return false;
    for (const m of path) {
      if (cuedMoves.length >= MAX_CUED) break;
      cuedMoves.push(m);
    }
    return true;
  }

  function drawCuedMoves(t) {
    cuedGfx.clear();
    if (!cuedMoves.length || !player) return;
    const bs = boxes.map(b => ({ gx: b.gx, gy: b.gy }));
    let px = player.gx, py = player.gy;
    for (const m of autoPath) {
      const nx = px + m.dx, ny = py + m.dy;
      const box = bs.find(b => b.gx === nx && b.gy === ny);
      if (box) { box.gx = nx + m.dx; box.gy = ny + m.dy; }
      px = nx; py = ny;
    }
    const pulse = 0.85 + Math.sin(t * 0.15) * 0.15;
    let prev = tileCenter(px, py);
    for (let i = 0; i < cuedMoves.length; i++) {
      const m = cuedMoves[i];
      const nx = px + m.dx, ny = py + m.dy;
      const box = bs.find(b => b.gx === nx && b.gy === ny);
      if (box) { box.gx = nx + m.dx; box.gy = ny + m.dy; }
      px = nx; py = ny;
      const c = tileCenter(px, py);
      const fade = 1 - i * 0.15;
      const yOff = 4;
      cuedGfx.moveTo(prev.x, prev.y + yOff).lineTo(c.x, c.y + yOff).stroke({
        width: 2, color: 0x88ccff, alpha: 0.4 * fade, cap: 'round',
      });
      const r = 4.5 * pulse;
      cuedGfx.circle(c.x, c.y + yOff, r + 2.5).fill({ color: 0x4477dd, alpha: 0.32 * fade });
      cuedGfx.circle(c.x, c.y + yOff, r).fill({ color: 0x88ccff, alpha: 0.9 * fade });
      cuedGfx.circle(c.x, c.y + yOff, r * 0.45).fill({ color: 0xffffff, alpha: 0.75 * fade });
      prev = c;
    }
  }

  // ── Click-to-push & drag-to-push ──
  function maxPushDistance(box, dx, dy, bs = boxes) {
    let bgx, bgy;
    const sim = bs !== boxes ? bs.find(b => b.ref === box) : null;
    if (sim) { bgx = sim.gx; bgy = sim.gy; }
    else { bgx = box.gx; bgy = box.gy; }
    let n = 0;
    let x = bgx + dx, y = bgy + dy;
    while (n < 64) {
      if (tileAt(x, y) !== '.') break;
      const blocked = bs.some(b => (b !== box && b.ref !== box) && b.gx === x && b.gy === y);
      if (blocked) break;
      n++; x += dx; y += dy;
    }
    return n;
  }

  function drawPushArrow(state, t) {
    arrowGfx.clear();
    if (!state || state.dist <= 0 || (state.dirX === 0 && state.dirY === 0)) {
      arrowGfx.visible = false;
      return;
    }
    arrowGfx.visible = true;
    const { box, dirX, dirY, dist, valid, walkPath } = state;
    const bgx = state.bgx ?? box.gx;
    const bgy = state.bgy ?? box.gy;
    const bob = Math.sin(t * 0.12) * 1.5;

    const glow  = valid ? 0xffd166 : 0xff6f6f;
    const inner = valid ? 0xffe9a8 : 0xffc8c8;
    const dashCol = valid ? 0xfff5cc : 0xffe2e2;

    // Faint walk-path indicator from player → push origin.
    if (walkPath && walkPath.length) {
      let pgx = state.pgx ?? player.gx, pgy = state.pgy ?? player.gy;
      let prev = tileCenter(pgx, pgy);
      const dotPeriod = 6;
      const dotFlow = ((t * 0.5) % dotPeriod + dotPeriod) % dotPeriod;
      for (const m of walkPath) {
        pgx += m.dx; pgy += m.dy;
        const cur = tileCenter(pgx, pgy);
        const segLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
        const sCos = (cur.x - prev.x) / segLen;
        const sSin = (cur.y - prev.y) / segLen;
        for (let d = dotFlow - dotPeriod; d < segLen; d += dotPeriod) {
          if (d < 0) continue;
          const dx = prev.x + sCos * d;
          const dy = prev.y + sSin * d - 14;
          arrowGfx.circle(dx, dy, 1.6).fill({ color: glow, alpha: 0.55 });
        }
        prev = cur;
      }
    }

    const start = tileCenter(bgx, bgy);
    const end = tileCenter(bgx + dirX * dist, bgy + dirY * dist);
    const sx = start.x + Math.abs(dirY) * bob;
    const sy = start.y - 16 + Math.abs(dirX) * bob;
    const ex = end.x + Math.abs(dirY) * bob;
    const ey = end.y - 16 + Math.abs(dirX) * bob;
    const ang = Math.atan2(ey - sy, ex - sx);
    const len = Math.hypot(ex - sx, ey - sy);
    const breath = 0.85 + Math.sin(t * 0.18) * 0.15;

    // Warm outer glow — wide, soft.
    arrowGfx.moveTo(sx, sy).lineTo(ex, ey).stroke({
      width: 11, color: glow, alpha: 0.22 * breath, cap: 'round',
    });
    arrowGfx.moveTo(sx, sy).lineTo(ex, ey).stroke({
      width: 7, color: inner, alpha: 0.42 * breath, cap: 'round',
    });

    // Flowing dashes travelling toward the tip — pulse of energy.
    const dashLen = 9;
    const gap = 7;
    const period = dashLen + gap;
    const flow = ((t * 0.7) % period + period) % period;
    const cosA = Math.cos(ang), sinA = Math.sin(ang);
    for (let d = flow - period; d < len; d += period) {
      const a = Math.max(0, d);
      const b = Math.min(len, d + dashLen);
      if (b <= a) continue;
      const x1 = sx + cosA * a, y1 = sy + sinA * a;
      const x2 = sx + cosA * b, y2 = sy + sinA * b;
      arrowGfx.moveTo(x1, y1).lineTo(x2, y2).stroke({
        width: 4, color: dashCol, alpha: 0.95, cap: 'round',
      });
    }

    // Bouncy chevron head with soft glow.
    const pulse = 1 + Math.sin(t * 0.22) * 0.12;
    const ah = 13 * pulse;
    const wing = ah * 0.85;
    const bx = ex - ah * cosA, by = ey - ah * sinA;
    const w1x = bx + wing * Math.cos(ang - Math.PI / 2);
    const w1y = by + wing * Math.sin(ang - Math.PI / 2);
    const w2x = bx + wing * Math.cos(ang + Math.PI / 2);
    const w2y = by + wing * Math.sin(ang + Math.PI / 2);
    arrowGfx.moveTo(w1x, w1y).lineTo(ex, ey).lineTo(w2x, w2y).stroke({
      width: 9, color: glow, alpha: 0.28 * breath, cap: 'round', join: 'round',
    });
    arrowGfx.moveTo(w1x, w1y).lineTo(ex, ey).lineTo(w2x, w2y).stroke({
      width: 4, color: dashCol, alpha: 0.98, cap: 'round', join: 'round',
    });

    // Sparkle at the tip.
    const tipR = 2.5 + Math.sin(t * 0.3) * 0.6;
    arrowGfx.circle(ex, ey, tipR + 2).fill({ color: glow, alpha: 0.45 });
    arrowGfx.circle(ex, ey, tipR).fill({ color: 0xffffff, alpha: 0.95 });
  }

  // Update dragPush direction/distance/walkPath from a canvas-space cursor.
  // Picks the dominant axis from box → cursor; the player must be able to reach
  // the tile *behind* the box (push origin) without crossing other pals.
  // While a walk is in flight, projects the box & player forward through the
  // queued moves so the preview reflects where the push will actually start.
  function refreshDragPush(cx, cy) {
    if (!dragPush || !player) return;
    const box = dragPush.box;
    const queued = autoPath.length > 0 || cuedMoves.length > 0;
    const pred = queued ? predictedState() : null;
    let bgx, bgy, bs, px, py;
    if (pred) {
      const sim = pred.bs.find(b => b.ref === box);
      bgx = sim ? sim.gx : box.gx;
      bgy = sim ? sim.gy : box.gy;
      bs = pred.bs;
      px = pred.px; py = pred.py;
    } else {
      bgx = box.gx; bgy = box.gy;
      bs = boxes;
      px = player.gx; py = player.gy;
    }

    const tgx = Math.floor((cx - offsetX) / TILE);
    const tgy = Math.floor((cy - offsetY) / TILE);
    const ddx = tgx - bgx;
    const ddy = tgy - bgy;

    let dirX = 0, dirY = 0;
    if (ddx === 0 && ddy === 0) {
      dragPush.dirX = 0; dragPush.dirY = 0;
      dragPush.dist = 0; dragPush.maxDist = 0;
      dragPush.valid = false; dragPush.walkPath = null;
      dragPush.bgx = bgx; dragPush.bgy = bgy;
      dragPush.pgx = px; dragPush.pgy = py;
      return;
    }
    if (Math.abs(ddx) >= Math.abs(ddy)) dirX = Math.sign(ddx);
    else dirY = Math.sign(ddy);

    const maxDist = maxPushDistance(box, dirX, dirY, bs);
    const requested = dirX !== 0 ? ddx * dirX : ddy * dirY;
    const dist = Math.max(0, Math.min(maxDist, requested));

    const ox = bgx - dirX;
    const oy = bgy - dirY;
    let walkPath = null;
    let valid = dist > 0;
    if (valid) {
      if (px === ox && py === oy) walkPath = [];
      else {
        walkPath = findPath(px, py, ox, oy, bs);
        if (!walkPath) valid = false;
      }
    }

    dragPush.dirX = dirX;
    dragPush.dirY = dirY;
    dragPush.dist = dist;
    dragPush.maxDist = maxDist;
    dragPush.valid = valid;
    dragPush.walkPath = walkPath;
    dragPush.originX = ox;
    dragPush.originY = oy;
    dragPush.bgx = bgx;
    dragPush.bgy = bgy;
    dragPush.pgx = px;
    dragPush.pgy = py;
  }

  function mouseToCanvas(e) {
    const rect = app.canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (W / rect.width);
    const cy = (e.clientY - rect.top) * (H / rect.height);
    return { cx, cy, gx: Math.floor((cx - offsetX) / TILE), gy: Math.floor((cy - offsetY) / TILE) };
  }

  function cancelDragPush() {
    if (!dragPush) return;
    arrowGfx.clear();
    arrowGfx.visible = false;
    dragPush = null;
  }

  app.canvas.style.cursor = 'pointer';
  app.canvas.addEventListener('pointerdown', e => {
    if (won || !player) return;
    const { gx, gy } = mouseToCanvas(e);
    if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) return;
    const box = boxes.find(b => b.gx === gx && b.gy === gy);
    if (box) {
      // Don't interrupt an in-flight walk — preview against the predicted state.
      const queued = autoPath.length > 0 || cuedMoves.length > 0;
      const pred = queued ? predictedState() : null;
      let bgx, bgy, bs, px, py;
      if (pred) {
        const sim = pred.bs.find(b => b.ref === box);
        bgx = sim ? sim.gx : box.gx;
        bgy = sim ? sim.gy : box.gy;
        bs = pred.bs;
        px = pred.px; py = pred.py;
      } else {
        bgx = box.gx; bgy = box.gy;
        bs = boxes;
        px = player.gx; py = player.gy;
      }
      dragPush = {
        box,
        dirX: 0, dirY: 0, dist: 0, maxDist: 0,
        startX: e.clientX, startY: e.clientY,
        hasDragged: false, valid: false,
        walkPath: null, originX: 0, originY: 0,
        bgx, bgy, pgx: px, pgy: py,
      };
      // Adjacent click gives an instant 1-tile preview so a tap-without-drag
      // still pushes the pal one square in the player's facing.
      const dxp = bgx - px;
      const dyp = bgy - py;
      if (Math.abs(dxp) + Math.abs(dyp) === 1) {
        const maxDist = maxPushDistance(box, dxp, dyp, bs);
        const dist = Math.min(1, maxDist);
        dragPush.dirX = dxp; dragPush.dirY = dyp;
        dragPush.dist = dist; dragPush.maxDist = maxDist;
        dragPush.valid = dist > 0;
        dragPush.walkPath = [];
        dragPush.originX = px;
        dragPush.originY = py;
      }
      return;
    }
    pendingClick = { gx, gy };
  });

  window.addEventListener('pointermove', e => {
    if (!dragPush) return;
    if (!dragPush.hasDragged) {
      const ddx = e.clientX - dragPush.startX;
      const ddy = e.clientY - dragPush.startY;
      if (ddx * ddx + ddy * ddy > 16) dragPush.hasDragged = true;
    }
    if (!dragPush.hasDragged) return;
    const { cx, cy } = mouseToCanvas(e);
    refreshDragPush(cx, cy);
  });

  window.addEventListener('pointerup', () => {
    if (dragPush) {
      const dp = dragPush;
      cancelDragPush();
      pendingClick = null;
      if (!won && dp.valid && dp.dist > 0) {
        const moves = [];
        if (dp.walkPath) for (const m of dp.walkPath) moves.push(m);
        for (let i = 0; i < dp.dist; i++) moves.push({ dx: dp.dirX, dy: dp.dirY });
        const queueing = autoPath.length > 0 || cuedMoves.length > 0;
        if (queueing) {
          // Drag-push is a discrete intent — append the whole sequence so the
          // walk + push doesn't end up half-applied.
          if (cuedMoves.length + moves.length <= MAX_CUED) {
            for (const m of moves) cuedMoves.push(m);
          }
        } else {
          autoPath = moves;
          autoTimer = 0;
        }
      }
      return;
    }
    if (pendingClick) {
      const { gx, gy } = pendingClick;
      pendingClick = null;
      if (won || !player) return;
      if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) return;
      if (autoPath.length > 0 || cuedMoves.length > 0) {
        tryQueuePath(gx, gy);
      } else {
        const path = findPath(player.gx, player.gy, gx, gy);
        if (path && path.length) {
          autoPath = path;
          autoTimer = 0;
        }
      }
    }
  });

  window.addEventListener('pointercancel', () => {
    cancelDragPush();
    pendingClick = null;
  });

  // ── Input ──
  window.addEventListener('keydown', e => {
    if (e.code.startsWith('Arrow')) e.preventDefault();
    let dx = 0, dy = 0;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') dx = -1;
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') dx = 1;
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') dy = -1;
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') dy = 1;
    else if (e.code === 'KeyR') { autoPath = []; cuedMoves = []; cancelDragPush(); loadLevel(levelIdx, true); return; }
    else return;
    if (autoPath.length > 0 || cuedMoves.length > 0) {
      tryQueueMove(dx, dy);
    } else {
      cancelDragPush();
      tryMove(dx, dy);
    }
  });

  const hud = document.querySelector('#hud');

  // ── Tick ──
  app.ticker.add((ticker) => {
    const dt = ticker.deltaTime;
    time += dt;

    // advance auto-path one step at a time
    if (won) {
      autoPath = [];
      cuedMoves = [];
    } else if (autoPath.length) {
      autoTimer -= dt;
      if (autoTimer <= 0) {
        const m = autoPath.shift();
        tryMove(m.dx, m.dy);
        autoTimer = AUTO_STEP_DT;
        if (!won && autoPath.length === 0 && cuedMoves.length > 0) {
          autoPath = cuedMoves;
          cuedMoves = [];
        }
      }
    } else if (cuedMoves.length > 0) {
      autoPath = cuedMoves;
      cuedMoves = [];
      autoTimer = 0;
    }

    if (dragPush) {
      drawPushArrow(dragPush, time);
    }
    drawCuedMoves(time);

    // pulse goals
    for (const g of goals) {
      g.ring.pulse += dt * 0.06;
      const occupied = boxes.some(b => b.gx === g.x && b.gy === g.y);
      if (occupied) {
        g.ring.alpha = 0.25 + Math.sin(g.ring.pulse) * 0.08;
        g.ring.scale.set(0.9);
      } else {
        g.ring.alpha = 0.7 + Math.sin(g.ring.pulse) * 0.3;
        g.ring.scale.set(1 + Math.sin(g.ring.pulse) * 0.08);
      }
    }

    // tween puzzle creatures toward their tile centers
    const lerp = Math.min(1, 0.25 * dt);
    for (const c of [player, ...boxes]) {
      if (!c) continue;
      const tc = tileCenter(c.gx, c.gy);
      c.tx = tc.x; c.ty = tc.y;
      c.x += (c.tx - c.x) * lerp;
      c.y += (c.ty - c.y) * lerp;
      const dx = c.tx - c.x, dy = c.ty - c.y;
      c.walking = (dx * dx + dy * dy) > 0.6;
      // rare idle sparkle
      if (!c.walking && c.birth <= 0 && particlePool.length && Math.random() < 0.003) {
        const a = Math.random() * TAU;
        emit(c.x + Math.cos(a) * 8, c.y - 12 + Math.sin(a) * 8,
             Math.cos(a) * 0.3, -0.3 - Math.random() * 0.4,
             -0.005, 40 + Math.random() * 20,
             Math.random() < 0.5 ? 0xffe066 : 0x88e0ff,
             0.45, 0.05, 1);
      }
      updateCreature(c, dt, c.walking);
    }

    // ambient crowd
    const ambEmoteChance = 0.3 / Math.max(60, ambient.length);
    const pCx = offsetX + (cols * TILE) / 2;
    const pCy = offsetY + (rows * TILE) / 2;
    for (const c of ambient) {
      let walking = false;
      if (c.role === 'watching') {
        c.dir = LC.facing(pCx - c.x, pCy - c.y);
        if (!c.emote && Math.random() < ambEmoteChance * 5) {
          const r = Math.random();
          startEmote(c, r < 0.55 ? 'heart' : (r < 0.9 ? 'spark' : 'bang'));
        }
      } else if (c.role === 'drawing') {
        const dx = c.tx - c.x, dy = c.ty - c.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 9) {
          c.role = 'watching';
          c.dir = LC.facing(pCx - c.x, pCy - c.y);
          if (celebrating) c.cheer = 1;
        } else {
          const inv = 1 / Math.sqrt(d2);
          const nx = dx * inv, ny = dy * inv;
          // Drawn-in NPCs move briskly so the crowd grows visibly. On the
          // celebration rush, dash hard so they reach the puzzle in ~1s.
          const speed = celebrating ? Math.max(5, c.speed * 5) : Math.max(2, c.speed * 2.5);
          c.x += nx * speed * dt;
          c.y += ny * speed * dt;
          const newDir = LC.facing(nx, ny);
          if (newDir !== c.prevDir) { c.squash = 1; c.prevDir = newDir; }
          c.dir = newDir;
          walking = true;
        }
      } else if (c.idle > 0) {
        c.idle -= dt;
        if (!c.emote && Math.random() < ambEmoteChance) {
          startEmote(c, Math.random() < 0.6 ? 'spark' : 'heart');
        }
      } else {
        const dx = c.tx - c.x, dy = c.ty - c.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 16) {
          c.idle = 30 + Math.random() * 180;
          if (Math.random() < 0.7) pickAmbientTarget(c);
        } else {
          const inv = 1 / Math.sqrt(d2);
          const nx = dx * inv, ny = dy * inv;
          const stepX = nx * c.speed * dt;
          const stepY = ny * c.speed * dt;
          // soft repel from puzzle bounds
          const newX = c.x + stepX, newY = c.y + stepY;
          if (inPuzzle(newX, newY, 8)) {
            pickAmbientTarget(c);
          } else {
            c.x = newX; c.y = newY;
          }
          const newDir = LC.facing(nx, ny);
          if (newDir !== c.prevDir) { c.squash = 1; c.prevDir = newDir; }
          c.dir = newDir;
          walking = true;
        }
      }
      c.walking = walking;
      updateCreature(c, dt, walking);
    }

    // particles
    for (let i = activeParticles.length - 1; i >= 0; i--) {
      const p = activeParticles[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.sp.visible = false;
        const last = activeParticles.length - 1;
        activeParticles[i] = activeParticles[last];
        activeParticles.pop();
        particlePool.push(p);
        continue;
      }
      p.vy += p.ay * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const t = p.life / p.max;
      const s = p.s1 + (p.s0 - p.s1) * t;
      p.sp.x = p.x;
      p.sp.y = p.y;
      p.sp.scale.set(s);
      p.sp.alpha = p.a0 * t;
    }

    // Y-sort each creature layer separately (puzzle on top of ambient)
    world.children.sort(byY);
    ambientLayer.children.sort(byY);

    hud.textContent = `${LEVELS[levelIdx].title} · ${levelIdx + 1}/${LEVELS.length} · Moves ${moves}`;
  });

  function byY(a, b) { return (a.sortY - b.sortY) || (a.sortId - b.sortId); }
})();
