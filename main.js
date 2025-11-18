const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const hudEl = document.getElementById('hud');
const queueOverlay = document.getElementById('queueOverlay');
const queueMessage = document.getElementById('queueMessage');
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
const soloLeaderboardEl = document.getElementById('soloLeaderboard');
const unlockListEl = document.getElementById('unlockList');

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
  queueAIHandle: null,
  queueTicker: null,
  queueDeadline: 0,
  codexLayer: null,
  account: null,
  accounts: loadAccounts(),
  accountKey: null,
  aiResult: null,
  recentUnlocks: [],
  leaderboard: loadLeaderboard(),
};

const keys = new Set();
const pointer = { x: WIDTH / 2, y: HEIGHT / 2 };
const audio = createAudioSuite();

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
  {
    id: 'haloDrift',
    name: 'Halo Drift',
    description: 'Twin emitters orbit center and flick radial beads constantly.',
    apply: (run) => {
      if (!run.extraSpawners.some((s) => s.id === 'halo')) {
        run.extraSpawners.push(createHaloSpawner());
      }
      run.danger += 0.35;
    },
  },
  {
    id: 'meteorRain',
    name: 'Meteor Rain',
    description: 'Heavy squares plummet from the sky with low warnings.',
    apply: (run) => {
      if (!run.extraSpawners.some((s) => s.id === 'meteor')) {
        run.extraSpawners.push(createMeteorSpawner());
      }
      run.danger += 0.35;
    },
  },
  {
    id: 'fanQuills',
    name: 'Fan Quills',
    description: 'Edge cannons sweep in fans that spread across the arena.',
    apply: (run) => {
      if (!run.extraSpawners.some((s) => s.id === 'fan')) {
        run.extraSpawners.push(createFanSpawner());
      }
      run.danger += 0.3;
    },
  },
  {
    id: 'blinkNeedles',
    name: 'Blink Needles',
    description: 'Teleporting needles mark the floor near you then lunge outward.',
    apply: (run) => {
      if (!run.extraSpawners.some((s) => s.id === 'blink')) {
        run.extraSpawners.push(createBlinkSpawner());
      }
      run.danger += 0.28;
    },
  },
  {
    id: 'novaGarden',
    name: 'Nova Garden',
    description: 'Pods sprout, pulse, and detonate into wide rings of shards.',
    apply: (run) => {
      if (!run.extraSpawners.some((s) => s.id === 'nova')) {
        run.extraSpawners.push(createNovaSpawner());
      }
      run.danger += 0.35;
    },
  },
  {
    id: 'seekerFlare',
    name: 'Seeker Flares',
    description: 'Slow orbs ignite and begin steering toward your current spot.',
    apply: (run) => {
      if (!run.extraSpawners.some((s) => s.id === 'seeker')) {
        run.extraSpawners.push(createSeekerSpawner());
      }
      run.danger += 0.33;
    },
  },
  {
    id: 'ringCascade',
    name: 'Ring Cascade',
    description: 'Every few seconds three successive rings ripple outward.',
    apply: (run) => {
      if (!run.extraSpawners.some((s) => s.id === 'cascade')) {
        run.extraSpawners.push(createCascadeSpawner());
      }
      run.danger += 0.4;
    },
  },
  {
    id: 'riftStrafe',
    name: 'Rift Strafe',
    description: 'Columns of bullets sweep horizontally or vertically at once.',
    apply: (run) => {
      if (!run.extraSpawners.some((s) => s.id === 'tunnel')) {
        run.extraSpawners.push(createTunnelSpawner());
      }
      run.danger += 0.32;
    },
  },
  {
    id: 'emberFlurry',
    name: 'Ember Flurry',
    description: 'Showers of micro embers rain constantly from above.',
    apply: (run) => {
      if (!run.extraSpawners.some((s) => s.id === 'rain')) {
        run.extraSpawners.push(createRainSpawner());
      }
      run.danger += 0.27;
    },
  },
  {
    id: 'spiralSnare',
    name: 'Spiral Snare',
    description: 'Spiral launchers continuously spin and fire paired bolts.',
    apply: (run) => {
      if (!run.extraSpawners.some((s) => s.id === 'spiral')) {
        run.extraSpawners.push(createSpiralSpawner());
      }
      run.danger += 0.34;
    },
  },
];

