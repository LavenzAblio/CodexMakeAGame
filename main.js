const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const hudEl = document.getElementById('hud');
const queueOverlay = document.getElementById('queueOverlay');
const choiceOverlay = document.getElementById('choiceOverlay');
const choiceOptionsEl = document.getElementById('choiceOptions');
const choiceTitle = document.getElementById('choiceTitle');
const choiceSubtitle = document.getElementById('choiceSubtitle');
const choiceTimerEl = document.getElementById('choiceTimer');
const gameOverEl = document.getElementById('gameOver');
const gameOverTitle = document.getElementById('gameOverTitle');
const gameOverDetail = document.getElementById('gameOverDetail');
const rematchBtn = document.getElementById('rematchBtn');
const mainMenuBtn = document.getElementById('mainMenuBtn');
const soloBtn = document.getElementById('soloBtn');
const pvpBtn = document.getElementById('pvpBtn');
const codexBtn = document.getElementById('codexBtn');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const nicknameInput = document.getElementById('nickname');
const passwordInput = document.getElementById('password');
const accountStatsEl = document.getElementById('accountStats');

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const BASE_SPAWN = 1.35;
const CHOICE_INTERVAL = 18;
const CHOICE_DURATION = 9;

const state = {
  mode: 'menu',
  run: null,
  opponentRun: null,
  paused: false,
  awaitingChoice: false,
  lastTime: 0,
  warmup: 0,
  queueTimeout: null,
  codexLayer: null,
  account: null,
  accounts: loadAccounts(),
  accountKey: null,
  aiResult: null,
};

const keys = new Set();
const pointer = { x: WIDTH / 2, y: HEIGHT / 2 };

const CHOICES = [
  {
    id: 'idolTragedy',
    name: 'Idol Tragedy',
    description:
      'Step tempo accelerates (+10% speed) but bullet streams accelerate far more (+30% spawn & speed).',
    apply: (run) => {
      run.player.speedMultiplier *= 1.1;
      run.bulletSpeed *= 1.3;
      run.spawnRate *= 1.3;
      run.danger += 0.3;
    },
  },
  {
    id: 'laserChaos',
    name: 'Laser Chaos',
    description: 'Sweeping laser columns telegraph briefly before burning through the arena.',
    apply: (run) => {
      if (!run.extraSpawners.some((s) => s.id === 'laser')) {
        run.extraSpawners.push(createLaserSpawner());
      }
      run.danger += 0.4;
    },
  },
  {
    id: 'staminaLeak',
    name: 'Stamina Leak',
    description: 'Stamina regen is halved and rush drains harder, but max stamina grows slightly.',
    apply: (run) => {
      run.player.staminaMax += 10;
      run.player.stamina = Math.min(run.player.stamina, run.player.staminaMax);
      run.player.staminaRegen *= 0.5;
      run.player.rushDrain *= 1.35;
      run.danger += 0.2;
    },
  },
  {
    id: 'tilePhantom',
    name: 'Phantom Tiles',
    description: 'Blinking squares appear anywhere and zap for heavy damage when solid.',
    apply: (run) => {
      if (!run.extraSpawners.some((s) => s.id === 'tile')) {
        run.extraSpawners.push(createTileSpawner());
      }
      run.danger += 0.35;
    },
  },
  {
    id: 'mirrorBloom',
    name: 'Mirror Bloom',
    description: 'Every fourth bullet duplicates itself. Dash cooldown also grows.',
    apply: (run) => {
      run.mirrorBloom = true;
      run.player.dashCooldownBase *= 1.3;
      run.danger += 0.3;
    },
  },
  {
    id: 'gravityFlood',
    name: 'Gravity Flood',
    description: 'Bullets enlarge and bend toward you. Dash distance shrinks.',
    apply: (run) => {
      run.gravityPull = true;
      run.player.dashDistance *= 0.75;
      run.danger += 0.35;
    },
  },
  {
    id: 'shardStorm',
    name: 'Shard Storm',
    description: 'Needle shards periodically burst from random points.',
    apply: (run) => {
      if (!run.extraSpawners.some((s) => s.id === 'shard')) {
        run.extraSpawners.push(createShardSpawner());
      }
      run.danger += 0.3;
    },
  },
  {
    id: 'voidHiss',
    name: 'Void Hiss',
    description: 'Choice timer shortens for the rest of the run and HP max drops.',
    apply: (run) => {
      run.choiceInterval *= 0.85;
      run.player.hpMax = Math.max(10, run.player.hpMax - 10);
      run.player.hp = Math.min(run.player.hp, run.player.hpMax);
      run.danger += 0.25;
    },
  },
];

