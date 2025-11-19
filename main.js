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
const BASE_SPAWN = 2.45;
const BASE_SPAWN_ACCEL = 0.0035;
const CHOICE_INTERVAL = 18;
const CHOICE_DURATION = 9;
const HEAL_INTERVAL = 60;
const HEAL_AMOUNT = 12;
const ARMOR_DURATION = 1;
const AI_FALLBACK_MS = 30000;
const BASE_UNLOCK_COUNT = 10;
const BASE_BULLET_CAP = 120;

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
      'You move quicker, but every encore dials bullets faster and denser. Stacks raise both extremes.',
    apply: (run, stack) => {
      run.player.speedMultiplier *= 1.08;
      const surge = 1.25 + (stack - 1) * 0.12;
      run.bulletSpeed *= surge;
      run.spawnRate *= surge;
      run.danger += 0.3 + stack * 0.05;
    },
  },
  {
    id: 'laserChaos',
    name: 'Laser Chaos',
    description: 'Rapid beam walls telegraph briefly then sear straight lines. More stacks mean more beams.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'laser', createLaserSpawner);
      spawner.level = stack;
      run.danger += 0.35 + stack * 0.05;
    },
  },
  {
    id: 'staminaLeak',
    name: 'Stamina Leak',
    description: 'Rush drain and regen penalties stack, though max stamina creeps upward.',
    apply: (run, stack) => {
      run.player.staminaMax += 8;
      run.player.stamina = Math.min(run.player.stamina, run.player.staminaMax);
      run.player.staminaRegen *= 0.55;
      run.player.rushDrain *= 1.2;
      if (stack > 1) {
        run.player.staminaRegen *= 0.8;
        run.player.rushDrain *= 1.1;
      }
      run.danger += 0.22 + stack * 0.03;
    },
  },
  {
    id: 'tilePhantom',
    name: 'Phantom Tiles',
    description: 'Blinking squares slam down anywhere. Extra stacks widen and quicken the pattern.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'tile', createTileSpawner);
      spawner.level = stack;
      run.danger += 0.3 + stack * 0.04;
    },
  },
  {
    id: 'mirrorBloom',
    name: 'Mirror Bloom',
    description: 'Random bullets duplicate into mirrored twins. Each stack lowers the interval.',
    apply: (run, stack) => {
      run.mirrorBloom = true;
      run.mirrorBloomLevel = stack;
      run.player.dashCooldownBase *= 1.12;
      run.danger += 0.26 + stack * 0.05;
    },
  },
  {
    id: 'gravityFlood',
    name: 'Gravity Flood',
    description: 'All projectiles swell and arc toward you. Stacks intensify the pull.',
    apply: (run, stack) => {
      run.gravityPull = stack;
      run.player.dashDistance = Math.max(70, run.player.dashDistance * 0.85);
      run.danger += 0.33 + stack * 0.06;
    },
  },
  {
    id: 'shardStorm',
    name: 'Shard Storm',
    description: 'Telegraphed bursts seed plus-mark warnings before firing radial shards.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'shard', createShardSpawner);
      spawner.level = stack;
      run.danger += 0.28 + stack * 0.05;
    },
  },
  {
    id: 'voidHiss',
    name: 'Void Hiss',
    description: 'Choice timers shrink and your maximum HP drops with each whisper.',
    apply: (run, stack) => {
      run.choiceInterval = Math.max(8, run.choiceInterval * 0.9);
      run.player.hpMax = Math.max(20, run.player.hpMax - 8);
      run.player.hp = Math.min(run.player.hp, run.player.hpMax);
      run.danger += 0.24 + stack * 0.04;
    },
  },
  {
    id: 'haloDrift',
    name: 'Halo Drift',
    description: 'Orbiting emitters lob beads around you. Extra stacks add emitters.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'halo', createHaloSpawner);
      spawner.level = stack;
      run.danger += 0.32 + stack * 0.05;
    },
  },
  {
    id: 'meteorRain',
    name: 'Meteor Rain',
    description: 'Heavy blocks fall with short warnings. Stacks drop more at once.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'meteor', createMeteorSpawner);
      spawner.level = stack;
      run.danger += 0.3 + stack * 0.05;
    },
  },
  {
    id: 'fanQuills',
    name: 'Fan Quills',
    description: 'Edge cannons sweep in fan volleys that thicken with stacks.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'fan', createFanSpawner);
      spawner.level = stack;
      run.danger += 0.28 + stack * 0.05;
    },
  },
  {
    id: 'blinkNeedles',
    name: 'Blink Needles',
    description: 'Teleporting needles mark the floor, then streak outward in greater numbers per stack.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'blink', createBlinkSpawner);
      spawner.level = stack;
      run.danger += 0.26 + stack * 0.05;
    },
  },
  {
    id: 'novaGarden',
    name: 'Nova Garden',
    description: 'Pods sprout, pulse, and detonate into wide rings. More stacks mean denser pods.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'nova', createNovaSpawner);
      spawner.level = stack;
      run.danger += 0.32 + stack * 0.05;
    },
  },
  {
    id: 'seekerFlare',
    name: 'Seeker Flares',
    description: 'Slow orbs ignite, then steer toward your last position. Stacks quicken ignition.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'seeker', createSeekerSpawner);
      spawner.level = stack;
      run.danger += 0.3 + stack * 0.04;
    },
  },
  {
    id: 'ringCascade',
    name: 'Ring Cascade',
    description: 'Sequential rings ripple outward. Each stack adds an extra wave.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'cascade', createCascadeSpawner);
      spawner.level = stack;
      run.danger += 0.34 + stack * 0.05;
    },
  },
  {
    id: 'riftStrafe',
    name: 'Rift Strafe',
    description: 'Columns sweep across the arena. Stacks reduce downtime.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'tunnel', createTunnelSpawner);
      spawner.level = stack;
      run.danger += 0.3 + stack * 0.05;
    },
  },
  {
    id: 'emberFlurry',
    name: 'Ember Flurry',
    description: 'Micro embers rain from above. Stacks make them faster and hotter.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'rain', createRainSpawner);
      spawner.level = stack;
      run.danger += 0.25 + stack * 0.05;
    },
  },
  {
    id: 'spiralSnare',
    name: 'Spiral Snare',
    description: 'Spiral launchers spin faster every stack, doubling their paired bolts.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'spiral', createSpiralSpawner);
      spawner.level = stack;
      run.danger += 0.3 + stack * 0.05;
    },
  },
  {
    id: 'ruptureBloom',
    name: 'Rupture Bloom',
    description: 'Large glowing seeds mark the floor, then explode into shard halos.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'rupture', () => createRuptureSpawner('rupture'));
      spawner.level = stack;
      run.danger += 0.32 + stack * 0.05;
    },
  },
  {
    id: 'emberPulse',
    name: 'Ember Pulse',
    description: 'Clusters of embers pop near you, sending fiery arcs outward.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'pulse', () => createPulseSpawner('pulse'));
      spawner.level = stack;
      run.danger += 0.3 + stack * 0.05;
    },
  },
  {
    id: 'sunSpire',
    name: 'Sun Spire',
    description: 'Warning pillars erupt upward and burst into vertical sprays.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'spire', () => createSpireSpawner('spire'));
      spawner.level = stack;
      run.danger += 0.33 + stack * 0.05;
    },
  },
  {
    id: 'gloomMines',
    name: 'Gloom Mines',
    description: 'Large mines drop in and detonate into crossfire when approached.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'mine', () => createMineSpawner('mine'));
      spawner.level = stack;
      run.danger += 0.31 + stack * 0.05;
    },
  },
  {
    id: 'lanternOrbit',
    name: 'Lantern Orbit',
    description: 'Orbiting lanterns trail you then detonate. Stacks add lanterns.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'lantern', () => createLanternSpawner('lantern'));
      spawner.level = stack;
      run.danger += 0.3 + stack * 0.05;
    },
  },
  {
    id: 'prismVolley',
    name: 'Prism Volley',
    description: 'Prismatic volleys carve across diagonals, thickening each stack.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'volley', () => createVolleySpawner('volley'));
      spawner.level = stack;
      run.danger += 0.3 + stack * 0.05;
    },
  },
  {
    id: 'voidComet',
    name: 'Void Comets',
    description: 'Slow comets streak in with trails and explode on impact.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'comet', () => createCometSpawner('comet'));
      spawner.level = stack;
      run.danger += 0.3 + stack * 0.05;
    },
  },
  {
    id: 'mirrorEcho',
    name: 'Mirror Echo',
    description: 'Illusory clones dash forward then burst. Stacks spawn more clones.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'echo', () => createEchoSpawner('echo'));
      spawner.level = stack;
      run.danger += 0.29 + stack * 0.05;
    },
  },
  {
    id: 'tideBreaker',
    name: 'Tide Breaker',
    description: 'Floor geysers surge upward in waves and explode outward.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'geyser', () => createGeyserSpawner('geyser'));
      spawner.level = stack;
      run.danger += 0.33 + stack * 0.05;
    },
  },
  {
    id: 'shockFracture',
    name: 'Shock Fracture',
    description: 'Lightning fractures mark a line then detonate sequentially.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'fracture', () => createFractureSpawner('fracture'));
      spawner.level = stack;
      run.danger += 0.34 + stack * 0.05;
    },
  },
  {
    id: 'emberBloom',
    name: 'Ember Bloom',
    description: 'Explosive pollen drifts slowly, then detonates into spirals.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'emberBloom', () => createBloomSpawner('emberBloom'));
      spawner.level = stack;
      run.danger += 0.31 + stack * 0.05;
    },
  },
  {
    id: 'chainCataclysm',
    name: 'Chain Cataclysm',
    description: 'Linked explosions crawl across the arena once armed.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'chain', () => createChainSpawner('chain'));
      spawner.level = stack;
      run.danger += 0.35 + stack * 0.05;
    },
  },
];