const CHOICE_LOOKUP = Object.fromEntries(CHOICES.map((choice) => [choice.id, choice]));

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
    hurtTimer: 0,
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
    effects: [],
    flash: 0,
    rushTrailTimer: 0,
    choicePool: snapshotChoicePool(),
  };
}

function snapshotChoicePool() {
  return getUnlockedChoiceIds();
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

function createHaloSpawner() {
  let angle = 0;
  const spawner = {
    id: 'halo',
    timer: 0,
    tick(run, dt) {
      this.timer -= dt;
      angle += dt * 1.2;
      if (this.timer <= 0) {
        this.timer = rand(1.8, 2.3);
        const count = 12;
        for (let i = 0; i < count; i++) {
          const theta = angle + (Math.PI * 2 * i) / count;
          run.bullets.push({
            x: WIDTH / 2 + Math.cos(theta) * 24,
            y: HEIGHT / 2 + Math.sin(theta) * 24,
            vx: Math.cos(theta) * 140,
            vy: Math.sin(theta) * 140,
            radius: 5,
            type: 'circle',
            damage: 8,
            color: '#9ef1ff',
          });
        }
        audio.play('bullet');
      }
    },
  };
  return spawner;
}

function createMeteorSpawner() {
  const spawner = {
    id: 'meteor',
    timer: 0,
    tick(run, dt) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = rand(2.4, 3.8);
        run.bullets.push({
          x: rand(30, WIDTH - 30),
          y: -30,
          vx: rand(-30, 30),
          vy: rand(120, 180) * run.bulletSpeed,
          size: rand(18, 28),
          type: 'square',
          damage: 18,
          color: '#ff9c5b',
        });
        audio.play('bullet');
      }
    },
  };
  return spawner;
}

function createFanSpawner() {
  const spawner = {
    id: 'fan',
    timer: 0,
    tick(run, dt) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = rand(2.2, 3.4);
        const edge = randInt(0, 3);
        const point = getEdgePoint(edge);
        const baseAngle = edge === 0 ? Math.PI / 2 : edge === 1 ? Math.PI : edge === 2 ? -Math.PI / 2 : 0;
        const count = 5;
        for (let i = 0; i < count; i++) {
          const offset = ((i - (count - 1) / 2) / (count - 1)) * (Math.PI / 4);
          const angle = baseAngle + offset;
          run.bullets.push({
            x: point.x,
            y: point.y,
            vx: Math.cos(angle) * 180,
            vy: Math.sin(angle) * 180,
            radius: 4,
            type: 'circle',
            damage: 8,
            color: '#f2b6ff',
          });
        }
        audio.play('bullet');
      }
    },
  };
  return spawner;
}

function createBlinkSpawner() {
  const spawner = {
    id: 'blink',
    timer: 0,
    tick(run, dt) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = rand(1.8, 2.8);
        const spawnX = clamp(run.player.x + rand(-120, 120), 30, WIDTH - 30);
        const spawnY = clamp(run.player.y + rand(-120, 120), 30, HEIGHT - 30);
        const angle = Math.atan2(run.player.y - spawnY, run.player.x - spawnX);
        const speed = 220;
        run.bullets.push({
          x: spawnX,
          y: spawnY,
          spawnX,
          spawnY,
          warning: 0.7,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          radius: 5,
          type: 'circle',
          damage: 12,
          color: '#ffec8f',
        });
        audio.play('bullet');
      }
    },
  };
  return spawner;
}