function createPlayer() {
  return {
    x: WIDTH / 2,
    y: HEIGHT / 2,
    radius: 7,
    color: '#7ff7ff',
    hpMax: 100,
    hp: 100,
    staminaMax: 100,
    stamina: 100,
    staminaRegen: 12,
    staminaDelay: 0,
    rushDrain: 32,
    speed: 140,
    speedMultiplier: 1,
    rushMultiplier: 1.65,
    dashDistance: 160,
    dashCooldownBase: 1.3,
    dashCooldown: 0,
    dashCost: 25,
    invuln: 0,
    lastDir: { x: 1, y: 0 },
    choiceHistory: [],
  };
}

function createRun(options = {}) {
  return {
    player: createPlayer(),
    bullets: [],
    hazards: [],
    time: 0,
    spawnTimer: BASE_SPAWN,
    spawnRate: 1,
    bulletSpeed: 1,
    baseSpawn: BASE_SPAWN,
    nextChoice: CHOICE_INTERVAL,
    choiceInterval: CHOICE_INTERVAL,
    awaitingChoice: false,
    extraSpawners: [],
    mirrorBloom: false,
    gravityPull: false,
    spawnCount: 0,
    danger: 0,
    result: null,
    warmup: options.warmup ?? 0,
    mode: options.mode || 'solo',
    label: options.label || 'player',
    aiDamageTimer: 1,
  };
}

function createLaserSpawner() {
  return {
    id: 'laser',
    timer: 5,
    tick: (run, dt) => {
      run.laserTimer = (run.laserTimer || 0) - dt;
      if ((run.laserTimer || 0) <= 0) {
        spawnLaser(run);
        run.laserTimer = rand(5, 8);
      }
    },
  };
}

function createTileSpawner() {
  return {
    id: 'tile',
    timer: 4,
    tick: (run, dt) => {
      run.tileTimer = (run.tileTimer || 0) - dt;
      if ((run.tileTimer || 0) <= 0) {
        spawnTileHazard(run);
        run.tileTimer = rand(4, 6);
      }
    },
  };
}

function createShardSpawner() {
  return {
    id: 'shard',
    tick: (run, dt) => {
      run.shardTimer = (run.shardTimer || 0) - dt;
      if ((run.shardTimer || 0) <= 0) {
        spawnShardBurst(run);
        run.shardTimer = rand(2.5, 4.5);
      }
    },
  };
}

function startSolo() {
  resetOverlays();
  state.mode = 'solo';
  state.run = createRun({ mode: 'solo', label: 'solo' });
  state.opponentRun = null;
  state.paused = false;
  state.awaitingChoice = false;
  state.warmup = 1.5;
}

function enterQueue() {
  resetOverlays();
  state.mode = 'queue';
  queueOverlay.classList.remove('hidden');
  if (state.queueTimeout) clearTimeout(state.queueTimeout);
  state.queueTimeout = setTimeout(() => {
    queueOverlay.classList.add('hidden');
    startPvp();
  }, 2000);
}

function startPvp() {
  resetOverlays();
  state.mode = 'pvp';
  state.run = createRun({ mode: 'pvp', label: 'you', warmup: 3 });
  state.opponentRun = createAIRun();
  state.paused = false;
  state.awaitingChoice = false;
}

function createAIRun() {
  const run = createRun({ mode: 'pvp', label: 'opponent' });
  run.player.color = '#ffa4a4';
  run.skill = rand(0.85, 1.2);
  run.aiDamageTimer = 1;
  return run;
}