const waveCurseConfigs = [
  {
    id: 'zigzagVeil',
    name: 'Zigzag Veil',
    description: 'Thin lances zigzag from the arena edges. Stacks add lanes and sharper turns.',
    danger: { base: 0.27, scale: 0.04 },
    options: {
      axis: 'horizontal',
      path: 'zigzag',
      lanes: 2,
      color: '#f5ff7a',
      shape: 'triangle',
      zigzag: 95,
      cooldown: [2.4, 3.2],
    },
  },
  {
    id: 'sineTangle',
    name: 'Sine Tangle',
    description: 'Wavy ribbons slither from top and bottom. Stacks widen their sway.',
    danger: { base: 0.27, scale: 0.04 },
    options: {
      axis: 'vertical',
      path: 'sine',
      lanes: 2,
      amplitude: 60,
      color: '#9bd3ff',
      shape: 'diamond',
      cooldown: [2.6, 3.4],
    },
  },
  {
    id: 'cosmicRipple',
    name: 'Cosmic Ripple',
    description: 'Slow aurora orbs surf in sinusoidal paths from the sides.',
    danger: { base: 0.26, scale: 0.04 },
    options: {
      axis: 'horizontal',
      path: 'sine',
      lanes: 1,
      amplitude: 80,
      speed: 120,
      color: '#d9b8ff',
      shape: 'ring',
      cooldown: [3, 4],
    },
  },
  {
    id: 'pincerDrift',
    name: 'Pincer Drift',
    description: 'Vertical zigzag drills descend in mirrored pairs. Stacks shrink their gaps.',
    danger: { base: 0.3, scale: 0.04 },
    options: {
      axis: 'vertical',
      path: 'zigzag',
      lanes: 3,
      zigzag: 110,
      color: '#ffbaba',
      shape: 'triangle',
      cooldown: [2.8, 3.6],
    },
  },
  {
    id: 'spectrumRift',
    name: 'Spectrum Rift',
    description: 'Hex prisms surf sideways in layered s-curves.',
    danger: { base: 0.28, scale: 0.05 },
    options: {
      axis: 'horizontal',
      path: 'sine',
      lanes: 3,
      amplitude: 45,
      color: '#a7ffe7',
      shape: 'hex',
      speed: 140,
      cooldown: [2.2, 3],
    },
  },
  {
    id: 'zigzagTango',
    name: 'Zigzag Tango',
    description: 'Opposing zigzag dancers drop from the sky and floor.',
    danger: { base: 0.29, scale: 0.05 },
    options: {
      axis: 'vertical',
      path: 'zigzag',
      lanes: 2,
      zigzag: 85,
      color: '#ffd4a3',
      shape: 'diamond',
      cooldown: [2.1, 2.8],
    },
  },
];

const retreatCurseConfigs = [
  {
    id: 'retreatSaw',
    name: 'Retreat Saw',
    description: 'Starbursts rush forward, stall, then reverse. Stacks make their armor runs longer.',
    danger: { base: 0.28, scale: 0.05 },
    options: {
      color: '#ffa17a',
      shape: 'diamond',
      pause: 0.3,
      advance: 0.55,
      speed: 190,
    },
  },
  {
    id: 'echoRetreat',
    name: 'Echo Retreat',
    description: 'Glowing rings blink in, freeze time briefly, then recoil faster than they arrived.',
    danger: { base: 0.27, scale: 0.05 },
    options: {
      color: '#9de3ff',
      shape: 'ring',
      pause: 0.45,
      advance: 0.65,
      speed: 170,
    },
  },
];

const lockerCurseConfigs = [
  {
    id: 'lockerLockdown',
    name: 'Locker Lockdown',
    description: 'Massive lockers drop with warnings before bursting keys in all directions.',
    danger: { base: 0.29, scale: 0.05 },
    options: {
      size: 26,
      burst: 6,
      color: '#ffd166',
      cooldown: [4, 5],
    },
  },
  {
    id: 'vaultSnap',
    name: 'Vault Snap',
    description: 'Chunky vaults crash down, linger, then shatter into shards.',
    danger: { base: 0.31, scale: 0.05 },
    options: {
      size: 30,
      burst: 8,
      color: '#ffc371',
      cooldown: [4.5, 5.8],
    },
  },
];

const latticeCurseConfigs = [
  {
    id: 'latticeGlass',
    name: 'Lattice Glass',
    description: 'Telegraphed panes descend in grids. Stacks increase the grid density.',
    danger: { base: 0.27, scale: 0.05 },
    options: {
      cells: 3,
      color: '#94e2ff',
      speed: 130,
      shape: 'square',
    },
  },
  {
    id: 'gridMires',
    name: 'Grid Mires',
    description: 'Sticky lattice lockers drop slower but with more tiles each stack.',
    danger: { base: 0.28, scale: 0.05 },
    options: {
      cells: 4,
      color: '#ff8fc7',
      speed: 110,
      shape: 'locker',
    },
  },
];

const stopGoCurseConfigs = [
  {
    id: 'stasisMarch',
    name: 'Stasis March',
    description: 'Columns surge, freeze, then march again. Stacks reduce the breathing room.',
    danger: { base: 0.26, scale: 0.05 },
    options: {
      axis: 'horizontal',
      color: '#9df7d2',
      idle: 0.45,
      move: 1.15,
      speed: 160,
      shape: 'square',
    },
  },
  {
    id: 'anchorDrift',
    name: 'Anchor Drift',
    description: 'Diamond anchors drift diagonally, halt, then burst back into motion.',
    danger: { base: 0.28, scale: 0.05 },
    options: {
      axis: 'diagonal',
      color: '#ffa5dd',
      idle: 0.35,
      move: 1.3,
      speed: 150,
      shape: 'diamond',
    },
  },
  {
    id: 'guardianStop',
    name: 'Guardian Stop',
    description: 'Hex sentinels slam vertically, pause, and resume. Stacks stack the squads.',
    danger: { base: 0.29, scale: 0.05 },
    options: {
      axis: 'vertical',
      color: '#ffd1f0',
      idle: 0.5,
      move: 1.4,
      speed: 165,
      shape: 'hex',
    },
  },
];

const growthCurseConfigs = [
  {
    id: 'bloomingMotes',
    name: 'Blooming Motes',
    description: 'Orbs inflate and deflate before detonating. Stacks widen their radius swing.',
    danger: { base: 0.26, scale: 0.04 },
    options: {
      grow: true,
      color: '#fff06f',
      shape: 'ring',
    },
  },
  {
    id: 'dimmingStars',
    name: 'Dimming Stars',
    description: 'Tiny stars blink smaller before bursting forward.',
    danger: { base: 0.25, scale: 0.04 },
    options: {
      grow: false,
      color: '#9ac8ff',
      shape: 'star',
    },
  },
];

const burstCurseConfigs = [
  {
    id: 'emberSatchel',
    name: 'Ember Satchel',
    description: 'Bulky satchels telegraph before erupting into slow magma squares.',
    danger: { base: 0.29, scale: 0.05 },
    options: {
      color: '#ffba70',
      count: 6,
      shape: 'square',
      cooldown: [4, 5.2],
    },
  },
  {
    id: 'petalScatter',
    name: 'Petal Scatter',
    description: 'Petal seeds burst into sweeping rings. Stacks add more petals.',
    danger: { base: 0.28, scale: 0.05 },
    options: {
      color: '#ffa3d5',
      count: 8,
      shape: 'triangle',
      cooldown: [3.8, 4.8],
    },
  },
  {
    id: 'voidKnock',
    name: 'Void Knock',
    description: 'Locker seals crack and emit locker-shaped shrapnel.',
    danger: { base: 0.3, scale: 0.05 },
    options: {
      color: '#c7b1ff',
      count: 5,
      shape: 'locker',
      cooldown: [4.2, 5.5],
    },
  },
];

const autoConfigGroups = [
  { configs: waveCurseConfigs, factory: createWaveSpawner },
  { configs: retreatCurseConfigs, factory: createRetreatSpawner },
  { configs: lockerCurseConfigs, factory: createLockerSpawner },
  { configs: latticeCurseConfigs, factory: createLatticeSpawner },
  { configs: stopGoCurseConfigs, factory: createStopGoSpawner },
  { configs: growthCurseConfigs, factory: createGrowthSpawner },
  { configs: burstCurseConfigs, factory: createBurstSeedSpawner },
];

autoConfigGroups.forEach(({ configs, factory }) => {
  configs.forEach((config) => {
    CHOICES.push({
      id: config.id,
      name: config.name,
      description: config.description,
      apply: (run, stack) => {
        const spawner = ensureSpawner(run, config.id, () => factory(config.id, config.options));
        spawner.level = stack;
        run.danger += config.danger.base + stack * config.danger.scale;
      },
    });
  });
});

const reducedCount = Math.ceil(CHOICES.length / 2);
if (CHOICES.length > reducedCount) {
  CHOICES.splice(reducedCount);
}

const CHOICE_LOOKUP = Object.fromEntries(CHOICES.map((choice) => [choice.id, choice]));

function createPlayer() {
  return {
    x: WIDTH / 2,
    y: HEIGHT / 2,
    radius: 8.5,
    color: '#e4f4ff',
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
    dashDistance: 110,
    dashCooldownBase: 1.1,
    dashCooldown: 0,
    dashCost: 25,
    invuln: 0,
    armorTimer: 0,
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
    spawnAcceleration: BASE_SPAWN_ACCEL,
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
    healTimer: HEAL_INTERVAL,
    pickups: [],
    choiceStacks: {},
    mirrorBloomLevel: 0,
  };
}