function createNovaSpawner() {
  const spawner = {
    id: 'nova',
    timer: 0,
    tick(run, dt) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = rand(3.8, 5.2);
        run.hazards.push({
          type: 'pod',
          x: rand(80, WIDTH - 80),
          y: rand(80, HEIGHT - 80),
          timer: 1.4,
          ttl: 1.4,
          radius: 16,
          damage: 10,
        });
      }
    },
  };
  return spawner;
}

function createSeekerSpawner() {
  const spawner = {
    id: 'seeker',
    timer: 0,
    tick(run, dt) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = rand(2.2, 3.2);
        run.bullets.push({
          x: rand(50, WIDTH - 50),
          y: rand(50, HEIGHT - 50),
          vx: rand(-30, 30),
          vy: rand(-30, 30),
          radius: 6,
          type: 'circle',
          damage: 10,
          color: '#ff6fd8',
          seek: 110,
          maxSpeed: 190,
        });
        audio.play('bullet');
      }
    },
  };
  return spawner;
}

function createCascadeSpawner() {
  const spawner = {
    id: 'cascade',
    timer: 0,
    tick(run, dt) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = rand(4, 5.5);
        run.hazards.push({
          type: 'cascade',
          x: rand(60, WIDTH - 60),
          y: rand(60, HEIGHT - 60),
          waves: 3,
          radius: 30,
          delay: 0.35,
          timer: 0.35,
          damage: 8,
        });
      }
    },
  };
  return spawner;
}

function createTunnelSpawner() {
  const spawner = {
    id: 'tunnel',
    timer: 0,
    tick(run, dt) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = rand(3, 4.4);
        const horizontal = Math.random() < 0.5;
        if (horizontal) {
          const y = rand(50, HEIGHT - 50);
          for (let x = 20; x < WIDTH; x += 60) {
            run.bullets.push({
              x,
              y,
              vx: 0,
              vy: rand(90, 140) * (Math.random() < 0.5 ? 1 : -1),
              radius: 4,
              damage: 7,
              type: 'circle',
              color: '#7ff7ff',
            });
          }
        } else {
          const x = rand(50, WIDTH - 50);
          for (let y = 20; y < HEIGHT; y += 60) {
            run.bullets.push({
              x,
              y,
              vx: rand(90, 140) * (Math.random() < 0.5 ? 1 : -1),
              vy: 0,
              radius: 4,
              damage: 7,
              type: 'circle',
              color: '#7ff7ff',
            });
          }
        }
        audio.play('bullet');
      }
    },
  };
  return spawner;
}

function createRainSpawner() {
  const spawner = {
    id: 'rain',
    timer: 0,
    tick(run, dt) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = rand(1.2, 1.6);
        const count = randInt(6, 10);
        for (let i = 0; i < count; i++) {
          run.bullets.push({
            x: rand(20, WIDTH - 20),
            y: -10,
            vx: rand(-10, 10),
            vy: rand(130, 200),
            radius: 3,
            type: 'circle',
            damage: 5,
            color: '#ffa4a4',
          });
        }
        audio.play('bullet');
      }
    },
  };
  return spawner;
}

function createSpiralSpawner() {
  let angle = 0;
  const spawner = {
    id: 'spiral',
    timer: 0,
    tick(run, dt) {
      this.timer -= dt;
      angle += dt * 2.2;
      if (this.timer <= 0) {
        this.timer = 0.6;
        const speed = 160;
        const offsets = [0, Math.PI];
        offsets.forEach((off) => {
          const theta = angle + off;
          run.bullets.push({
            x: WIDTH / 2,
            y: HEIGHT / 2,
            vx: Math.cos(theta) * speed,
            vy: Math.sin(theta) * speed,
            radius: 4,
            damage: 7,
            type: 'circle',
            color: '#c1a9ff',
          });
        });
        audio.play('bullet');
      }
    },
  };
  return spawner;
}

function getEdgePoint(edge) {
  switch (edge) {
    case 0:
      return { x: rand(0, WIDTH), y: -10 };
    case 1:
      return { x: WIDTH + 10, y: rand(0, HEIGHT) };
    case 2:
      return { x: rand(0, WIDTH), y: HEIGHT + 10 };
    default:
      return { x: -10, y: rand(0, HEIGHT) };
  }
}