function resetOverlays() {
  queueOverlay.classList.add('hidden');
  choiceOverlay.classList.add('hidden');
  gameOverEl.classList.add('hidden');
  canvas.classList.remove('blur');
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function update(delta) {
  if (!state.run || state.paused) return;

  if (state.warmup > 0) {
    state.warmup -= delta;
    if (state.warmup <= 0) {
      state.run.warmup = 0;
    }
  }

  updateRun(state.run, delta);

  if (state.mode === 'pvp' && state.opponentRun) {
    updateAIRun(state.opponentRun, delta);
    if (state.opponentRun.player.hp <= 0 && !state.opponentRun.result) {
      state.opponentRun.result = 'defeat';
    }
  }

  if (state.run.player.hp <= 0 && !state.run.result) {
    endGame('You were shattered', state.mode === 'pvp' ? 'loss' : 'finished');
  }

  if (state.mode === 'pvp' && state.opponentRun && state.opponentRun.player.hp <= 0 && !state.run.result) {
    endGame('Opponent collapsed first', 'win');
  }
}

function updateRun(run, delta) {
  if (run.warmup > 0) {
    run.warmup -= delta;
    return;
  }

  run.time += delta;
  run.nextChoice -= delta;
  handleInput(run.player, delta);
  updateBullets(run, delta);
  updateHazards(run, delta);

  run.spawnTimer -= delta * run.spawnRate;
  if (run.spawnTimer <= 0) {
    spawnBullet(run);
    run.spawnTimer = Math.max(0.35, run.baseSpawn - run.time * 0.01);
  }

  run.extraSpawners.forEach((spawner) => spawner.tick && spawner.tick(run, delta));

  if (run.nextChoice <= 0 && !state.awaitingChoice) {
    run.nextChoice = run.choiceInterval;
    presentChoices(run);
  }
}

function handleInput(player, delta) {
  const dir = { x: 0, y: 0 };
  if (keys.has('KeyA')) dir.x -= 1;
  if (keys.has('KeyD')) dir.x += 1;
  if (keys.has('KeyW')) dir.y -= 1;
  if (keys.has('KeyS')) dir.y += 1;

  const len = Math.hypot(dir.x, dir.y);
  if (len > 0) {
    dir.x /= len;
    dir.y /= len;
    player.lastDir = { ...dir };
  }

  const rushing = keys.has('ShiftLeft') || keys.has('ShiftRight');
  let speed = player.speed * player.speedMultiplier;
  let spending = false;
  if (rushing && player.stamina > 0 && len > 0) {
    speed *= player.rushMultiplier;
    player.stamina = Math.max(0, player.stamina - player.rushDrain * delta);
    spending = true;
  }

  player.x += dir.x * speed * delta;
  player.y += dir.y * speed * delta;
  player.x = Math.max(player.radius, Math.min(WIDTH - player.radius, player.x));
  player.y = Math.max(player.radius, Math.min(HEIGHT - player.radius, player.y));

  if (player.dashCooldown > 0) player.dashCooldown -= delta;
  if (player.invuln > 0) player.invuln -= delta;

  if (spending) {
    player.staminaDelay = 1.2;
  } else if (player.staminaDelay > 0) {
    player.staminaDelay -= delta;
  } else {
    player.stamina = Math.min(
      player.staminaMax,
      player.stamina + player.staminaRegen * delta,
    );
  }
}

function tryDash() {
  if (!state.run || state.paused) return;
  const player = state.run.player;
  if (player.dashCooldown > 0) return;
  if (player.stamina < player.dashCost) return;
  const dir = player.lastDir;
  if (!dir || (dir.x === 0 && dir.y === 0)) return;
  const len = Math.hypot(dir.x, dir.y) || 1;
  const norm = { x: dir.x / len, y: dir.y / len };
  player.x += norm.x * player.dashDistance;
  player.y += norm.y * player.dashDistance;
  player.x = Math.max(player.radius, Math.min(WIDTH - player.radius, player.x));
  player.y = Math.max(player.radius, Math.min(HEIGHT - player.radius, player.y));
  player.dashCooldown = player.dashCooldownBase;
  player.stamina = Math.max(0, player.stamina - player.dashCost);
  player.invuln = 0.3;
  player.staminaDelay = 1.4;
}

document.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  keys.add(event.code);
  if (event.code === 'Space') {
    event.preventDefault();
    tryDash();
  }
});

document.addEventListener('keyup', (event) => {
  keys.delete(event.code);
});