function snapshotChoicePool() {
  return getUnlockedChoiceIds();
}

function ensureSpawner(run, id, factory) {
  let spawner = run.extraSpawners.find((s) => s.id === id);
  if (!spawner) {
    spawner = factory();
    run.extraSpawners.push(spawner);
  }
  return spawner;
}

function createLaserSpawner() {
  const spawner = {
    id: 'laser',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.35;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        spawnLaser(run, spawner.level);
        spawner.timer = rand(4.5, 6.5) / haste;
      }
    },
  };
  return spawner;
}

function createTileSpawner() {
  const spawner = {
    id: 'tile',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.25;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        spawnTileHazard(run, spawner.level);
        spawner.timer = rand(3.5, 5.5) / haste;
      }
    },
  };
  return spawner;
}

function createShardSpawner() {
  const spawner = {
    id: 'shard',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.3;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        queueShardBurst(run, spawner.level);
        spawner.timer = rand(2.8, 4.5) / haste;
      }
    },
  };
  return spawner;
}

function createHaloSpawner() {
  let angle = 0;
  const spawner = {
    id: 'halo',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const rate = 0.85 + spawner.level * 0.12;
      spawner.timer -= dt * rate;
      angle += dt * rate;
      if (spawner.timer <= 0) {
        const emitters = 2 + Math.floor(spawner.level * 0.8);
        const count = 6 + spawner.level * 3;
        for (let i = 0; i < count; i++) {
          const theta = angle + (Math.PI * 2 * i) / count;
          run.bullets.push({
            x: WIDTH / 2 + Math.cos(theta) * (20 + emitters * 6),
            y: HEIGHT / 2 + Math.sin(theta) * (20 + emitters * 6),
            vx: Math.cos(theta) * (130 + spawner.level * 20),
            vy: Math.sin(theta) * (130 + spawner.level * 20),
            radius: 4 + spawner.level * 0.4,
            type: 'circle',
            damage: 7 + spawner.level * 1.5,
            color: '#9ef1ff',
          });
        }
        audio.play('bullet');
        spawner.timer = rand(1.8, 2.5) / rate;
      }
    },
  };
  return spawner;
}

function createMeteorSpawner() {
  const spawner = {
    id: 'meteor',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const drops = 1 + Math.floor(spawner.level / 2);
        for (let i = 0; i < drops; i++) {
          run.bullets.push({
            x: rand(30, WIDTH - 30),
            y: -30,
            vx: rand(-40, 40),
            vy: rand(110, 170) * run.bulletSpeed,
            size: rand(18, 28) + spawner.level * 2,
            type: 'square',
            damage: 16 + spawner.level * 3,
            color: '#ff9c5b',
            warning: 0.4,
            spawnX: rand(40, WIDTH - 40),
            spawnY: rand(20, HEIGHT / 2),
          });
        }
        audio.play('bullet');
        spawner.timer = rand(2.6, 3.8) / haste;
      }
    },
  };
  return spawner;
}

function createFanSpawner() {
  const spawner = {
    id: 'fan',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const edge = randInt(0, 3);
        const point = getEdgePoint(edge);
        const baseAngle = edge === 0 ? Math.PI / 2 : edge === 1 ? Math.PI : edge === 2 ? -Math.PI / 2 : 0;
        const count = 4 + Math.floor(spawner.level * 0.8);
        for (let i = 0; i < count; i++) {
          const offset = ((i - (count - 1) / 2) / Math.max(1, count - 1)) * (Math.PI / 3);
          const angle = baseAngle + offset;
          run.bullets.push({
            x: point.x,
            y: point.y,
            vx: Math.cos(angle) * (160 + spawner.level * 20),
            vy: Math.sin(angle) * (160 + spawner.level * 20),
            radius: 4,
            type: 'circle',
            damage: 7 + spawner.level,
            color: '#f2b6ff',
          });
        }
        audio.play('bullet');
        spawner.timer = rand(2.2, 3.3) / haste;
      }
    },
  };
  return spawner;
}

function createBlinkSpawner() {
  const spawner = {
    id: 'blink',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.25;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const waves = 1 + Math.floor(spawner.level / 2);
        for (let i = 0; i < waves; i++) {
          const spawnX = clamp(run.player.x + rand(-140, 140), 30, WIDTH - 30);
          const spawnY = clamp(run.player.y + rand(-140, 140), 30, HEIGHT - 30);
          const angle = Math.atan2(run.player.y - spawnY, run.player.x - spawnX);
          const speed = 220 + spawner.level * 15;
          run.bullets.push({
            x: spawnX,
            y: spawnY,
            spawnX,
            spawnY,
            warning: 0.65,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            radius: 5,
            type: 'circle',
            damage: 10 + spawner.level,
            color: '#ffec8f',
          });
        }
        audio.play('bullet');
        spawner.timer = rand(1.6, 2.4) / haste;
      }
    },
  };
  return spawner;
}

function createNovaSpawner() {
  const spawner = {
    id: 'nova',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const pods = 1 + Math.floor(spawner.level / 2);
        for (let i = 0; i < pods; i++) {
          run.hazards.push({
            type: 'pod',
            x: rand(70, WIDTH - 70),
            y: rand(70, HEIGHT - 70),
            timer: 1.2,
            ttl: 1.2,
            radius: 16 + spawner.level * 3,
            damage: 10 + spawner.level * 3,
            stacks: spawner.level,
          });
        }
        spawner.timer = rand(3.6, 4.8) / haste;
      }
    },
  };
  return spawner;
}

function createSeekerSpawner() {
  const spawner = {
    id: 'seeker',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const count = 1 + Math.floor(spawner.level / 2);
        for (let i = 0; i < count; i++) {
          const spawnX = rand(50, WIDTH - 50);
          const spawnY = rand(50, HEIGHT - 50);
          run.bullets.push({
            x: spawnX,
            y: spawnY,
            spawnX,
            spawnY,
            warning: 0.65,
            vx: rand(-30, 30),
            vy: rand(-30, 30),
            radius: 5 + spawner.level * 0.4,
            type: 'circle',
            damage: 9 + spawner.level,
            color: '#ff6fd8',
            seek: 110 + spawner.level * 20,
            maxSpeed: 190 + spawner.level * 15,
          });
        }
        audio.play('bullet');
        spawner.timer = rand(2.1, 3) / haste;
      }
    },
  };
  return spawner;
}

function createCascadeSpawner() {
  const spawner = {
    id: 'cascade',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        run.hazards.push({
          type: 'cascade',
          x: rand(60, WIDTH - 60),
          y: rand(60, HEIGHT - 60),
          waves: 3 + spawner.level,
          radius: 30 + spawner.level * 8,
          delay: 0.3,
          timer: 0.3,
          damage: 8 + spawner.level * 2,
        });
        spawner.timer = rand(3.5, 4.5) / haste;
      }
    },
  };
  return spawner;
}

function createTunnelSpawner() {
  const spawner = {
    id: 'tunnel',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.25;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const horizontal = Math.random() < 0.5;
        const gap = Math.max(36, 70 - spawner.level * 6);
        if (horizontal) {
          const y = rand(50, HEIGHT - 50);
          for (let x = 20; x < WIDTH; x += gap) {
            run.bullets.push({
              x,
              y,
              spawnX: x,
              spawnY: y,
              warning: 0.5,
              vx: 0,
              vy: 190 + spawner.level * 25,
              radius: 4,
              damage: 7 + spawner.level,
              type: 'circle',
              color: '#7ff7ff',
            });
          }
        } else {
          const x = rand(50, WIDTH - 50);
          for (let y = 20; y < HEIGHT; y += gap) {
            run.bullets.push({
              x,
              y,
              spawnX: x,
              spawnY: y,
              warning: 0.5,
              vx: 190 + spawner.level * 25,
              vy: 0,
              radius: 4,
              damage: 7 + spawner.level,
              type: 'circle',
              color: '#7ff7ff',
            });
          }
        }
        audio.play('bullet');
        spawner.timer = rand(2.6, 3.6) / haste;
      }
    },
  };
  return spawner;
}

function createRainSpawner() {
  const spawner = {
    id: 'rain',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.25;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const count = randInt(4, 7) + Math.floor(spawner.level * 1.5);
        for (let i = 0; i < count; i++) {
          run.bullets.push({
            x: rand(20, WIDTH - 20),
            y: -10,
            vx: rand(-10, 10),
            vy: rand(130, 200) + spawner.level * 15,
            radius: 3,
            type: 'circle',
            damage: 5 + spawner.level,
            color: '#ffa4a4',
          });
        }
        audio.play('bullet');
        spawner.timer = rand(1.4, 1.8) / haste;
      }
    },
  };
  return spawner;
}

function createSpiralSpawner() {
  let angle = 0;
  const spawner = {
    id: 'spiral',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const rate = 2 + spawner.level * 0.25;
      spawner.timer -= dt * rate;
      angle += dt * rate;
      if (spawner.timer <= 0) {
        const speed = 160 + spawner.level * 15;
        const arms = 2 + Math.floor(spawner.level / 3);
        for (let i = 0; i < arms; i++) {
          const theta = angle + (Math.PI * 2 * i) / arms;
          run.bullets.push({
            x: WIDTH / 2,
            y: HEIGHT / 2,
            vx: Math.cos(theta) * speed,
            vy: Math.sin(theta) * speed,
            radius: 4,
            damage: 7 + spawner.level,
            type: 'circle',
            color: '#c1a9ff',
          });
        }
        audio.play('bullet');
        spawner.timer = 0.7 / rate;
      }
    },
  };
  return spawner;
}