function spawnRing(run, x, y, count, speed, color, damage = 10) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count;
    run.bullets.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: 4,
      type: 'circle',
      damage,
      color,
    });
  }
  audio.play('bullet');
}

function startSolo() {
  resetOverlays();
  state.mode = 'solo';
  state.run = createRun({ mode: 'solo', label: 'solo' });
  state.opponentRun = null;
  state.paused = false;
  state.awaitingChoice = false;
  state.warmup = 1.5;
  state.recentUnlocks = [];
  renderUnlockList();
  audio.startMusic();
}

function enterQueue() {
  resetOverlays();
  state.mode = 'queue';
  state.run = null;
  state.opponentRun = null;
  queueOverlay.classList.remove('hidden');
  queueMessage.textContent = 'Matching players across the grid...';
  clearQueueTimers();
  const fallback = 8000;
  state.queueDeadline = performance.now() + fallback;
  state.queueTicker = setInterval(() => {
    const remaining = Math.max(0, state.queueDeadline - performance.now());
    queueMessage.textContent = `Matching players... AI backup in ${(remaining / 1000).toFixed(1)}s`;
  }, 250);
  state.queueAIHandle = setTimeout(() => {
    queueMessage.textContent = 'No human rival arrived. Deploying adaptive AI...';
    state.queueTimeout = setTimeout(() => startPvp({ ai: true }), 1200);
  }, fallback);
  hudEl.innerHTML = '<div>Searching for duelists...</div>';
}

function startPvp({ ai = true } = {}) {
  resetOverlays();
  clearQueueTimers();
  queueOverlay.classList.add('hidden');
  state.mode = 'pvp';
  state.run = createRun({ mode: 'pvp', label: 'you', warmup: 3 });
  state.opponentRun = ai ? createAIRun() : null;
  state.paused = false;
  state.awaitingChoice = false;
  state.recentUnlocks = [];
  renderUnlockList();
  audio.startMusic();
}

function clearQueueTimers() {
  if (state.queueTimeout) {
    clearTimeout(state.queueTimeout);
    state.queueTimeout = null;
  }
  if (state.queueAIHandle) {
    clearTimeout(state.queueAIHandle);
    state.queueAIHandle = null;
  }
  if (state.queueTicker) {
    clearInterval(state.queueTicker);
    state.queueTicker = null;
  }
}

function createAIRun() {
  const run = createRun({ mode: 'pvp', label: 'opponent' });
  run.player.color = '#ffa4a4';
  run.skill = rand(1.2, 1.7);
  run.aiDamageTimer = 1;
  return run;
}