function spawnBullet(run) {
  if (run.bullets.length > 160) return;
  const edge = randInt(0, 3);
  const speed = rand(60, 120) * run.bulletSpeed;
  let x, y, vx, vy;
  if (edge === 0) {
    x = rand(0, WIDTH);
    y = -10;
    vx = 0;
    vy = speed;
  } else if (edge === 1) {
    x = WIDTH + 10;
    y = rand(0, HEIGHT);
    vx = -speed;
    vy = 0;
  } else if (edge === 2) {
    x = rand(0, WIDTH);
    y = HEIGHT + 10;
    vx = 0;
    vy = -speed;
  } else {
    x = -10;
    y = rand(0, HEIGHT);
    vx = speed;
    vy = 0;
  }

  const type = Math.random() < 0.5 ? 'circle' : 'square';
  const bullet = {
    x,
    y,
    vx,
    vy,
    radius: rand(4, 7),
    size: rand(6, 12),
    type,
    damage: 10,
    color: type === 'circle' ? '#7ff7ff' : '#ffa4a4',
    warning: 0,
  };

  if (Math.random() < 0.28) {
    bullet.warning = rand(0.5, 1.1);
    bullet.spawnX = rand(30, WIDTH - 30);
    bullet.spawnY = rand(30, HEIGHT - 30);
    bullet.vx = rand(-30, 30);
    bullet.vy = rand(-30, 30);
    bullet.x = bullet.spawnX;
    bullet.y = bullet.spawnY;
  }

  run.spawnCount += 1;
  run.bullets.push(bullet);

  if (run.mirrorBloom && run.spawnCount % 4 === 0) {
    run.bullets.push({ ...bullet, x: bullet.x + 10, y: bullet.y + 10 });
  }
}

function spawnLaser(run) {
  const horizontal = Math.random() < 0.5;
  const offset = horizontal ? rand(40, HEIGHT - 40) : rand(40, WIDTH - 40);
  run.hazards.push({
    type: 'laser',
    horizontal,
    offset,
    telegraph: 1.4,
    duration: 1.6,
    width: 12,
    damage: 25,
  });
}

function spawnTileHazard(run) {
  const size = rand(50, 120);
  run.hazards.push({
    type: 'tile',
    x: rand(size / 2, WIDTH - size / 2),
    y: rand(size / 2, HEIGHT - size / 2),
    size,
    blink: rand(0.8, 1.2),
    timer: rand(0.8, 1.2),
    active: false,
    damage: 30,
  });
}

function spawnShardBurst(run) {
  const cx = rand(40, WIDTH - 40);
  const cy = rand(40, HEIGHT - 40);
  const count = randInt(6, 10);
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count;
    run.bullets.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * rand(120, 180),
      vy: Math.sin(angle) * rand(120, 180),
      radius: 4,
      type: 'circle',
      damage: 6,
      color: '#f55353',
    });
  }
}

function updateBullets(run, delta) {
  const player = run.player;
  for (let i = run.bullets.length - 1; i >= 0; i--) {
    const bullet = run.bullets[i];
    if (bullet.warning > 0) {
      bullet.warning -= delta;
      if (bullet.warning <= 0) {
        bullet.x = bullet.spawnX;
        bullet.y = bullet.spawnY;
      }
      continue;
    }
    if (run.gravityPull) {
      const dx = player.x - bullet.x;
      const dy = player.y - bullet.y;
      bullet.vx += (dx / 800) * delta * 60;
      bullet.vy += (dy / 800) * delta * 60;
    }
    bullet.x += bullet.vx * delta;
    bullet.y += bullet.vy * delta;
    if (
      bullet.x < -40 ||
      bullet.x > WIDTH + 40 ||
      bullet.y < -40 ||
      bullet.y > HEIGHT + 40
    ) {
      run.bullets.splice(i, 1);
      continue;
    }
    if (player.invuln > 0) continue;
    if (bullet.type === 'circle') {
      const dist = Math.hypot(bullet.x - player.x, bullet.y - player.y);
      if (dist < bullet.radius + player.radius) {
        applyDamage(player, bullet.damage);
        run.bullets.splice(i, 1);
      }
    } else if (bullet.type === 'square') {
      if (
        Math.abs(bullet.x - player.x) < bullet.size / 2 + player.radius &&
        Math.abs(bullet.y - player.y) < bullet.size / 2 + player.radius
      ) {
        applyDamage(player, bullet.damage);
        run.bullets.splice(i, 1);
      }
    }
  }
}