function createRuptureSpawner(id) {
  const spawner = {
    id,
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.25;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const blooms = 1 + Math.floor(spawner.level / 2);
        for (let i = 0; i < blooms; i++) {
          run.hazards.push({
            type: 'rupture',
            x: rand(60, WIDTH - 60),
            y: rand(60, HEIGHT - 60),
            timer: 0.9,
            ttl: 0.9,
            level: spawner.level,
            color: '#ff8c7a',
          });
        }
        spawner.timer = rand(3, 4.2) / haste;
      }
    },
  };
  return spawner;
}

function createPulseSpawner(id) {
  const spawner = {
    id,
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const pulses = 1 + Math.floor(spawner.level / 2);
        for (let i = 0; i < pulses; i++) {
          const px = clamp(run.player.x + rand(-140, 140), 40, WIDTH - 40);
          const py = clamp(run.player.y + rand(-140, 140), 40, HEIGHT - 40);
          run.hazards.push({
            type: 'pulse',
            x: px,
            y: py,
            timer: 0.6,
            ttl: 0.6,
            level: spawner.level,
          });
        }
        spawner.timer = rand(2.4, 3.4) / haste;
      }
    },
  };
  return spawner;
}

function createSpireSpawner(id) {
  const spawner = {
    id,
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const pillars = 1 + Math.floor(spawner.level / 2);
        for (let i = 0; i < pillars; i++) {
          const vertical = Math.random() < 0.5;
          run.hazards.push({
            type: 'spire',
            vertical,
            pos: vertical ? rand(40, WIDTH - 40) : rand(40, HEIGHT - 40),
            timer: 0.85,
            ttl: 0.85,
            level: spawner.level,
          });
        }
        spawner.timer = rand(3.2, 4.3) / haste;
      }
    },
  };
  return spawner;
}

function createMineSpawner(id) {
  const spawner = {
    id,
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const mines = 1 + Math.floor(spawner.level / 2);
        for (let i = 0; i < mines; i++) {
          run.hazards.push({
            type: 'mine',
            x: rand(50, WIDTH - 50),
            y: rand(50, HEIGHT - 50),
            timer: rand(1.4, 2.2),
            radius: 26 + spawner.level * 4,
            level: spawner.level,
          });
        }
        spawner.timer = rand(3.4, 4.8) / haste;
      }
    },
  };
  return spawner;
}

function createLanternSpawner(id) {
  const spawner = {
    id,
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const lanterns = 1 + spawner.level;
        for (let i = 0; i < lanterns; i++) {
          const angle = rand(0, Math.PI * 2);
          run.hazards.push({
            type: 'lantern',
            x: WIDTH / 2 + Math.cos(angle) * 180,
            y: HEIGHT / 2 + Math.sin(angle) * 150,
            vx: rand(-40, 40),
            vy: rand(-40, 40),
            timer: 1.4 + spawner.level * 0.15,
            level: spawner.level,
          });
        }
        spawner.timer = rand(3.2, 4.4) / haste;
      }
    },
  };
  return spawner;
}

function createVolleySpawner(id) {
  const spawner = {
    id,
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.25;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const count = 6 + spawner.level * 2;
        const diag = Math.random() < 0.5;
        for (let i = 0; i < count; i++) {
          const t = i / (count - 1);
          const x = diag ? t * WIDTH : (1 - t) * WIDTH;
          const y = diag ? (1 - t) * HEIGHT : t * HEIGHT;
          const angle = Math.atan2(HEIGHT / 2 - y, WIDTH / 2 - x);
          run.bullets.push({
            x,
            y,
            vx: Math.cos(angle) * (200 + spawner.level * 20),
            vy: Math.sin(angle) * (200 + spawner.level * 20),
            radius: 4,
            damage: 8 + spawner.level,
            type: 'circle',
            color: '#7fe1ff',
          });
        }
        audio.play('bullet');
        spawner.timer = rand(2.5, 3.5) / haste;
      }
    },
  };
  return spawner;
}

function createCometSpawner(id) {
  const spawner = {
    id,
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const comets = 1 + Math.floor(spawner.level / 2);
        for (let i = 0; i < comets; i++) {
          const edge = randInt(0, 3);
          const point = getEdgePoint(edge);
          const target = { x: rand(60, WIDTH - 60), y: rand(60, HEIGHT - 60) };
          const angle = Math.atan2(target.y - point.y, target.x - point.x);
          run.bullets.push({
            x: point.x,
            y: point.y,
            vx: Math.cos(angle) * (140 + spawner.level * 15),
            vy: Math.sin(angle) * (140 + spawner.level * 15),
            radius: 7,
            damage: 12 + spawner.level * 2,
            type: 'circle',
            color: '#f7e286',
            life: 4,
            explodeCount: 6 + spawner.level * 2,
            explodeSpeed: 140 + spawner.level * 15,
          });
        }
        audio.play('bullet');
        spawner.timer = rand(3.3, 4.6) / haste;
      }
    },
  };
  return spawner;
}

function createEchoSpawner(id) {
  const spawner = {
    id,
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const echoes = 1 + spawner.level;
        for (let i = 0; i < echoes; i++) {
          const dir = { x: run.player.lastDir.x || 1, y: run.player.lastDir.y || 0 };
          const mag = Math.hypot(dir.x, dir.y) || 1;
          run.hazards.push({
            type: 'echo',
            x: run.player.x,
            y: run.player.y,
            vx: (dir.x / mag) * (220 + spawner.level * 20) + rand(-40, 40),
            vy: (dir.y / mag) * (220 + spawner.level * 20) + rand(-40, 40),
            timer: 0.7,
            level: spawner.level,
          });
        }
        spawner.timer = rand(3, 4.1) / haste;
      }
    },
  };
  return spawner;
}

function createGeyserSpawner(id) {
  const spawner = {
    id,
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const columns = 1 + Math.floor(spawner.level / 2);
        for (let i = 0; i < columns; i++) {
          run.hazards.push({
            type: 'geyser',
            x: rand(60, WIDTH - 60),
            timer: 0.9,
            ttl: 0.9,
            level: spawner.level,
          });
        }
        spawner.timer = rand(3, 4.2) / haste;
      }
    },
  };
  return spawner;
}

function createFractureSpawner(id) {
  const spawner = {
    id,
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const start = { x: rand(40, WIDTH - 40), y: rand(40, HEIGHT - 40) };
        const angle = rand(0, Math.PI * 2);
        const segments = 4 + spawner.level;
        const points = [];
        for (let i = 0; i < segments; i++) {
          const dist = 30 + i * 25;
          points.push({
            x: clamp(start.x + Math.cos(angle) * dist + rand(-20, 20), 20, WIDTH - 20),
            y: clamp(start.y + Math.sin(angle) * dist + rand(-20, 20), 20, HEIGHT - 20),
          });
        }
        run.hazards.push({
          type: 'fracture',
          points,
          index: 0,
          timer: 0.4,
          level: spawner.level,
        });
        spawner.timer = rand(3.6, 4.6) / haste;
      }
    },
  };
  return spawner;
}

function createBloomSpawner(id) {
  const spawner = {
    id,
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const motes = 1 + spawner.level;
        for (let i = 0; i < motes; i++) {
          run.hazards.push({
            type: 'bloom',
            x: rand(40, WIDTH - 40),
            y: rand(40, HEIGHT - 40),
            vx: rand(-30, 30),
            vy: rand(-30, 30),
            ttl: 2.2,
            level: spawner.level,
          });
        }
        spawner.timer = rand(3.5, 4.6) / haste;
      }
    },
  };
  return spawner;
}

function createChainSpawner(id) {
  const spawner = {
    id,
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const links = 3 + spawner.level;
        const nodes = [];
        let current = { x: rand(40, WIDTH - 40), y: rand(40, HEIGHT - 40) };
        for (let i = 0; i < links; i++) {
          nodes.push({ ...current });
          current = {
            x: clamp(current.x + rand(-120, 120), 30, WIDTH - 30),
            y: clamp(current.y + rand(-120, 120), 30, HEIGHT - 30),
          };
        }
        run.hazards.push({
          type: 'chain',
          nodes,
          timer: 1,
          level: spawner.level,
          progress: 0,
        });
        spawner.timer = rand(4, 5.3) / haste;
      }
    },
  };
  return spawner;
}