function resetOverlays() {
  clearQueueTimers();
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
  handleInput(run, delta);
  updateBullets(run, delta);
  updateHazards(run, delta);
  updateEffects(run, delta);
  if (run.flash > 0) {
    run.flash = Math.max(0, run.flash - delta);
  }
  if (run.player.hurtTimer > 0) {
    run.player.hurtTimer = Math.max(0, run.player.hurtTimer - delta);
  }

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

function handleInput(run, delta) {
  const player = run.player;
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

  const rushing = (keys.has('ShiftLeft') || keys.has('ShiftRight')) && len > 0;
  let speed = player.speed * player.speedMultiplier;
  let spending = false;
  if (rushing && player.stamina > 0) {
    speed *= player.rushMultiplier;
    player.stamina = Math.max(0, player.stamina - player.rushDrain * delta);
    spending = true;
    run.rushTrailTimer -= delta;
    if (run.rushTrailTimer <= 0) {
      addEffect(run, {
        type: 'rush',
        x: player.x,
        y: player.y,
        ttl: 0.3,
        radius: player.radius + 12,
      });
      run.rushTrailTimer = 0.05;
    }
  } else {
    run.rushTrailTimer = Math.max(0, run.rushTrailTimer - delta);
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
  const startX = player.x;
  const startY = player.y;
  player.x += norm.x * player.dashDistance;
  player.y += norm.y * player.dashDistance;
  player.x = Math.max(player.radius, Math.min(WIDTH - player.radius, player.x));
  player.y = Math.max(player.radius, Math.min(HEIGHT - player.radius, player.y));
  player.dashCooldown = player.dashCooldownBase;
  player.stamina = Math.max(0, player.stamina - player.dashCost);
  player.invuln = 0.3;
  player.staminaDelay = 1.4;
  addEffect(state.run, {
    type: 'dash',
    sx: startX,
    sy: startY,
    ex: player.x,
    ey: player.y,
    ttl: 0.35,
  });
  audio.play('dash');
}

document.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  audio.resume();
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
  audio.play('bullet');

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
  audio.play('bullet');
}

function addEffect(run, effect) {
  if (!run || !run.effects) return;
  run.effects.push({ ...effect, life: effect.ttl });
}

function updateEffects(run, delta) {
  if (!run.effects) return;
  run.effects = run.effects.filter((effect) => {
    effect.life -= delta;
    return effect.life > 0;
  });
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
    if (bullet.seek) {
      const dx = player.x - bullet.x;
      const dy = player.y - bullet.y;
      const len = Math.hypot(dx, dy) || 1;
      bullet.vx += ((dx / len) * bullet.seek * delta) / 10;
      bullet.vy += ((dy / len) * bullet.seek * delta) / 10;
      const limit = bullet.maxSpeed || 200;
      const speed = Math.hypot(bullet.vx, bullet.vy);
      if (speed > limit) {
        bullet.vx = (bullet.vx / speed) * limit;
        bullet.vy = (bullet.vy / speed) * limit;
      }
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
        applyDamage(run, player, bullet.damage);
        run.bullets.splice(i, 1);
      }
    } else if (bullet.type === 'square') {
      if (
        Math.abs(bullet.x - player.x) < bullet.size / 2 + player.radius &&
        Math.abs(bullet.y - player.y) < bullet.size / 2 + player.radius
      ) {
        applyDamage(run, player, bullet.damage);
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
              applyDamage(run, player, hazard.damage);
            }
          } else {
            if (Math.abs(player.x - hazard.offset) < hazard.width) {
              applyDamage(run, player, hazard.damage);
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
          applyDamage(run, player, hazard.damage);
        }
      }
      hazard.fade = Math.max(0, (hazard.fade || 0) - delta);
      if (!hazard.active && hazard.fade <= 0 && hazard.timer > hazard.blink) {
        run.hazards.splice(i, 1);
      }
    } else if (hazard.type === 'pod') {
      hazard.timer -= delta;
      if (hazard.timer <= 0) {
        spawnRing(run, hazard.x, hazard.y, 14, 160, '#ff7b7b', hazard.damage);
        run.hazards.splice(i, 1);
      }
    } else if (hazard.type === 'cascade') {
      hazard.timer -= delta;
      if (hazard.timer <= 0) {
        hazard.timer = hazard.delay;
        hazard.waves -= 1;
        const radius = hazard.radius * (4 - hazard.waves);
        spawnRing(run, hazard.x, hazard.y, 18, 90 + radius * 0.5, '#ffd36f', hazard.damage);
        if (hazard.waves <= 0) {
          run.hazards.splice(i, 1);
        }
      }
    }
  }
}

function applyDamage(run, player, dmg) {
  player.hp = Math.max(0, player.hp - dmg);
  if (run === state.run) {
    player.hurtTimer = 0.4;
    player.invuln = Math.max(player.invuln, 0.2);
    run.flash = 0.25;
    addEffect(run, {
      type: 'hurt',
      x: player.x,
      y: player.y,
      ttl: 0.35,
      radius: 30,
    });
    audio.play('hurt');
  }
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
      applyDamage(run, run.player, rand(6, 14));
    }
  }
}

function applyRandomChoice(run) {
  const pool = getChoicePool(run);
  const choice = pool[randInt(0, pool.length - 1)] || CHOICES[0];
  applyChoice(choice, run);
}