function updateHazards(run, delta) {
  const player = run.player;
  for (let i = run.hazards.length - 1; i >= 0; i--) {
    const hazard = run.hazards[i];
    if (hazard.type === 'laser') {
      if (hazard.telegraph > 0) {
        hazard.telegraph -= delta;
      } else {
        hazard.duration -= delta;
        if (hazard.duration <= 0) {
          run.hazards.splice(i, 1);
          continue;
        }
        if (player.invuln <= 0) {
          if (hazard.horizontal) {
            if (Math.abs(player.y - hazard.offset) < hazard.width) {
              applyDamage(player, hazard.damage);
            }
          } else {
            if (Math.abs(player.x - hazard.offset) < hazard.width) {
              applyDamage(player, hazard.damage);
            }
          }
        }
      }
    } else if (hazard.type === 'tile') {
      hazard.timer -= delta;
      if (hazard.timer <= 0) {
        hazard.active = !hazard.active;
        hazard.timer = hazard.blink;
        if (!hazard.active) {
          hazard.fade = 0.3;
        }
      }
      if (hazard.active && player.invuln <= 0) {
        if (
          Math.abs(player.x - hazard.x) < hazard.size / 2 &&
          Math.abs(player.y - hazard.y) < hazard.size / 2
        ) {
          applyDamage(player, hazard.damage);
        }
      }
      hazard.fade = Math.max(0, (hazard.fade || 0) - delta);
      if (!hazard.active && hazard.fade <= 0 && hazard.timer > hazard.blink) {
        run.hazards.splice(i, 1);
      }
    }
  }
}

function applyDamage(player, dmg) {
  player.hp = Math.max(0, player.hp - dmg);
}

function updateAIRun(run, delta) {
  if (run.result) return;
  run.time += delta;
  run.nextChoice -= delta;
  run.aiDamageTimer -= delta;
  if (run.aiDamageTimer <= 0) {
    run.aiDamageTimer = rand(0.9, 1.3);
    const intensity = 0.6 + run.danger * 0.35 + run.time * 0.01;
    const dodge = run.skill;
    const chance = Math.random();
    if (chance > dodge / (dodge + intensity)) {
      applyDamage(run.player, rand(6, 14));
    }
  }
}

function applyRandomChoice(run, unlock = false) {
  const choice = CHOICES[randInt(0, CHOICES.length - 1)];
  applyChoice(choice, run, unlock);
}

function presentChoices(run, opponentChoice = false) {
  state.paused = !opponentChoice;
  state.awaitingChoice = !opponentChoice;
  if (opponentChoice) return;
  const options = getChoiceOptions();
  choiceOverlay.classList.remove('hidden');
  canvas.classList.add('blur');
  choiceOptionsEl.innerHTML = '';
  choiceTitle.textContent = state.mode === 'pvp' ? 'Curse your opponent' : 'Choose your next affliction';
  choiceSubtitle.textContent =
    state.mode === 'pvp'
      ? 'Your rival chooses a curse for you at the same time.'
      : 'Each curse stacks until you fall. There are no pure bonuses here.';
  const timerBar = document.createElement('span');
  timerBar.style.width = '100%';
  choiceTimerEl.innerHTML = '';
  choiceTimerEl.appendChild(timerBar);
  const expireAt = performance.now() + CHOICE_DURATION * 1000;
  const timerInterval = setInterval(() => {
    const remaining = Math.max(0, expireAt - performance.now());
    timerBar.style.width = `${(remaining / (CHOICE_DURATION * 1000)) * 100}%`;
    if (remaining <= 0) {
      clearInterval(timerInterval);
      commitChoice(options[randInt(0, options.length - 1)]);
    }
  }, 100);

  options.forEach((choice) => {
    const card = document.createElement('div');
    card.className = 'choice-card';
    card.innerHTML = `<h3>${choice.name}</h3><p>${choice.description}</p>`;
    card.addEventListener('click', () => {
      clearInterval(timerInterval);
      commitChoice(choice);
    });
    choiceOptionsEl.appendChild(card);
  });

  function commitChoice(choice) {
    choiceOverlay.classList.add('hidden');
    canvas.classList.remove('blur');
    const target = state.mode === 'pvp' ? state.opponentRun : run;
    applyChoice(choice, target, target === state.run);
    if (state.mode === 'pvp') {
      applyRandomChoice(state.run, true);
    }
    state.paused = false;
    state.awaitingChoice = false;
  }
}

function applyChoice(choice, run, shouldUnlock = false) {
  choice.apply(run);
  run.player.choiceHistory.push(choice.id);
  if (shouldUnlock) {
    unlockChoice(choice.id);
  }
}

function getChoiceOptions() {
  const options = new Set();
  while (options.size < 3) {
    options.add(CHOICES[randInt(0, CHOICES.length - 1)]);
  }
  return [...options];
}