function createWaveSpawner(id, options = {}) {
  const config = {
    axis: 'horizontal',
    path: 'sine',
    lanes: 2,
    amplitude: 60,
    zigzag: 90,
    color: '#cfe9ff',
    shape: 'diamond',
    speed: 150,
    cooldown: [2.4, 3.4],
    ...options,
  };
  const spawner = {
    id,
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const lanes = Math.min(5, config.lanes + Math.floor((spawner.level - 1) / 2));
        let fired = false;
        for (let lane = 0; lane < lanes; lane++) {
          const dir = Math.random() < 0.5 ? 1 : -1;
          spawnWaveProjectile(run, lane, lanes, dir);
          fired = true;
        }
        if (fired) audio.play('bullet');
        spawner.timer = rand(config.cooldown[0], config.cooldown[1]) / haste;
      }
    },
  };

  function spawnWaveProjectile(run, lane, lanes, dir) {
    const horizontal = config.axis === 'horizontal';
    const speed = (config.speed || 150) + spawner.level * 10;
    const collisionShapes = ['triangle', 'diamond', 'locker', 'hex'];
    const type = collisionShapes.includes(config.shape) ? 'square' : 'circle';
    let x;
    let y;
    if (horizontal) {
      x = dir > 0 ? -25 : WIDTH + 25;
      const band = (lane + 0.5) / lanes;
      y = clamp(band * HEIGHT + rand(-25, 25), 30, HEIGHT - 30);
    } else {
      y = dir > 0 ? -25 : HEIGHT + 25;
      const band = (lane + 0.5) / lanes;
      x = clamp(band * WIDTH + rand(-25, 25), 30, WIDTH - 30);
    }
    const bullet = {
      x,
      y,
      vx: horizontal ? dir * speed : 0,
      vy: horizontal ? 0 : dir * speed,
      radius: 5,
      size: 14,
      type,
      color: config.color || '#cfe9ff',
      damage: 8 + spawner.level,
      shape: config.shape,
      ignoreGravity: true,
    };
    bullet.baseVx = bullet.vx;
    bullet.baseVy = bullet.vy;
    if (config.path === 'sine') {
      bullet.osc = {
        axis: horizontal ? 'y' : 'x',
        amplitude: (config.amplitude || 60) + spawner.level * 4,
        speed: 4 + spawner.level * 0.4,
      };
    } else {
      bullet.zigzag = {
        axis: horizontal ? 'y' : 'x',
        magnitude: (config.zigzag || 90) + spawner.level * 6,
        interval: 0.22,
        dir: 1,
      };
    }
    run.bullets.push(bullet);
  }

  return spawner;
}

function createRetreatSpawner(id, options = {}) {
  const config = {
    color: '#ffa17a',
    shape: 'diamond',
    pause: 0.4,
    advance: 0.6,
    speed: 190,
    warning: 0.65,
    ...options,
  };
  const spawner = {
    id,
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const count = 2 + Math.floor(spawner.level / 2);
        for (let i = 0; i < count; i++) {
          const spawnX = clamp(rand(50, WIDTH - 50), 30, WIDTH - 30);
          const spawnY = clamp(rand(50, HEIGHT - 50), 30, HEIGHT - 30);
          const angle = rand(0, Math.PI * 2);
          const velocity = (config.speed || 190) + spawner.level * 12;
          const collisionShapes = ['triangle', 'diamond', 'locker', 'hex'];
          const type = collisionShapes.includes(config.shape) ? 'square' : 'circle';
          run.bullets.push({
            x: spawnX,
            y: spawnY,
            spawnX,
            spawnY,
            warning: config.warning,
            vx: Math.cos(angle) * velocity,
            vy: Math.sin(angle) * velocity,
            radius: 6,
            size: 14,
            type,
            color: config.color || '#ffa17a',
            damage: 9 + spawner.level,
            shape: config.shape,
            ignoreGravity: true,
            retreat: {
              phase: 'advance',
              timer: config.advance,
              pause: config.pause,
              multiplier: 1.15 + spawner.level * 0.1,
            },
          });
        }
        audio.play('bullet');
        spawner.timer = rand(3, 4.3) / haste;
      }
    },
  };
  return spawner;
}

function createLockerSpawner(id, options = {}) {
  const config = {
    size: 28,
    burst: 6,
    color: '#ffd166',
    cooldown: [4.4, 5.8],
    speed: 70,
    ...options,
  };
  const spawner = {
    id,
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const dropCount = 1 + Math.floor(spawner.level / 2);
        for (let i = 0; i < dropCount; i++) {
          const spawnX = clamp(rand(50, WIDTH - 50), 40, WIDTH - 40);
          const spawnY = clamp(rand(60, HEIGHT - 60), 50, HEIGHT - 50);
          const size = config.size + spawner.level * 1.5;
          run.bullets.push({
            x: spawnX,
            y: spawnY,
            spawnX,
            spawnY,
            warning: 0.8,
            vx: rand(-20, 20),
            vy: config.speed + spawner.level * 6,
            size,
            type: 'square',
            color: config.color || '#ffd166',
            damage: 14 + spawner.level * 2,
            shape: 'locker',
            ignoreGravity: true,
            life: 4.5 + spawner.level * 0.2,
            explodeCount: config.burst + Math.floor(spawner.level / 2),
            explodeSpeed: 120 + spawner.level * 12,
            explodeColor: config.color || '#ffd166',
            explodeShape: 'square',
            explodeDamage: 8 + spawner.level,
          });
        }
        audio.play('bullet');
        spawner.timer = rand(config.cooldown[0], config.cooldown[1]) / haste;
      }
    },
  };
  return spawner;
}

function createLatticeSpawner(id, options = {}) {
  const config = {
    cells: 3,
    color: '#94e2ff',
    speed: 130,
    shape: 'square',
    ...options,
  };
  const spawner = {
    id,
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const cols = Math.min(5, config.cells + Math.floor((spawner.level - 1) / 2));
        const rows = 1 + Math.floor(spawner.level / 3);
        const type = 'square';
        for (let c = 0; c < cols; c++) {
          for (let r = 0; r < rows; r++) {
            const dir = r % 2 === 0 ? 1 : -1;
            const spawnX = clamp(((c + 0.5) / cols) * WIDTH + rand(-20, 20), 30, WIDTH - 30);
            const telegraphY = dir > 0 ? rand(40, HEIGHT / 2) : rand(HEIGHT / 2, HEIGHT - 40);
            run.bullets.push({
              x: spawnX,
              y: telegraphY,
              spawnX,
              spawnY: telegraphY,
              warning: 0.55,
              vx: 0,
              vy: dir * ((config.speed || 130) + spawner.level * 8),
              size: 18,
              type,
              color: config.color || '#94e2ff',
              damage: 9 + spawner.level,
              shape: config.shape,
              ignoreGravity: true,
            });
          }
        }
        audio.play('bullet');
        spawner.timer = rand(3.3, 4.6) / haste;
      }
    },
  };
  return spawner;
}

function createStopGoSpawner(id, options = {}) {
  const config = {
    axis: 'horizontal',
    color: '#9df7d2',
    idle: 0.45,
    move: 1.1,
    speed: 160,
    shape: 'square',
    ...options,
  };
  const spawner = {
    id,
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const count = Math.min(4, 2 + Math.floor(spawner.level / 2));
        for (let i = 0; i < count; i++) {
          const dir = Math.random() < 0.5 ? 1 : -1;
          const { x, y, vx, vy } = stopGoSpawnPoint(dir, i, count);
          const collisionShapes = ['diamond', 'locker', 'hex'];
          const type = collisionShapes.includes(config.shape) ? 'square' : 'circle';
          const bullet = {
            x,
            y,
            vx,
            vy,
            radius: 5,
            size: 14,
            type,
            color: config.color || '#9df7d2',
            damage: 8 + spawner.level,
            shape: config.shape,
            ignoreGravity: true,
            stopGo: {
              phase: 'move',
              timer: config.move,
              idle: config.idle,
              move: config.move,
            },
          };
          bullet.baseVx = vx;
          bullet.baseVy = vy;
          run.bullets.push(bullet);
        }
        audio.play('bullet');
        spawner.timer = rand(2.8, 3.6) / haste;
      }
    },
  };

  function stopGoSpawnPoint(dir, index, count) {
    const spacing = (index + 0.5) / count;
    const speed = (config.speed || 160) + spawner.level * 10;
    if (config.axis === 'horizontal') {
      return {
        x: dir > 0 ? -20 : WIDTH + 20,
        y: clamp(spacing * HEIGHT, 40, HEIGHT - 40),
        vx: dir * speed,
        vy: 0,
      };
    }
    if (config.axis === 'vertical') {
      return {
        x: clamp(spacing * WIDTH, 40, WIDTH - 40),
        y: dir > 0 ? -20 : HEIGHT + 20,
        vx: 0,
        vy: dir * speed,
      };
    }
    return {
      x: dir > 0 ? -20 : WIDTH + 20,
      y: dir > 0 ? -20 : HEIGHT + 20,
      vx: dir * speed,
      vy: dir * speed,
    };
  }

  return spawner;
}

function createGrowthSpawner(id, options = {}) {
  const config = {
    grow: true,
    color: '#fff06f',
    shape: 'ring',
    ...options,
  };
  const spawner = {
    id,
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const count = 2 + Math.floor(spawner.level / 2);
        const collisionShapes = ['triangle', 'diamond', 'locker', 'hex'];
        const type = collisionShapes.includes(config.shape) ? 'square' : 'circle';
        for (let i = 0; i < count; i++) {
          const spawnX = clamp(rand(40, WIDTH - 40), 30, WIDTH - 30);
          const spawnY = clamp(rand(40, HEIGHT - 40), 30, HEIGHT - 30);
          run.bullets.push({
            x: spawnX,
            y: spawnY,
            spawnX,
            spawnY,
            warning: 0.55,
            vx: rand(-50, 50),
            vy: rand(-50, 50),
            radius: 4,
            size: 10,
            type,
            color: config.color || '#fff06f',
            damage: 7 + spawner.level,
            shape: config.shape,
            ignoreGravity: true,
            growth: {
              grow: config.grow,
              min: 4,
              max: 12 + spawner.level,
              speed: 3 + spawner.level * 0.3,
            },
            life: 4 + spawner.level * 0.4,
            explodeCount: 0,
          });
        }
        audio.play('bullet');
        spawner.timer = rand(3, 4.1) / haste;
      }
    },
  };
  return spawner;
}