function presentChoices(run, opponentChoice = false) {
  state.paused = !opponentChoice;
  state.awaitingChoice = !opponentChoice;
  if (opponentChoice) return;
  const options = getChoiceOptions(run);
  choiceOverlay.classList.remove('hidden');
  canvas.classList.add('blur');
  audio.play('choice');
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
    applyChoice(choice, target);
    if (state.mode === 'pvp') {
      applyRandomChoice(state.run);
    }
    state.paused = false;
    state.awaitingChoice = false;
    audio.play('choice');
  }
}

function applyChoice(choice, run) {
  choice.apply(run);
  run.player.choiceHistory.push(choice.id);
}

function getChoiceOptions(run) {
  const pool = getChoicePool(run);
  const total = Math.min(3, pool.length);
  const options = new Set();
  while (options.size < total && pool.length) {
    options.add(pool[randInt(0, pool.length - 1)]);
    if (pool.length <= options.size) break;
  }
  if (!options.size) {
    return CHOICES.slice(0, 3);
  }
  return [...options];
}

function getChoicePool(run) {
  if (!run.choicePool || !run.choicePool.length) {
    run.choicePool = snapshotChoicePool();
  }
  const pool = run.choicePool.map((id) => CHOICE_LOOKUP[id]).filter(Boolean);
  return pool.length ? pool : CHOICES;
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

function drawEffects(run) {
  if (!run.effects) return;
  run.effects.forEach((effect) => {
    const pct = Math.max(0, effect.life / effect.ttl);
    if (effect.type === 'rush') {
      ctx.strokeStyle = `rgba(127,247,255,${pct * 0.5})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, (effect.radius || 12) * (1 - pct) + 6, 0, Math.PI * 2);
      ctx.stroke();
    } else if (effect.type === 'dash') {
      ctx.strokeStyle = `rgba(255,255,255,${pct * 0.6})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(effect.sx, effect.sy);
      ctx.lineTo(effect.ex, effect.ey);
      ctx.stroke();
    } else if (effect.type === 'hurt') {
      ctx.strokeStyle = `rgba(255,80,80,${pct})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, effect.radius * (1 - pct) + 10, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

function drawRun(run) {
  const player = run.player;
  drawEffects(run);

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
    } else if (hazard.type === 'pod') {
      const pct = hazard.timer / hazard.ttl;
      ctx.strokeStyle = `rgba(255,200,140,${pct})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hazard.x, hazard.y, hazard.radius + (1 - pct) * 20, 0, Math.PI * 2);
      ctx.stroke();
    } else if (hazard.type === 'cascade') {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(hazard.x, hazard.y, hazard.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  });

  ctx.fillStyle = player.hurtTimer > 0 ? '#ff9292' : player.color;
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
  ctx.fill();
  if (run.flash > 0) {
    ctx.fillStyle = `rgba(255,80,80,${run.flash * 0.4})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
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
  const chips = player.choiceHistory.length
    ? player.choiceHistory
        .slice(-6)
        .map((id) => `<span class="choice-chip">${CHOICE_LOOKUP[id]?.name || id}</span>`)
        .join('')
    : '<span class="choice-chip empty">No curses yet</span>';
  let opponentBlock = '';
  if (state.mode === 'pvp' && state.opponentRun) {
    const foe = state.opponentRun.player;
    const foePct = Math.max(0, Math.min(1, foe.hp / foe.hpMax || 0));
    opponentBlock = `
      <div class="meter">
        <span class="meter-label">OPP</span>
        <div class="meter-track"><span style="width:${foePct * 100}%"></span></div>
        <span>${foe.hp.toFixed(0)}</span>
      </div>
      <div>Opponent curses: ${state.opponentRun.player.choiceHistory.length}</div>
    `;
  }
  hudEl.innerHTML = `
    <div>Mode: ${state.mode === 'pvp' ? '1v1 Duel' : 'Solo Roguelike'}</div>
    <div>Time survived: ${run.time.toFixed(1)}s</div>
    ${meterMarkup('HP', hpPct, `${player.hp.toFixed(0)} / ${player.hpMax}`, 'hp')}
    ${meterMarkup('ST', staminaPct, `${player.stamina.toFixed(0)} / ${player.staminaMax}`)}
    <div>Next choice in ${Math.max(0, run.nextChoice).toFixed(1)}s</div>
    <div class="choice-chips">${chips}</div>
    ${opponentBlock}
  `;
}

function meterMarkup(label, value, text, extraClass = '') {
  const pct = Math.max(0, Math.min(1, value || 0)) * 100;
  return `
    <div class="meter ${extraClass}">
      <span class="meter-label">${label}</span>
      <div class="meter-track"><span style="width:${pct}%"></span></div>
      <span>${text}</span>
    </div>
  `;
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
  state.recentUnlocks = awardUnlocks(state.run, result);
  renderUnlockList();
  if (state.mode === 'solo') {
    updateLeaderboard(state.run);
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
  state.recentUnlocks = [];
  resetOverlays();
  hudEl.innerHTML = '<p>Select a mode to begin.</p>';
  renderUnlockList();
  audio.stopMusic();
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
      unlockedChoices: getInitialUnlockedChoiceIds(),
    };
  }
  const record = state.accounts[key];
  if (record.password !== hashed) {
    alert('Password mismatch.');
    return;
  }
  record.unlockedChoices = sanitizeUnlocked(record.unlockedChoices);
  state.account = record;
  state.accountKey = key;
  saveAccounts(state.accounts);
  renderAccountStats();
  renderUnlockList();
});

logoutBtn.addEventListener('click', () => {
  state.account = null;
  state.accountKey = null;
  accountStatsEl.innerHTML = '<p>Signed out.</p>';
  renderUnlockList();
});

function renderAccountStats() {
  if (!state.account) {
    accountStatsEl.innerHTML = '<p>Playing as guest. Sign in to save unlocks.</p>';
    renderUnlockList();
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
  renderUnlockList();
}

function renderUnlockList() {
  if (!unlockListEl) return;
  if (!state.account) {
    unlockListEl.innerHTML = '<span>Sign in to unlock more curses.</span>';
    return;
  }
  if (!state.recentUnlocks.length) {
    unlockListEl.innerHTML = '<span>No new curses earned this run.</span>';
    return;
  }
  unlockListEl.innerHTML = state.recentUnlocks.map((name) => `<span>${name}</span>`).join('');
}

function awardUnlocks(run, result) {
  if (!state.account || !state.accountKey) return [];
  const data = state.accounts[state.accountKey];
  data.unlockedChoices = sanitizeUnlocked(data.unlockedChoices);
  const locked = CHOICES.map((choice) => choice.id).filter(
    (id) => !data.unlockedChoices.includes(id),
  );
  if (!locked.length) return [];
  let unlockCount = Math.floor(run.time / 40);
  if (run.mode === 'solo') {
    unlockCount += Math.floor(run.time / 70);
  }
  if (run.mode === 'pvp' && result === 'win') {
    unlockCount += 1;
  }
  unlockCount = Math.min(locked.length, unlockCount);
  if (unlockCount <= 0) return [];
  const awarded = locked.slice(0, unlockCount);
  data.unlockedChoices.push(...awarded);
  saveAccounts(state.accounts);
  renderAccountStats();
  return awarded.map((id) => CHOICE_LOOKUP[id]?.name || id);
}

function getUnlockedChoiceIds() {
  if (state.account && state.accountKey && state.accounts[state.accountKey]) {
    const data = state.accounts[state.accountKey];
    data.unlockedChoices = sanitizeUnlocked(data.unlockedChoices);
    return [...data.unlockedChoices];
  }
  return getInitialUnlockedChoiceIds();
}

function getInitialUnlockedChoiceIds() {
  return CHOICES.slice(0, 10).map((choice) => choice.id);
}

function sanitizeUnlocked(list = []) {
  const allowed = CHOICES.map((choice) => choice.id);
  const set = new Set();
  list.forEach((id) => {
    if (allowed.includes(id)) {
      set.add(id);
    }
  });
  if (!set.size) {
    getInitialUnlockedChoiceIds().forEach((id) => set.add(id));
  }
  return [...set];
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

function createAudioSuite() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    return {
      play() {},
      startMusic() {},
      stopMusic() {},
      resume() {},
      bindButtons() {},
    };
  }
  const ctx = new AudioCtx();
  const master = ctx.createGain();
  master.gain.value = 0.45;
  master.connect(ctx.destination);
  const sfxGain = ctx.createGain();
  sfxGain.gain.value = 0.7;
  sfxGain.connect(master);
  const musicGain = ctx.createGain();
  musicGain.gain.value = 0.15;
  musicGain.connect(master);
  let musicInterval = null;
  let lastBullet = 0;

  function resume() {
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
  }

  function blip(freq, duration, gainValue, type = 'sine', target = sfxGain) {
    resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(target);
    gain.gain.value = gainValue;
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  function noise(duration, gainValue) {
    resume();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(sfxGain);
    gain.gain.value = gainValue;
    source.start();
    source.stop(ctx.currentTime + duration);
  }

  function play(name) {
    switch (name) {
      case 'dash':
        blip(420, 0.15, 0.25, 'sawtooth');
        break;
      case 'choice':
        blip(280, 0.18, 0.2, 'triangle');
        break;
      case 'bullet': {
        const now = ctx.currentTime;
        if (now - lastBullet > 0.08) {
          lastBullet = now;
          noise(0.08, 0.18);
        }
        break;
      }
      case 'hurt':
        noise(0.2, 0.3);
        break;
      case 'ui':
        blip(600, 0.08, 0.15, 'triangle');
        break;
      default:
        break;
    }
  }

  function startMusic() {
    resume();
    if (musicInterval) return;
    const notes = [220, 0, 330, 0, 392, 0, 294, 0];
    let index = 0;
    musicInterval = setInterval(() => {
      if (ctx.state === 'suspended') return;
      const note = notes[index % notes.length];
      if (note) {
        blip(note, 0.3, 0.1, 'triangle', musicGain);
      }
      index += 1;
    }, 450);
  }

  function stopMusic() {
    if (musicInterval) {
      clearInterval(musicInterval);
      musicInterval = null;
    }
  }

  function bindButtons() {
    document.addEventListener('click', (event) => {
      if (event.target.closest && event.target.closest('button')) {
        play('ui');
      }
    });
  }

  return { play, startMusic, stopMusic, resume, bindButtons };
}

function loadLeaderboard() {
  try {
    const raw = localStorage.getItem('dot-matrix-leaderboard');
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    return [];
  }
}

function saveLeaderboard(list) {
  localStorage.setItem('dot-matrix-leaderboard', JSON.stringify(list));
}

function updateLeaderboard(run) {
  const entry = {
    name: state.account ? state.account.nickname : 'Guest',
    time: Number(run.time.toFixed(1)),
    date: new Date().toISOString(),
  };
  state.leaderboard.push(entry);
  state.leaderboard.sort((a, b) => b.time - a.time);
  state.leaderboard = state.leaderboard.slice(0, 10);
  saveLeaderboard(state.leaderboard);
  renderLeaderboard();
}

function renderLeaderboard() {
  if (!soloLeaderboardEl) return;
  if (!state.leaderboard.length) {
    soloLeaderboardEl.innerHTML = '<li class="empty">No runs recorded yet.</li>';
    return;
  }
  soloLeaderboardEl.innerHTML = state.leaderboard
    .map((entry) => `<li><span>${entry.name}</span><span>${entry.time.toFixed(1)}s</span></li>`)
    .join('');
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
renderUnlockList();
renderLeaderboard();
audio.bindButtons();
window.addEventListener('pointerdown', () => audio.resume());