function unlockChoice(id) {
  if (!state.account) return;
  const data = state.accounts[state.accountKey];
  if (!data.unlockedChoices.includes(id)) {
    data.unlockedChoices.push(id);
    saveAccounts(state.accounts);
    renderAccountStats();
  }
}

function draw() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  drawBackground();
  if (state.run) drawRun(state.run);
  drawHUD();
  if (state.codexLayer) {
    // overlay handled via DOM
  }
}

function drawBackground() {
  ctx.fillStyle = '#05070c';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = 'rgba(255,255,255,0.02)';
  for (let x = 0; x < WIDTH; x += 26) {
    ctx.fillRect(x, 0, 1, HEIGHT);
  }
  for (let y = 0; y < HEIGHT; y += 26) {
    ctx.fillRect(0, y, WIDTH, 1);
  }
}

function drawRun(run) {
  const player = run.player;

  run.bullets.forEach((bullet) => {
    if (bullet.warning > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.arc(bullet.spawnX, bullet.spawnY, 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bullet.spawnX - 12, bullet.spawnY);
      ctx.lineTo(bullet.spawnX + 12, bullet.spawnY);
      ctx.moveTo(bullet.spawnX, bullet.spawnY - 12);
      ctx.lineTo(bullet.spawnX, bullet.spawnY + 12);
      ctx.stroke();
      return;
    }
    ctx.fillStyle = bullet.color;
    if (bullet.type === 'circle') {
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(bullet.x - bullet.size / 2, bullet.y - bullet.size / 2, bullet.size, bullet.size);
    }
  });

  run.hazards.forEach((hazard) => {
    if (hazard.type === 'laser') {
      ctx.strokeStyle = hazard.telegraph > 0 ? 'rgba(255,255,255,0.2)' : '#ff5b5b';
      ctx.lineWidth = hazard.width;
      ctx.beginPath();
      if (hazard.horizontal) {
        ctx.moveTo(0, hazard.offset);
        ctx.lineTo(WIDTH, hazard.offset);
      } else {
        ctx.moveTo(hazard.offset, 0);
        ctx.lineTo(hazard.offset, HEIGHT);
      }
      ctx.stroke();
    } else if (hazard.type === 'tile') {
      ctx.fillStyle = hazard.active ? 'rgba(255,80,80,0.6)' : 'rgba(255,255,255,0.15)';
      ctx.fillRect(
        hazard.x - hazard.size / 2,
        hazard.y - hazard.size / 2,
        hazard.size,
        hazard.size,
      );
    }
  });

  ctx.fillStyle = player.color;
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawHUD() {
  if (!state.run) {
    hudEl.innerHTML = '<p>Select a mode to begin.</p>';
    return;
  }
  const run = state.run;
  const player = run.player;
  const staminaPct = player.stamina / player.staminaMax;
  const hpPct = player.hp / player.hpMax;
  const lines = [
    `Mode: ${state.mode === 'pvp' ? '1v1 Duel' : 'Solo Roguelike'}`,
    `Time survived: ${run.time.toFixed(1)}s`,
    `HP ${player.hp.toFixed(0)} / ${player.hpMax}`,
    progressBar(hpPct),
    `ST ${player.stamina.toFixed(0)} / ${player.staminaMax}`,
    progressBar(staminaPct),
    `Next choice in ${Math.max(0, run.nextChoice).toFixed(1)}s`,
  ];
  if (state.mode === 'pvp' && state.opponentRun) {
    lines.push(
      `Opponent HP: ${state.opponentRun.player.hp.toFixed(0)}`,
      `Opponent curses: ${state.opponentRun.player.choiceHistory.length}`,
    );
  }
  hudEl.innerHTML = lines
    .map((line) => (line.startsWith('<div') ? line : `<div>${line}</div>`))
    .join('');
}

function progressBar(value) {
  return `<div class="progress"><span style="width:${Math.max(0, Math.min(1, value)) * 100}%"></span></div>`;
}

function endGame(title, result) {
  state.paused = true;
  state.run.result = result;
  const time = state.run.time.toFixed(1);
  gameOverTitle.textContent = title;
  if (state.mode === 'pvp') {
    const opponentTime = state.opponentRun ? state.opponentRun.time.toFixed(1) : '0';
    gameOverDetail.textContent = `You lasted ${time}s · Opponent lasted ${opponentTime}s`;
  } else {
    gameOverDetail.textContent = `You survived ${time}s. Dare to try again?`;
  }
  gameOverEl.classList.remove('hidden');
  updateAccountAfterMatch(result);
}

function updateAccountAfterMatch(result) {
  if (!state.account) return;
  const data = state.accounts[state.accountKey];
  if (state.mode === 'pvp') {
    if (result === 'win') data.wins += 1;
    else data.losses += 1;
  }
  const earned = Math.round(state.run.time);
  data.exp += earned;
  data.bestSolo = Math.max(data.bestSolo, state.mode === 'solo' ? state.run.time : data.bestSolo);
  saveAccounts(state.accounts);
  renderAccountStats();
}

rematchBtn.addEventListener('click', () => {
  if (state.mode === 'pvp') {
    startPvp();
  } else {
    startSolo();
  }
});

mainMenuBtn.addEventListener('click', () => {
  state.mode = 'menu';
  state.run = null;
  state.opponentRun = null;
  resetOverlays();
  hudEl.innerHTML = '<p>Select a mode to begin.</p>';
});

soloBtn.addEventListener('click', startSolo);
pvpBtn.addEventListener('click', enterQueue);

codexBtn.addEventListener('click', showCodex);

function showCodex() {
  if (state.codexLayer) return;
  const tpl = document.getElementById('codexTemplate');
  const node = tpl.content.firstElementChild.cloneNode(true);
  const grid = node.querySelector('#codexGrid');
  CHOICES.forEach((choice) => {
    const div = document.createElement('div');
    div.className = 'codex-entry';
    const unlocked = state.account && state.accounts[state.accountKey].unlockedChoices.includes(choice.id);
    if (!unlocked) div.classList.add('locked');
    div.innerHTML = `<h3>${choice.name}</h3><p>${choice.description}</p>`;
    grid.appendChild(div);
  });
  node.querySelector('#closeCodex').addEventListener('click', () => {
    node.remove();
    state.codexLayer = null;
  });
  document.querySelector('.game-wrapper').appendChild(node);
  state.codexLayer = node;
}

loginBtn.addEventListener('click', () => {
  const nickname = nicknameInput.value.trim();
  const password = passwordInput.value;
  if (!nickname || !password) return alert('Nickname and password required');
  const key = nickname.toLowerCase();
  const hashed = simpleHash(password);
  if (!state.accounts[key]) {
    state.accounts[key] = {
      nickname,
      password: hashed,
      exp: 0,
      wins: 0,
      losses: 0,
      bestSolo: 0,
      unlockedChoices: [],
    };
  }
  const record = state.accounts[key];
  if (record.password !== hashed) {
    alert('Password mismatch.');
    return;
  }
  state.account = record;
  state.accountKey = key;
  saveAccounts(state.accounts);
  renderAccountStats();
});

logoutBtn.addEventListener('click', () => {
  state.account = null;
  state.accountKey = null;
  accountStatsEl.innerHTML = '<p>Signed out.</p>';
});

function renderAccountStats() {
  if (!state.account) {
    accountStatsEl.innerHTML = '<p>Playing as guest.</p>';
    return;
  }
  const data = state.accounts[state.accountKey];
  const level = Math.floor(data.exp / 120) + 1;
  const winRate = data.wins + data.losses > 0 ? ((data.wins / (data.wins + data.losses)) * 100).toFixed(1) : '0.0';
  accountStatsEl.innerHTML = `
    <div>Nickname: <strong>${data.nickname}</strong></div>
    <div>Level: ${level} · EXP: ${data.exp}</div>
    <div>1v1 W/L: ${data.wins}/${data.losses} (${winRate}%)</div>
    <div>Best Solo: ${data.bestSolo.toFixed(1)}s</div>
    <div>Unlocked choices: ${data.unlockedChoices.length}/${CHOICES.length}</div>
  `;
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(16);
}

function loadAccounts() {
  try {
    const raw = localStorage.getItem('dot-matrix-accounts');
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    return {};
  }
}

function saveAccounts(obj) {
  localStorage.setItem('dot-matrix-accounts', JSON.stringify(obj));
}

function gameLoop(timestamp) {
  if (!state.lastTime) state.lastTime = timestamp;
  const delta = Math.min(0.033, (timestamp - state.lastTime) / 1000);
  state.lastTime = timestamp;
  update(delta);
  draw();
  requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);

renderAccountStats();