function createBurstSeedSpawner(id, options = {}) {
  const config = {
    color: '#ffba70',
    count: 6,
    shape: 'square',
    cooldown: [4, 5.2],
    ...options,
  };
  const spawner = {
    id,
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const seeds = 1 + Math.floor(spawner.level / 2);
        for (let i = 0; i < seeds; i++) {
          run.hazards.push({
            type: 'burstSeed',
            x: rand(60, WIDTH - 60),
            y: rand(60, HEIGHT - 60),
            timer: 0.9,
            ttl: 0.9,
            color: config.color || '#ffba70',
            shape: config.shape,
            count: config.count + spawner.level,
            level: spawner.level,
            speed: 130 + spawner.level * 12,
            damage: 8 + spawner.level,
          });
        }
        spawner.timer = rand(config.cooldown[0], config.cooldown[1]) / haste;
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
  const fallback = AI_FALLBACK_MS;
  state.queueDeadline = performance.now() + fallback;
  state.queueTicker = setInterval(() => {
    const remaining = Math.max(0, state.queueDeadline - performance.now());
    queueMessage.textContent = `Matching players... AI backup in ${(remaining / 1000).toFixed(1)}s`;
  }, 250);
  state.queueAIHandle = setTimeout(() => {
    if (state.queueTicker) {
      clearInterval(state.queueTicker);
      state.queueTicker = null;
    }
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
  run.skill = rand(1.8, 2.4);
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
  updatePickups(run, delta);
  updateEffects(run, delta);
  if (run.flash > 0) {
    run.flash = Math.max(0, run.flash - delta);
  }
  if (run.player.hurtTimer > 0) {
    run.player.hurtTimer = Math.max(0, run.player.hurtTimer - delta);
  }
  if (run.healTimer > 0) {
    run.healTimer -= delta;
  } else {
    spawnHealPickup(run);
    run.healTimer = HEAL_INTERVAL;
  }

  run.spawnTimer -= delta * run.spawnRate;
  if (run.spawnTimer <= 0) {
    spawnBullet(run);
    run.spawnTimer = Math.max(1.3, run.baseSpawn - run.time * run.spawnAcceleration);
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
  if (player.armorTimer > 0) player.armorTimer = Math.max(0, player.armorTimer - delta);

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
  player.invuln = Math.max(player.invuln, ARMOR_DURATION);
  player.armorTimer = ARMOR_DURATION;
  player.staminaDelay = 1.4;
  addEffect(state.run, {
    type: 'dash',
    sx: startX,
    sy: startY,
    ex: player.x,
    ey: player.y,
    ttl: 0.35,
  });
  addEffect(state.run, {
    type: 'armor',
    x: player.x,
    y: player.y,
    ttl: ARMOR_DURATION,
    radius: player.radius + 10,
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
  if (run.bullets.length > BASE_BULLET_CAP) return;
  const edge = randInt(0, 3);
  const speed = rand(50, 90) * run.bulletSpeed;
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
  const shapePool =
    type === 'circle' ? ['circle', 'ring'] : ['square', 'diamond', 'triangle', 'hex', 'locker'];
  const shape = shapePool[randInt(0, shapePool.length - 1)];
  const shapeColors = {
    circle: '#7ff7ff',
    ring: '#9de3ff',
    square: '#ffa4a4',
    diamond: '#ffcf9a',
    triangle: '#ff9ad5',
    hex: '#b2ffda',
    locker: '#ffd166',
  };
  const bullet = {
    x,
    y,
    vx,
    vy,
    radius: rand(4, 7),
    size: rand(6, 12),
    type,
    damage: 9,
    color: shapeColors[shape] || (type === 'circle' ? '#7ff7ff' : '#ffa4a4'),
    shape,
    warning: 0,
  };

  if (Math.random() < 0.15) {
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

  if (run.mirrorBloom) {
    const interval = Math.max(2, 7 - Math.max(1, run.mirrorBloomLevel || 1));
    if (run.spawnCount % interval === 0) {
      run.bullets.push({
        ...bullet,
        x: bullet.x + 10,
        y: bullet.y + 10,
        vx: bullet.vx,
        vy: bullet.vy,
      });
    }
  }
}

function explodeBullet(run, bullet) {
  if (!bullet.explodeCount) return;
  const count = bullet.explodeCount;
  const shape = bullet.explodeShape || 'circle';
  const type = ['triangle', 'diamond', 'locker', 'hex', 'square'].includes(shape)
    ? 'square'
    : 'circle';
  const color = bullet.explodeColor || '#ffa86d';
  const damage =
    typeof bullet.explodeDamage === 'number'
      ? bullet.explodeDamage
      : Math.max(6, (bullet.damage || 8) * 0.6);
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count;
    run.bullets.push({
      x: bullet.x,
      y: bullet.y,
      vx: Math.cos(angle) * (bullet.explodeSpeed || 140),
      vy: Math.sin(angle) * (bullet.explodeSpeed || 140),
      radius: 3,
      size: 10,
      damage,
      type,
      color,
      shape,
      ignoreGravity: true,
    });
  }
  audio.play('bullet');
}

function spawnLaser(run, level = 1) {
  const horizontal = Math.random() < 0.5;
  const offset = horizontal ? rand(40, HEIGHT - 40) : rand(40, WIDTH - 40);
  const width = 10 + level * 2;
  run.hazards.push({
    type: 'laser',
    horizontal,
    offset,
    telegraph: Math.max(0.8, 1.3 - level * 0.08),
    duration: 1.3 + level * 0.15,
    width,
    damage: 20 + level * 6,
  });
}

function spawnTileHazard(run, level = 1) {
  const size = rand(50, 100) + level * 10;
  run.hazards.push({
    type: 'tile',
    x: rand(size / 2, WIDTH - size / 2),
    y: rand(size / 2, HEIGHT - size / 2),
    size,
    blink: rand(0.6, 0.9),
    timer: rand(0.7, 1),
    active: false,
    damage: 24 + level * 4,
  });
}

function queueShardBurst(run, level = 1) {
  const bursts = 1 + Math.floor(level / 2);
  for (let i = 0; i < bursts; i++) {
    run.hazards.push({
      type: 'shardWarn',
      x: rand(50, WIDTH - 50),
      y: rand(50, HEIGHT - 50),
      timer: 0.85,
      ttl: 0.85,
      level,
    });
  }
}

function spawnShardBurst(run, cx, cy, level = 1) {
  const count = randInt(6, 10) + level * 2;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count;
    run.bullets.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * rand(120, 180 + level * 15),
      vy: Math.sin(angle) * rand(120, 180 + level * 15),
      radius: 4,
      type: 'circle',
      damage: 6 + level,
      color: '#f55353',
    });
  }
  audio.play('bullet');
}

function spawnHealPickup(run) {
  if (!run.pickups) run.pickups = [];
  run.pickups.push({
    type: 'heal',
    x: rand(40, WIDTH - 40),
    y: rand(40, HEIGHT - 40),
    radius: 18,
    pulse: 0,
    amount: HEAL_AMOUNT,
  });
}

function updatePickups(run, delta) {
  if (!run.pickups || !run.pickups.length) return;
  const player = run.player;
  run.pickups = run.pickups.filter((pickup) => {
    pickup.pulse = ((pickup.pulse || 0) + delta) % 1;
    const dist = Math.hypot(pickup.x - player.x, pickup.y - player.y);
    if (dist < pickup.radius + player.radius) {
      player.hp = Math.min(player.hpMax, player.hp + pickup.amount);
      addEffect(run, { type: 'heal', x: pickup.x, y: pickup.y, ttl: 0.5, radius: pickup.radius + 10 });
      audio.play('heal');
      return false;
    }
    return true;
  });
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
    if (bullet.baseVx === undefined) {
      bullet.baseVx = bullet.vx;
      bullet.baseVy = bullet.vy;
    }
    applyBulletBehavior(bullet, delta);
    if (run.gravityPull && !bullet.ignoreGravity) {
      const dx = player.x - bullet.x;
      const dy = player.y - bullet.y;
      const pull = 0.8 + run.gravityPull * 0.25;
      bullet.vx += (dx / 800) * delta * 60 * pull;
      bullet.vy += (dy / 800) * delta * 60 * pull;
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
    let remove = false;
    if (
      bullet.x < -40 ||
      bullet.x > WIDTH + 40 ||
      bullet.y < -40 ||
      bullet.y > HEIGHT + 40
    ) {
      remove = true;
    }
    if (typeof bullet.life === 'number') {
      bullet.life -= delta;
      if (bullet.life <= 0) {
        remove = true;
      }
    }
    if (remove) {
      explodeBullet(run, bullet);
      run.bullets.splice(i, 1);
      continue;
    }
    if (player.invuln > 0) continue;
    if (bullet.type === 'circle') {
      const dist = Math.hypot(bullet.x - player.x, bullet.y - player.y);
      if (dist < bullet.radius + player.radius) {
        applyDamage(run, player, bullet.damage);
        explodeBullet(run, bullet);
        run.bullets.splice(i, 1);
      }
    } else if (bullet.type === 'square') {
      if (
        Math.abs(bullet.x - player.x) < bullet.size / 2 + player.radius &&
        Math.abs(bullet.y - player.y) < bullet.size / 2 + player.radius
      ) {
        applyDamage(run, player, bullet.damage);
        explodeBullet(run, bullet);
        run.bullets.splice(i, 1);
      }
    }
  }
}

function applyBulletBehavior(bullet, delta) {
  if (bullet.osc) {
    bullet.osc.phase = (bullet.osc.phase || 0) + bullet.osc.speed * delta;
    const offset = Math.sin(bullet.osc.phase) * bullet.osc.amplitude;
    if (bullet.osc.axis === 'x') {
      bullet.vx = (bullet.baseVx || bullet.vx) + offset;
    } else {
      bullet.vy = (bullet.baseVy || bullet.vy) + offset;
    }
  }
  if (bullet.zigzag) {
    bullet.zigzag.timer = (bullet.zigzag.timer || bullet.zigzag.interval) - delta;
    if (bullet.zigzag.timer <= 0) {
      bullet.zigzag.dir = -(bullet.zigzag.dir || 1);
      bullet.zigzag.timer += bullet.zigzag.interval;
    }
    const magnitude = bullet.zigzag.magnitude * (bullet.zigzag.dir || 1);
    if (bullet.zigzag.axis === 'x') {
      bullet.vx = (bullet.baseVx || bullet.vx) + magnitude;
    } else {
      bullet.vy = (bullet.baseVy || bullet.vy) + magnitude;
    }
  }
  if (bullet.retreat) {
    if (bullet.retreat.originVx === undefined) {
      bullet.retreat.originVx = bullet.baseVx || bullet.vx;
      bullet.retreat.originVy = bullet.baseVy || bullet.vy;
    }
    bullet.retreat.timer -= delta;
    if (bullet.retreat.phase === 'advance' && bullet.retreat.timer <= 0) {
      bullet.retreat.phase = 'pause';
      bullet.retreat.timer = bullet.retreat.pause;
      bullet.vx = 0;
      bullet.vy = 0;
    } else if (bullet.retreat.phase === 'pause' && bullet.retreat.timer <= 0) {
      bullet.retreat.phase = 'retreat';
      bullet.vx = -(bullet.retreat.originVx || 0) * bullet.retreat.multiplier;
      bullet.vy = -(bullet.retreat.originVy || 0) * bullet.retreat.multiplier;
      bullet.baseVx = bullet.vx;
      bullet.baseVy = bullet.vy;
    }
  }
  if (bullet.stopGo) {
    bullet.stopGo.timer -= delta;
    if (bullet.stopGo.phase === 'move' && bullet.stopGo.timer <= 0) {
      bullet.stopGo.phase = 'idle';
      bullet.stopGo.timer = bullet.stopGo.idle;
      bullet.vx = 0;
      bullet.vy = 0;
    } else if (bullet.stopGo.phase === 'idle' && bullet.stopGo.timer <= 0) {
      bullet.stopGo.phase = 'move';
      bullet.stopGo.timer = bullet.stopGo.move;
      bullet.vx = bullet.baseVx || bullet.vx;
      bullet.vy = bullet.baseVy || bullet.vy;
    }
  }
  if (bullet.growth) {
    bullet.growth.phase = (bullet.growth.phase || 0) + delta * bullet.growth.speed;
    const swing = bullet.growth.grow
      ? Math.sin(bullet.growth.phase) * 0.5 + 0.5
      : Math.cos(bullet.growth.phase) * 0.5 + 0.5;
    const size = bullet.growth.min + (bullet.growth.max - bullet.growth.min) * swing;
    if (bullet.type === 'circle') {
      bullet.radius = size;
    } else {
      bullet.size = size * 2;
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
    } else if (hazard.type === 'burstSeed') {
      hazard.timer -= delta;
      if (hazard.timer <= 0) {
        const count = hazard.count;
        const shape = hazard.shape || 'circle';
        const type = ['triangle', 'diamond', 'locker', 'hex', 'square'].includes(shape)
          ? 'square'
          : 'circle';
        for (let j = 0; j < count; j++) {
          const angle = (Math.PI * 2 * j) / count;
          run.bullets.push({
            x: hazard.x,
            y: hazard.y,
            vx: Math.cos(angle) * hazard.speed,
            vy: Math.sin(angle) * hazard.speed,
            radius: 4,
            size: 12,
            type,
            color: hazard.color || '#ffba70',
            damage: hazard.damage,
            shape,
            ignoreGravity: true,
          });
        }
        audio.play('bullet');
        run.hazards.splice(i, 1);
      }
    } else if (hazard.type === 'shardWarn') {
      hazard.timer -= delta;
      if (hazard.timer <= 0) {
        spawnShardBurst(run, hazard.x, hazard.y, hazard.level);
        run.hazards.splice(i, 1);
      }
    } else if (hazard.type === 'rupture') {
      hazard.timer -= delta;
      if (hazard.timer <= 0) {
        const count = 6 + hazard.level * 3;
        spawnRing(run, hazard.x, hazard.y, count, 140 + hazard.level * 20, hazard.color, 10 + hazard.level * 2);
        run.hazards.splice(i, 1);
      }
    } else if (hazard.type === 'pulse') {
      hazard.timer -= delta;
      if (hazard.timer <= 0) {
        const count = 5 + hazard.level * 2;
        for (let j = 0; j < count; j++) {
          const angle = (Math.PI * 2 * j) / count + rand(-0.2, 0.2);
          run.bullets.push({
            x: hazard.x,
            y: hazard.y,
            vx: Math.cos(angle) * (160 + hazard.level * 20),
            vy: Math.sin(angle) * (160 + hazard.level * 20),
            radius: 4,
            damage: 7 + hazard.level,
            type: 'circle',
            color: '#ff9a72',
          });
        }
        audio.play('bullet');
        run.hazards.splice(i, 1);
      }
    } else if (hazard.type === 'spire') {
      hazard.timer -= delta;
      if (hazard.timer <= 0) {
        if (hazard.vertical) {
          for (let y = 0; y <= HEIGHT; y += 35) {
            run.bullets.push({
              x: hazard.pos,
              y,
              vx: 0,
              vy: 220 + hazard.level * 25,
              radius: 4,
              damage: 10 + hazard.level,
              type: 'circle',
              color: '#ffd294',
            });
          }
        } else {
          for (let x = 0; x <= WIDTH; x += 35) {
            run.bullets.push({
              x,
              y: hazard.pos,
              vx: 220 + hazard.level * 25,
              vy: 0,
              radius: 4,
              damage: 10 + hazard.level,
              type: 'circle',
              color: '#ffd294',
            });
          }
        }
        audio.play('bullet');
        run.hazards.splice(i, 1);
      }
    } else if (hazard.type === 'mine') {
      hazard.timer -= delta;
      const dist = Math.hypot(player.x - hazard.x, player.y - hazard.y);
      if (hazard.timer <= 0 || dist < hazard.radius + player.radius + 4) {
        const dirs = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
        dirs.forEach((angle) => {
          run.bullets.push({
            x: hazard.x,
            y: hazard.y,
            vx: Math.cos(angle) * 220,
            vy: Math.sin(angle) * 220,
            radius: 5,
            damage: 12 + hazard.level * 2,
            type: 'circle',
            color: '#ffae73',
          });
        });
        audio.play('bullet');
        run.hazards.splice(i, 1);
      }
    } else if (hazard.type === 'lantern') {
      hazard.timer -= delta;
      const dx = player.x - hazard.x;
      const dy = player.y - hazard.y;
      hazard.vx += (dx / 120) * delta * 60;
      hazard.vy += (dy / 120) * delta * 60;
      hazard.x += hazard.vx * delta;
      hazard.y += hazard.vy * delta;
      if (hazard.timer <= 0) {
        spawnRing(run, hazard.x, hazard.y, 10 + hazard.level * 2, 150 + hazard.level * 15, '#ffe682', 9 + hazard.level);
        run.hazards.splice(i, 1);
      }
    } else if (hazard.type === 'geyser') {
      hazard.timer -= delta;
      if (hazard.timer <= 0) {
        for (let y = 0; y <= HEIGHT; y += 30) {
          run.bullets.push({
            x: hazard.x,
            y,
            vx: rand(-60, 60),
            vy: y < HEIGHT / 2 ? -160 - hazard.level * 20 : 160 + hazard.level * 20,
            radius: 4,
            damage: 9 + hazard.level,
            type: 'circle',
            color: '#7ff7ff',
          });
        }
        audio.play('bullet');
        run.hazards.splice(i, 1);
      }
    } else if (hazard.type === 'fracture') {
      hazard.timer -= delta;
      if (hazard.timer <= 0) {
        const point = hazard.points[hazard.index];
        spawnRing(run, point.x, point.y, 8 + hazard.level, 130, '#f2f2ff', 7 + hazard.level);
        hazard.index += 1;
        hazard.timer = 0.25;
        if (hazard.index >= hazard.points.length) {
          run.hazards.splice(i, 1);
        }
      }
    } else if (hazard.type === 'bloom') {
      hazard.ttl -= delta;
      hazard.x += hazard.vx * delta;
      hazard.y += hazard.vy * delta;
      if (hazard.ttl <= 0) {
        const count = 10 + hazard.level * 2;
        spawnRing(run, hazard.x, hazard.y, count, 110 + hazard.level * 10, '#ffadc7', 8 + hazard.level);
        run.hazards.splice(i, 1);
      }
    } else if (hazard.type === 'chain') {
      hazard.timer -= delta;
      if (hazard.timer <= 0) {
        if (hazard.progress >= hazard.nodes.length) {
          run.hazards.splice(i, 1);
          continue;
        }
        const node = hazard.nodes[hazard.progress];
        spawnRing(run, node.x, node.y, 6 + hazard.level, 150, '#ffb397', 10 + hazard.level);
        hazard.progress += 1;
        hazard.timer = 0.25;
      }
    } else if (hazard.type === 'echo') {
      hazard.timer -= delta;
      hazard.x += hazard.vx * delta;
      hazard.y += hazard.vy * delta;
      if (hazard.timer <= 0) {
        const count = 6 + hazard.level;
        spawnRing(run, hazard.x, hazard.y, count, 120 + hazard.level * 10, '#ffffff', 7 + hazard.level);
        run.hazards.splice(i, 1);
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
    run.aiDamageTimer = rand(0.8, 1.2);
    const intensity = 0.8 + run.danger * 0.4 + run.time * 0.015;
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
  if (!run.choiceStacks) run.choiceStacks = {};
  const next = (run.choiceStacks[choice.id] || 0) + 1;
  run.choiceStacks[choice.id] = next;
  choice.apply(run, next);
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
    } else if (effect.type === 'armor') {
      ctx.strokeStyle = `rgba(127,247,255,${pct * 0.7})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, effect.radius * pct + 20, 0, Math.PI * 2);
      ctx.stroke();
    } else if (effect.type === 'heal') {
      ctx.strokeStyle = `rgba(110,247,127,${pct})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, effect.radius * (1 + pct * 0.5), 0, Math.PI * 2);
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
      const lw = ctx.lineWidth;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(bullet.spawnX, bullet.spawnY, 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bullet.spawnX - 12, bullet.spawnY);
      ctx.lineTo(bullet.spawnX + 12, bullet.spawnY);
      ctx.moveTo(bullet.spawnX, bullet.spawnY - 12);
      ctx.lineTo(bullet.spawnX, bullet.spawnY + 12);
      ctx.stroke();
      ctx.lineWidth = lw;
      return;
    }
    drawBulletShape(bullet);
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
    } else if (hazard.type === 'burstSeed') {
      const pct = hazard.timer / hazard.ttl;
      ctx.save();
      ctx.strokeStyle = hazard.color || '#ffba70';
      ctx.globalAlpha = 0.25 + pct * 0.35;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hazard.x, hazard.y, 14 + (1 - pct) * 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (hazard.type === 'shardWarn') {
      const pct = hazard.timer / hazard.ttl;
      const lw = ctx.lineWidth;
      ctx.strokeStyle = `rgba(255,255,255,${0.4 * pct})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hazard.x, hazard.y, 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(hazard.x - 12, hazard.y);
      ctx.lineTo(hazard.x + 12, hazard.y);
      ctx.moveTo(hazard.x, hazard.y - 12);
      ctx.lineTo(hazard.x, hazard.y + 12);
      ctx.stroke();
      ctx.lineWidth = lw;
    } else if (hazard.type === 'rupture' || hazard.type === 'pulse') {
      const pct = hazard.timer / hazard.ttl;
      ctx.strokeStyle = `rgba(255,140,122,${pct})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hazard.x, hazard.y, 12 + (1 - pct) * 18, 0, Math.PI * 2);
      ctx.stroke();
    } else if (hazard.type === 'spire') {
      ctx.strokeStyle = 'rgba(255,214,148,0.4)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      if (hazard.vertical) {
        ctx.moveTo(hazard.pos, 0);
        ctx.lineTo(hazard.pos, HEIGHT);
      } else {
        ctx.moveTo(0, hazard.pos);
        ctx.lineTo(WIDTH, hazard.pos);
      }
      ctx.stroke();
    } else if (hazard.type === 'mine') {
      ctx.strokeStyle = 'rgba(255,180,100,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hazard.x, hazard.y, hazard.radius, 0, Math.PI * 2);
      ctx.stroke();
    } else if (hazard.type === 'lantern') {
      ctx.fillStyle = 'rgba(255,230,130,0.6)';
      ctx.beginPath();
      ctx.arc(hazard.x, hazard.y, 8 + hazard.level * 1.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (hazard.type === 'geyser') {
      ctx.fillStyle = 'rgba(127,247,255,0.2)';
      ctx.fillRect(hazard.x - 10, 0, 20, HEIGHT);
    } else if (hazard.type === 'fracture') {
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      hazard.points.forEach((point, idx) => {
        if (idx === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
    } else if (hazard.type === 'bloom') {
      ctx.fillStyle = 'rgba(255,180,200,0.4)';
      ctx.beginPath();
      ctx.arc(hazard.x, hazard.y, 10, 0, Math.PI * 2);
      ctx.fill();
    } else if (hazard.type === 'chain') {
      ctx.strokeStyle = 'rgba(255,140,120,0.25)';
      ctx.beginPath();
      hazard.nodes.forEach((node, idx) => {
        if (idx === 0) ctx.moveTo(node.x, node.y);
        else ctx.lineTo(node.x, node.y);
      });
      ctx.stroke();
    } else if (hazard.type === 'echo') {
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.strokeRect(hazard.x - 8, hazard.y - 8, 16, 16);
    }
  });

  if (run.pickups) {
    const lw = ctx.lineWidth;
    run.pickups.forEach((pickup) => {
      const pulse = Math.sin((pickup.pulse || 0) * Math.PI * 2) * 0.5 + 0.5;
      ctx.strokeStyle = `rgba(110,247,127,${0.6 + pulse * 0.3})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(pickup.x, pickup.y, pickup.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pickup.x - pickup.radius / 2, pickup.y);
      ctx.lineTo(pickup.x + pickup.radius / 2, pickup.y);
      ctx.moveTo(pickup.x, pickup.y - pickup.radius / 2);
      ctx.lineTo(pickup.x, pickup.y + pickup.radius / 2);
      ctx.stroke();
    });
    ctx.lineWidth = lw;
  }

  drawPlayerShape(player);
  if (run.flash > 0) {
    ctx.fillStyle = `rgba(255,80,80,${run.flash * 0.4})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
}

function drawBulletShape(bullet) {
  const shape = bullet.shape || (bullet.type === 'circle' ? 'circle' : 'square');
  const color = bullet.color || '#ffffff';
  const size = bullet.size || bullet.radius * 2;
  ctx.fillStyle = color;
  switch (shape) {
    case 'ring': {
      const lw = ctx.lineWidth;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = lw;
      break;
    }
    case 'diamond': {
      ctx.save();
      ctx.translate(bullet.x, bullet.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.restore();
      break;
    }
    case 'triangle': {
      ctx.beginPath();
      ctx.moveTo(bullet.x, bullet.y - size / 2);
      ctx.lineTo(bullet.x + size / 2, bullet.y + size / 2);
      ctx.lineTo(bullet.x - size / 2, bullet.y + size / 2);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'hex': {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i;
        const px = bullet.x + Math.cos(angle) * size * 0.5;
        const py = bullet.y + Math.sin(angle) * size * 0.5;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'locker': {
      ctx.save();
      ctx.translate(bullet.x, bullet.y);
      ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.fillStyle = '#05070c';
      ctx.fillRect(-size / 6, -size / 3, size / 3, (size * 2) / 3);
      ctx.restore();
      break;
    }
    case 'star': {
      ctx.save();
      ctx.translate(bullet.x, bullet.y);
      ctx.beginPath();
      const spikes = 5;
      for (let i = 0; i < spikes * 2; i++) {
        const radius = i % 2 === 0 ? size / 2 : size / 4;
        const angle = (Math.PI * i) / spikes;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'square': {
      ctx.fillRect(bullet.x - size / 2, bullet.y - size / 2, size, size);
      break;
    }
    case 'circle':
    default: {
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
  ctx.fillStyle = color;
}

function drawPlayerShape(player) {
  ctx.save();
  ctx.translate(player.x, player.y);
  const baseColor = player.hurtTimer > 0 ? '#ff9292' : player.color;
  ctx.fillStyle = baseColor;
  if (player.armorTimer > 0) {
    const glow = player.armorTimer / ARMOR_DURATION;
    ctx.shadowColor = `rgba(255,255,255,${glow * 0.8})`;
    ctx.shadowBlur = 15;
  }
  ctx.strokeStyle = '#05070c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  const spikes = 5;
  const inner = player.radius * 0.6;
  const outer = player.radius + 4;
  for (let i = 0; i < spikes * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI * i) / spikes;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
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
  const stacks = run.choiceStacks || {};
  const ordered = [];
  const seen = new Set();
  for (let i = player.choiceHistory.length - 1; i >= 0; i--) {
    const id = player.choiceHistory[i];
    if (!seen.has(id)) {
      seen.add(id);
      ordered.unshift(id);
    }
  }
  const chips = ordered.length
    ? ordered
        .slice(-6)
        .map((id) => {
          const count = stacks[id] || 1;
          const label = CHOICE_LOOKUP[id]?.name || id;
          return `<span class="choice-chip">${label}${count > 1 ? `<strong>×${count}</strong>` : ''}</span>`;
        })
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
    enterQueue();
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
      unlockedChoices: rollInitialChoiceIds(),
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
  unlockListEl.innerHTML = state.recentUnlocks
    .map((name) => `<span class="choice-chip">${name}</span>`)
    .join('');
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
  const awarded = randomSample(locked, unlockCount);
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
  return rollInitialChoiceIds();
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
    rollInitialChoiceIds().forEach((id) => set.add(id));
  }
  return [...set];
}

function rollInitialChoiceIds(count = BASE_UNLOCK_COUNT) {
  const ids = CHOICES.map((choice) => choice.id);
  return randomSample(ids, count);
}

function randomSample(list, count) {
  const pool = [...list];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
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
    const raw =
      localStorage.getItem('matrivade-accounts') || localStorage.getItem('dot-matrix-accounts');
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    return {};
  }
}

function saveAccounts(obj) {
  localStorage.setItem('matrivade-accounts', JSON.stringify(obj));
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
      case 'heal':
        blip(520, 0.25, 0.18, 'sine');
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
    const raw =
      localStorage.getItem('matrivade-leaderboard') ||
      localStorage.getItem('dot-matrix-leaderboard');
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    return [];
  }
}

function saveLeaderboard(list) {
  localStorage.setItem('matrivade-leaderboard', JSON.stringify(list));
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
