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
const CHOICE_INTERVAL = 10;
const CHOICE_DURATION = 9;
const HEAL_INTERVAL = 21.6;
const HEAL_AMOUNT = 12;
const ARMOR_DURATION = 1;
const HIT_INVULN = 0.7;
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
    id: 'hasteRush',
    name: '성급함',
    description: '당신의 이동속도가 10% 빨라지지만, 투사체의 속도가 40% 증가합니다.',
    apply: (run, stack) => {
      const speedBoost = Math.pow(1.1, stack);
      const projectileBoost = Math.pow(1.4, stack);
      run.player.speedMultiplier *= speedBoost;
      run.bulletSpeed *= projectileBoost;
      run.spawnRate *= projectileBoost;
      run.danger += 0.3 * stack;
    },
  },
  {
    id: 'beamline',
    name: '광선',
    description: '3.5초마다 경고 후 무작위 위치에 레이저를 소환합니다. 중첩 시 한 번에 더 많은 레이저가 나타납니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'beamline', createBeamlineSpawner);
      spawner.level = stack;
      run.danger += 0.35 * stack;
    },
  },
  {
    id: 'awkwardGreeting',
    name: '불성인사',
    description: '최대 스태미나가 10% 증가하지만 회복 속도가 40% 느려집니다.',
    apply: (run, stack) => {
      const gain = Math.pow(1.1, stack);
      const penalty = Math.pow(0.6, stack);
      run.player.staminaMax = Math.floor(run.player.staminaMax * gain);
      run.player.stamina = Math.min(run.player.stamina, run.player.staminaMax);
      run.player.staminaRegen *= penalty;
      run.danger += 0.18 * stack;
    },
  },
  {
    id: 'roadblock',
    name: '길막음',
    description: '5초마다 깜빡이는 사각 장벽을 무작위 위치에 소환합니다. 중첩 시 장벽이 커집니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'roadblock', createRoadblockSpawner);
      spawner.level = stack;
      run.danger += 0.28 * stack;
    },
  },
  {
    id: 'pressure',
    name: '압박',
    description: '모든 투사체의 크기가 30% 증가합니다.',
    apply: (run, stack) => {
      run.bulletScale = Math.pow(1.3, stack);
      run.danger += 0.32 * stack;
    },
  },
  {
    id: 'gravityField',
    name: '중력장',
    description: '투사체가 약하게 당신에게 끌려옵니다.',
    apply: (run, stack) => {
      run.gravityPull = 0.8 + (stack - 1) * 0.3;
      run.danger += 0.25 * stack;
    },
  },
  {
    id: 'pelletBurst',
    name: '점탄폭발',
    description: '4초마다 짧은 경고 후 점탄을 흩뿌립니다. 중첩 시 더 많은 점탄이 나옵니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'pelletBurst', createPelletBurstSpawner);
      spawner.level = stack;
      run.danger += 0.3 * stack;
    },
  },
  {
    id: 'chronicFatigue',
    name: '만성피로',
    description: '피해가 15% 증가하고 저주 선택 시간이 20% 줄어듭니다.',
    apply: (run, stack) => {
      run.damageTakenMultiplier = Math.pow(1.15, stack);
      run.choiceInterval = Math.max(6, (run.baseChoiceInterval || CHOICE_INTERVAL) * Math.pow(0.8, stack));
      run.nextChoice = Math.min(run.nextChoice, run.choiceInterval);
      run.danger += 0.24 * stack;
    },
  },
  {
    id: 'empField',
    name: '전자파',
    description: '7초마다 2초 간 이동속도가 50% 감소합니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'emp', createEmpSpawner);
      spawner.level = stack;
      run.danger += 0.22 * stack;
    },
  },
  {
    id: 'herald',
    name: '알리미',
    description: '3초마다 경고 원을 남긴 뒤 확장/수축하는 폭발을 일으킵니다. 중첩 시 폭발 반경이 증가합니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'herald', createAnnouncerSpawner);
      spawner.level = stack;
      run.danger += 0.31 * stack;
    },
  },
  {
    id: 'bombDrop',
    name: '폭탄투하',
    description: '4초마다 상단에서 폭탄이 떨어지고 착지 시 작은 폭발을 일으킵니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'bombard', createBombardSpawner);
      spawner.level = stack;
      run.danger += 0.33 * stack;
    },
  },
  {
    id: 'sniper',
    name: '저격',
    description: '6초마다 당신을 가로지르는 긴 레이저를 소환합니다. 중첩 시 주기가 줄어듭니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'sniper', createSniperSpawner);
      spawner.level = stack;
      run.danger += 0.36 * stack;
    },
  },
  {
    id: 'sinewave',
    name: '사인파',
    description: '2초마다 좌측에서 우측으로 삼각 투사체가 사인파 궤도로 날아옵니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'sinewave', createSineSpawner);
      spawner.level = stack;
      run.danger += 0.27 * stack;
    },
  },
  {
    id: 'speedShot',
    name: '속탄',
    description: '3초마다 화면 끝에서 매우 빠른 투사체가 직진합니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'speedShot', createSpeedShotSpawner);
      spawner.level = stack;
      run.danger += 0.29 * stack;
    },
  },
  {
    id: 'hammerfall',
    name: '망치',
    description: '망치 모양 투사체가 무작위 위치에서 나타나 회전하며 가속합니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'hammer', createHammerSpawner);
      spawner.level = stack;
      run.danger += 0.34 * stack;
    },
  },
  {
    id: 'lightningArc',
    name: '번개',
    description: '4초마다 번개 경고를 남기고 각 꼭짓점에서 작은 폭발을 일으킵니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'lightning', createLightningSpawner);
      spawner.level = stack;
      run.danger += 0.32 * stack;
    },
  },
  {
    id: 'blastMania',
    name: '폭발매니아',
    description: '모든 폭발의 범위가 30% 증가합니다.',
    apply: (run, stack) => {
      run.explosionScale = Math.pow(1.3, stack);
      run.danger += 0.28 * stack;
    },
  },
  {
    id: 'paranoia',
    name: '피해망상',
    description: '투사체에 가까워질수록 이동속도가 느려집니다.',
    apply: (run, stack) => {
      run.paranoia = stack;
      run.danger += 0.2 * stack;
    },
  },
  {
    id: 'stalker',
    name: '미행자',
    description: '2.5초마다 당신 근처에서 유도 투사체가 발사됩니다. 중첩 시 유도가 강해집니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'stalker', createStalkerSpawner);
      spawner.level = stack;
      run.danger += 0.3 * stack;
    },
  },
  {
    id: 'lantern',
    name: '랜턴불',
    description: '4초마다 당신 주변을 도는 영혼 투사체가 나타났다 흩뿌립니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'lantern', () => createLanternSpawner('lantern'));
      spawner.level = stack;
      run.danger += 0.25 * stack;
    },
  },
  {
    id: 'laserStorm',
    name: '광선난사',
    description: '8초마다 여러 개의 레이저를 연속으로 발사합니다. 중첩 시 레이저 수가 증가합니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'laserStorm', createLaserStormSpawner);
      spawner.level = stack;
      run.danger += 0.38 * stack;
    },
  },
  {
    id: 'laserFanatic',
    name: '광선매니아',
    description: '모든 레이저의 두께가 30% 증가합니다.',
    apply: (run, stack) => {
      run.laserWidthScale = Math.pow(1.3, stack);
      run.danger += 0.22 * stack;
    },
  },
  {
    id: 'dirge',
    name: '장송곡',
    description: '연속 피해를 입으면 중앙에서 회전하는 탄막이 6초 동안 생성됩니다.',
    apply: (run, stack) => {
      run.dirgeLevel = stack;
      run.danger += 0.34 * stack;
    },
  },
  {
    id: 'meteorStrike',
    name: '운석',
    description: '3초마다 짧은 경고 후 무작위 위치에 사각형 운석이 떨어집니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'meteor', createMeteorSpawner);
      spawner.level = stack;
      run.danger += 0.3 * stack;
    },
  },
  {
    id: 'binding',
    name: '속박',
    description: '체력이 줄어들수록 이동속도가 조금 빨라지고, 체력이 많을 때는 크게 느려집니다.',
    apply: (run, stack) => {
      run.shackleLevel = stack;
      run.danger += 0.24 * stack;
    },
  },
  {
    id: 'forkedVolley',
    name: '분할',
    description: '3초마다 무작위 투사체를 복제하여 두 갈래로 나갑니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'splitter', createSplitSpawner);
      spawner.level = stack;
      run.danger += 0.28 * stack;
    },
  },
  {
    id: 'wormline',
    name: '지렁이',
    description: '9초마다 서로 연결된 사각 지렁이를 소환합니다. 중첩 시 길이가 증가합니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'wormline', createWormSpawner);
      spawner.level = stack;
      run.danger += 0.33 * stack;
    },
  },
  {
    id: 'coward',
    name: '겁쟁이',
    description: '3.5초마다 잠깐의 경고 뒤 앞으로 나갔다 반대로 되돌아오는 투사체를 소환합니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'coward', createCowardSpawner);
      spawner.level = stack;
      run.danger += 0.27 * stack;
    },
  },
  {
    id: 'foxfire',
    name: '여우불',
    description: '4초마다 느리지만 피해가 큰 추적 투사체를 소환합니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'foxfire', createFoxfireSpawner);
      spawner.level = stack;
      run.danger += 0.31 * stack;
    },
  },
  {
    id: 'ironFan',
    name: '철척',
    description: '5초마다 화면의 끝에서 일정 각도로 다섯 개의 투사체를 발사합니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'ironFan', createIronFanSpawner);
      spawner.level = stack;
      run.danger += 0.28 * stack;
    },
  },
  {
    id: 'charger',
    name: '돌격자',
    description: '3초마다 점점 가속하는 투사체를 소환합니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'charger', createChargerSpawner);
      spawner.level = stack;
      run.danger += 0.29 * stack;
    },
  },
  {
    id: 'inflator',
    name: '거대화',
    description: '4초마다 무작위 투사체 하나의 크기를 두 배로 키웁니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'inflator', createInflatorSpawner);
      spawner.level = stack;
      run.danger += 0.22 * stack;
    },
  },
  {
    id: 'tidalWave',
    name: '파도',
    description: '7초마다 거대한 범위 경고 후 3초간 한 방향으로 탄막을 난사합니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'tidalWave', createWaveSpawner);
      spawner.level = stack;
      run.danger += 0.36 * stack;
    },
  },
  {
    id: 'chaosSpiral',
    name: '혼란',
    description: '6.5초마다 짧은 경고 후 나선으로 회전하는 점탄을 흩뿌립니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'chaos', createChaosSpawner);
      spawner.level = stack;
      run.danger += 0.32 * stack;
    },
  },
  {
    id: 'aidDelay',
    name: '지원지연',
    description: '회복 아이템 소환이 50% 지연됩니다.',
    apply: (run, stack) => {
      const prev = run.aidDelayLevel || 0;
      if (prev) run.healInterval /= Math.pow(1.5, prev);
      run.aidDelayLevel = stack;
      run.healInterval *= Math.pow(1.5, run.aidDelayLevel);
      run.danger += 0.2 * stack;
    },
  },
  {
    id: 'wanderer',
    name: '방랑자',
    description: '7.5초마다 완전히 무작위 궤적으로 움직이는 투사체를 소환합니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'wanderer', createWanderSpawner);
      spawner.level = stack;
      run.danger += 0.27 * stack;
    },
  },
  {
    id: 'deathSentence',
    name: '사망선고',
    description: '16초마다 약하게 추적하며 맞으면 치명적인 해골 투사체를 소환합니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'deathSentence', createDeathMarkSpawner);
      spawner.level = stack;
      run.danger += 0.4 * stack;
    },
  },
  {
    id: 'taxCut',
    name: '탈세',
    description: '회복 아이템이 50% 빨리 나오지만 2초마다 체력이 1씩 감소합니다.',
    apply: (run, stack) => {
      const prev = run.taxLevel || 0;
      if (prev) run.healInterval /= Math.pow(0.5, prev);
      run.taxLevel = stack;
      run.healInterval *= Math.pow(0.5, run.taxLevel);
      run.hpDrainRate = 0.5 * stack;
      run.danger += 0.26 * stack;
    },
  },
  {
    id: 'barrageBloom',
    name: '탄막폭발',
    description: '4초마다 무작위 투사체가 있던 위치에 작은 폭발을 일으키며 제거합니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'barrageBloom', createBarrageSpawner);
      spawner.level = stack;
      run.danger += 0.23 * stack;
    },
  },
  {
    id: 'venom',
    name: '맹독',
    description: '3.5초마다 잠깐의 경고와 함께 맞으면 중독시키는 투사체를 소환합니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'venom', createVenomSpawner);
      spawner.level = stack;
      run.danger += 0.3 * stack;
    },
  },
  {
    id: 'magnifier',
    name: '확대탄',
    description: '4.5초마다 점점 커지는 투사체를 소환합니다. 중첩 시 더 자주 나타납니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'magnifier', createMagnifySpawner);
      spawner.level = stack;
      run.danger += 0.25 * stack;
    },
  },
  {
    id: 'preempt',
    name: '선제공격',
    description: '4초마다 이동 방향으로 질주 후 작은 폭발을 일으키는 영혼 투사체를 소환합니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'preempt', createPreemptSpawner);
      spawner.level = stack;
      run.danger += 0.27 * stack;
    },
  },
  {
    id: 'chainReaction',
    name: '연쇄반응',
    description: '7초마다 여러 원형 경고를 순차적으로 폭발시킵니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'chainReaction', createChainSpawner);
      spawner.level = stack;
      run.danger += 0.34 * stack;
    },
  },
  {
    id: 'pulse',
    name: '전자펄스',
    description: '6초마다 느린 펄스 투사체를 소환하며, 주기적으로 느려지는 필드를 남깁니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'pulse', createPulseSpawner);
      spawner.level = stack;
      run.danger += 0.31 * stack;
    },
  },
  {
    id: 'rascal',
    name: '난봉꾼',
    description: '9초마다 느리게 회전하며 탄을 뿜어내는 난봉꾼 투사체를 소환합니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'rascal', createRascalSpawner);
      spawner.level = stack;
      run.danger += 0.33 * stack;
    },
  },
  {
    id: 'squareWave',
    name: '사각파',
    description: '4초마다 사각파 궤적으로 이동하는 투사체를 발사합니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'squareWave', createSquareWaveSpawner);
      spawner.level = stack;
      run.danger += 0.26 * stack;
    },
  },
  {
    id: 'rippletide',
    name: '윤슬',
    description: '5초마다 중력을 받아 떨어지는 투사체를 다수 소환합니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'rippletide', createRippleSpawner);
      spawner.level = stack;
      run.danger += 0.29 * stack;
    },
  },
  {
    id: 'splitShell',
    name: '분열탄',
    description: '6초마다 스스로를 두 번까지 분열하는 투사체를 소환합니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'splitShell', createSplitShotSpawner);
      spawner.level = stack;
      run.danger += 0.32 * stack;
    },
  },
  {
    id: 'gravityNet',
    name: '중력그물',
    description: '8초마다 주변 투사체를 끌어당기는 그물을 플레이어 주변에 전개합니다.',
    apply: (run, stack) => {
      const spawner = ensureSpawner(run, 'gravityNet', createGravityNetSpawner);
      spawner.level = stack;
      run.danger += 0.27 * stack;
    },
  },
  {
    id: 'exile',
    name: '망명',
    description: '최대 체력이 15% 증가하지만 기본 투사체의 생성 속도와 속도가 모두 증가합니다.',
    apply: (run, stack) => {
      const hpBoost = Math.pow(1.15, stack);
      run.player.hpMax = Math.round(run.player.hpMax * hpBoost);
      run.player.hp = Math.min(run.player.hp, run.player.hpMax);
      run.baseSpawn = Math.max(0.8, run.baseSpawn * Math.pow(0.75, stack));
      run.spawnRate *= Math.pow(1.1, stack);
      run.bulletSpeed *= Math.pow(1.1, stack);
      run.danger += 0.3 * stack;
    },
  },
];
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
    empTimer: 0,
    empSlow: 0.5,
    lastHitTime: -Infinity,
    poisonTimer: 0,
    poisonDamage: 0,
    poisonAccum: 0,
    staminaSlowTimer: 0,
    spin: 0,
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
    baseChoiceInterval: CHOICE_INTERVAL,
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
    healInterval: HEAL_INTERVAL,
    healTimer: HEAL_INTERVAL,
    pickups: [],
    choiceStacks: {},
    mirrorBloomLevel: 0,
    bulletScale: 1,
    damageTakenMultiplier: 1,
    explosionScale: 1,
    paranoia: 0,
    laserWidthScale: 1,
    dirgeLevel: 0,
    dirgeCooldown: 0,
    shackleLevel: 0,
    hpDrainRate: 0,
    hpDrainTimer: 0,
    aidDelayLevel: 0,
    taxLevel: 0,
    lastChoiceIds: [],
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
function createLanternSpawner(id) {
  const spawner = {
    id,
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const lanterns = Math.max(1, spawner.level);
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
function createBeamlineSpawner() {
  const spawner = {
    id: 'beamline',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const beams = Math.max(1, Math.floor(spawner.level));
        for (let i = 0; i < beams; i++) {
          spawnLaser(run, 1 + Math.floor(spawner.level / 2));
        }
        spawner.timer = 3.5 / haste;
      }
    },
  };
  return spawner;
}

function createRoadblockSpawner() {
  const spawner = {
    id: 'roadblock',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.15;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const size = 80 + spawner.level * 12;
        run.hazards.push({
          type: 'roadblock',
          x: rand(size / 2, WIDTH - size / 2),
          y: rand(size / 2, HEIGHT - size / 2),
          size: size * (1 + (spawner.level - 1) * 0.4),
          blink: 1,
          timer: 1,
          life: 5,
          active: false,
          damage: 14 + spawner.level * 2,
        });
        spawner.timer = 5 / haste;
      }
    },
  };
  return spawner;
}

function createPelletBurstSpawner() {
  const spawner = {
    id: 'pelletBurst',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const count = 6 + Math.max(0, spawner.level - 1) * 4;
        run.hazards.push({
          type: 'pelletBurst',
          x: rand(60, WIDTH - 60),
          y: rand(60, HEIGHT - 60),
          timer: 0.5,
          count,
          speed: 160 + spawner.level * 12,
          damage: 7 + spawner.level,
        });
        spawner.timer = 4 / haste;
      }
    },
  };
  return spawner;
}

function createEmpSpawner() {
  const spawner = {
    id: 'emp',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.15;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        run.player.empTimer = Math.max(run.player.empTimer, 2);
        run.player.empSlow = 0.25;
        run.hazards.push({ type: 'emp', timer: 2 });
        spawner.timer = 7 / haste;
      }
    },
  };
  return spawner;
}

function createAnnouncerSpawner() {
  const spawner = {
    id: 'herald',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.15;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const radius = (40 + spawner.level * 12) * (1 + (spawner.level - 1) * 0.4);
        spawnRadialBlast(run, {
          x: rand(70, WIDTH - 70),
          y: rand(70, HEIGHT - 70),
          radius,
          warn: 0.7,
          duration: 1.8,
          damage: 10 + spawner.level * 2,
        });
        spawner.timer = 3 / haste;
      }
    },
  };
  return spawner;
}

function createBombardSpawner() {
  const spawner = {
    id: 'bombard',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const drops = 1 + Math.floor(spawner.level / 2);
        for (let i = 0; i < drops; i++) {
          const spawnX = rand(40, WIDTH - 40);
          run.bullets.push({
            x: spawnX,
            y: -30,
            spawnX,
            spawnY: -30,
            warning: 0.4,
            vx: rand(-15, 15),
            vy: rand(110, 150),
            radius: 8,
            type: 'circle',
            color: '#ffca7a',
            damage: 14 + spawner.level * 2,
            gravity: 90,
            impactBlast: {
              radius: 50 + spawner.level * 6,
              damage: 8 + spawner.level,
              duration: 1,
              warn: 0,
              y: HEIGHT - 35,
            },
          });
        }
        spawner.timer = 4 / haste;
      }
    },
  };
  return spawner;
}

function createSniperSpawner() {
  const spawner = {
    id: 'sniper',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.25;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const angle = rand(0, Math.PI * 2);
        const dir = { x: Math.cos(angle), y: Math.sin(angle) };
        const length = Math.max(WIDTH, HEIGHT) * 3;
        const origin = {
          x: run.player.x - dir.x * length,
          y: run.player.y - dir.y * length,
        };
        run.hazards.push({
          type: 'sniperLaser',
          telegraph: 1.4,
          duration: 0.9,
          width: (6 + spawner.level) * (run.laserWidthScale || 1),
          damage: 25 + spawner.level * 4,
          origin,
          direction: dir,
          length,
          level: spawner.level,
        });
        spawner.timer = 6 / haste;
      }
    },
  };
  return spawner;
}

function createSineSpawner() {
  const spawner = {
    id: 'sinewave',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const spawnY = rand(40, HEIGHT - 40);
        run.bullets.push({
          x: -20,
          y: spawnY,
          vx: 160 + spawner.level * 20,
          vy: 0,
          radius: 6,
          size: 20,
          type: 'square',
          shape: 'triangle',
          color: '#8ce4ff',
          damage: 9 + spawner.level,
          baseVy: 0,
          osc: { axis: 'y', amplitude: 60 + spawner.level * 5, speed: 4 + spawner.level * 0.2 },
        });
        spawner.timer = 2 / haste;
      }
    },
  };
  return spawner;
}

function createSpeedShotSpawner() {
  const spawner = {
    id: 'speedShot',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const edge = randInt(0, 3);
        const point = getEdgePoint(edge);
        const angle = Math.atan2(run.player.y - point.y, run.player.x - point.x);
        run.bullets.push({
          x: point.x,
          y: point.y,
          vx: Math.cos(angle) * (260 + spawner.level * 20),
          vy: Math.sin(angle) * (260 + spawner.level * 20),
          radius: 4,
          type: 'circle',
          color: '#ffffff',
          damage: 10 + spawner.level,
        });
        spawner.timer = 3 / haste;
      }
    },
  };
  return spawner;
}

function createHammerSpawner() {
  const spawner = {
    id: 'hammer',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.15;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const spawnX = rand(70, WIDTH - 70);
        const spawnY = rand(70, HEIGHT - 70);
        const angle = rand(0, Math.PI * 2);
        const speed = 40 + spawner.level * 10;
        run.bullets.push({
          x: spawnX,
          y: spawnY,
          spawnX,
          spawnY,
          warning: 0.6,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          radius: 10,
          size: 26,
          type: 'square',
          shape: 'hammer',
          color: '#f1c06f',
          damage: 15 + spawner.level * 2,
          spin: 3 + spawner.level * 0.3,
          accel: 15 + spawner.level * 6,
          life: 6 + spawner.level * 0.5,
        });
        spawner.timer = rand(2, 10) / haste;
      }
    },
  };
  return spawner;
}

function createLightningSpawner() {
  const spawner = {
    id: 'lightning',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const points = 3 + Math.max(0, spawner.level - 1) * 2;
        const vertices = [];
        let current = { x: rand(40, WIDTH - 40), y: rand(40, HEIGHT - 40) };
        vertices.push(current);
        for (let i = 1; i < points; i++) {
          current = {
            x: clamp(current.x + rand(-80, 80), 30, WIDTH - 30),
            y: clamp(current.y + rand(-80, 80), 30, HEIGHT - 30),
          };
          vertices.push(current);
        }
        run.hazards.push({ type: 'lightning', vertices, timer: 0.8, level: spawner.level });
        spawner.timer = 4 / haste;
      }
    },
  };
  return spawner;
}

function createStalkerSpawner() {
  const spawner = {
    id: 'stalker',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const angle = rand(0, Math.PI * 2);
        const dist = 120;
        const spawnX = run.player.x + Math.cos(angle) * dist;
        const spawnY = run.player.y + Math.sin(angle) * dist;
        run.bullets.push({
          x: spawnX,
          y: spawnY,
          spawnX,
          spawnY,
          warning: 0.4,
          vx: 0,
          vy: 0,
          radius: 5,
          type: 'circle',
          color: '#ff92bb',
          damage: 8 + spawner.level,
          seek: 80 + spawner.level * 25,
          maxSpeed: 170 + spawner.level * 20,
        });
        spawner.timer = 2.5 / haste;
      }
    },
  };
  return spawner;
}

function createLaserStormSpawner() {
  const spawner = {
    id: 'laserStorm',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.15;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        const count = 5 + Math.max(0, spawner.level - 1) * 4;
        run.hazards.push({
          type: 'laserQueue',
          remaining: count,
          interval: 0.4,
          timer: 0,
          level: 1 + Math.floor(spawner.level / 2),
        });
        spawner.timer = 8 / haste;
      }
    },
  };
  return spawner;
}

function createSplitSpawner() {
  const spawner = {
    id: 'splitter',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        spawner.timer = 3 / haste;
        const candidates = run.bullets.filter((b) => !b.warning);
        if (!candidates.length) return;
        const source = candidates[randInt(0, candidates.length - 1)];
        const angle = Math.atan2(source.vy, source.vx);
        const spread = 0.4 + spawner.level * 0.1;
        const clones = [];
        [-spread, spread].forEach((offset) => {
          const dir = angle + offset;
          const speed = Math.hypot(source.vx, source.vy) || 120;
          const clone = duplicateBullet(source, {
            vx: Math.cos(dir) * speed,
            vy: Math.sin(dir) * speed,
          });
          clones.push(clone);
        });
        const idx = run.bullets.indexOf(source);
        if (idx >= 0) run.bullets.splice(idx, 1);
        clones.forEach((clone) => run.bullets.push(clone));
      }
    },
  };
  return spawner;
}

function createWormSpawner() {
  const spawner = {
    id: 'wormline',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.1;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        spawner.timer = 9 / haste;
        const segments = 5 + (spawner.level - 1) * 3;
        const start = getEdgePoint(randInt(0, 3));
        const angle = rand(0, Math.PI * 2);
        const dir = { x: Math.cos(angle), y: Math.sin(angle) };
        const worm = {
          type: 'worm',
          level: spawner.level,
          segments: Array.from({ length: segments }, (_, idx) => ({
            x: start.x - dir.x * idx * 18,
            y: start.y - dir.y * idx * 18,
          })),
          angle,
          speed: 45 + spawner.level * 8,
          blink: 0.35,
          blinkTimer: 0.35,
        };
        run.hazards.push(worm);
      }
    },
  };
  return spawner;
}

function createCowardSpawner() {
  const spawner = {
    id: 'coward',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.1;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        spawner.timer = 3.5 / haste;
        const spot = { x: rand(60, WIDTH - 60), y: rand(60, HEIGHT - 60) };
        const angle = rand(0, Math.PI * 2);
        const speed = 160 + spawner.level * 10;
        run.bullets.push({
          x: spot.x,
          y: spot.y,
          spawnX: spot.x,
          spawnY: spot.y,
          warning: 0.35,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          radius: 5,
          type: 'circle',
          color: '#ffe0a3',
          damage: 9 + spawner.level,
          retreat: {
            phase: 'advance',
            timer: 0.6,
            pause: 0.3,
            multiplier: 1.1 + spawner.level * 0.1,
          },
        });
      }
    },
  };
  return spawner;
}

function createFoxfireSpawner() {
  const spawner = {
    id: 'foxfire',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.15;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        spawner.timer = 4 / haste;
        const spot = { x: rand(60, WIDTH - 60), y: rand(60, HEIGHT - 60) };
        run.bullets.push({
          x: spot.x,
          y: spot.y,
          spawnX: spot.x,
          spawnY: spot.y,
          warning: 0.5,
          vx: rand(-20, 20),
          vy: rand(-20, 20),
          radius: 10,
          type: 'circle',
          color: '#ffb6ff',
          damage: 18 + spawner.level * 3,
          seek: 30 + spawner.level * 5,
          maxSpeed: 140,
        });
      }
    },
  };
  return spawner;
}

function createIronFanSpawner() {
  const spawner = {
    id: 'ironFan',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.15;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        spawner.timer = 5 / haste;
        const originEdge = randInt(0, 3);
        const origin = getEdgePoint(originEdge);
        const baseAngle = Math.atan2(HEIGHT / 2 - origin.y, WIDTH / 2 - origin.x);
        for (let i = 0; i < 5; i++) {
          const offset = (i - 2) * 0.2;
          const angle = baseAngle + offset;
          run.bullets.push({
            x: origin.x,
            y: origin.y,
            vx: Math.cos(angle) * (180 + spawner.level * 12),
            vy: Math.sin(angle) * (180 + spawner.level * 12),
            radius: 5,
            type: 'circle',
            color: '#ffdede',
            damage: 11 + spawner.level,
          });
        }
      }
    },
  };
  return spawner;
}

function createChargerSpawner() {
  const spawner = {
    id: 'charger',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.18;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        spawner.timer = 3 / haste;
        const edge = randInt(0, 3);
        const point = getEdgePoint(edge);
        const angle = Math.atan2(run.player.y - point.y, run.player.x - point.x);
        run.bullets.push({
          x: point.x,
          y: point.y,
          vx: Math.cos(angle) * 60,
          vy: Math.sin(angle) * 60,
          radius: 5,
          type: 'circle',
          color: '#f7ff96',
          damage: 10 + spawner.level,
          accel: 70 + spawner.level * 8,
        });
      }
    },
  };
  return spawner;
}

function createInflatorSpawner() {
  const spawner = {
    id: 'inflator',
    level: 1,
    timer: 0,
    tick(run, dt) {
      spawner.timer -= dt;
      if (spawner.timer <= 0) {
        spawner.timer = 4;
        const candidates = run.bullets.filter((b) => !b.warning);
        if (!candidates.length) return;
        const target = candidates[randInt(0, candidates.length - 1)];
        const isCircle = typeof target.radius === 'number';
        const current = isCircle ? target.radius : target.size / 2;
        const goal = current * 2;
        const rate = (goal - current) / 0.7;
        if (isCircle) {
          target.sizeGrowth = { mode: 'radius', target: goal, speed: Math.max(10, rate) };
        } else {
          target.sizeGrowth = { mode: 'size', target: goal * 2, speed: Math.max(20, rate * 2) };
        }
        target.damage *= 1.2;
      }
    },
  };
  return spawner;
}

function createWaveSpawner() {
  const spawner = {
    id: 'tidalWave',
    level: 1,
    timer: 0,
    tick(run, dt) {
      spawner.timer -= dt;
      if (spawner.timer <= 0) {
        spawner.timer = 7;
        const axis = Math.random() < 0.5 ? 'horizontal' : 'vertical';
        const position = axis === 'horizontal' ? rand(80, HEIGHT - 80) : rand(80, WIDTH - 80);
        run.hazards.push({
          type: 'wave',
          axis,
          position,
          warn: 1.6,
          timer: 1.6,
          duration: 3,
          level: spawner.level,
          side: Math.random() < 0.5 ? 'start' : 'end',
          width: 160 + spawner.level * 20,
          emit: 0,
        });
      }
    },
  };
  return spawner;
}

function createChaosSpawner() {
  const spawner = {
    id: 'chaos',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.15;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        spawner.timer = 6.5 / haste;
        run.hazards.push({
          type: 'chaosBurst',
          x: rand(80, WIDTH - 80),
          y: rand(80, HEIGHT - 80),
          warn: 0.4,
          timer: 0.4,
          level: spawner.level,
        });
      }
    },
  };
  return spawner;
}

function createWanderSpawner() {
  const spawner = {
    id: 'wanderer',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.15;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        spawner.timer = 7.5 / haste;
        const spot = { x: rand(60, WIDTH - 60), y: rand(60, HEIGHT - 60) };
        run.bullets.push({
          x: spot.x,
          y: spot.y,
          spawnX: spot.x,
          spawnY: spot.y,
          warning: 0.35,
          vx: rand(-80, 80),
          vy: rand(-80, 80),
          radius: 7,
          type: 'circle',
          color: '#b6ffec',
          damage: 15 + spawner.level,
          wander: { interval: 0.5, timer: 0.5, speed: 140 },
        });
      }
    },
  };
  return spawner;
}

function createDeathMarkSpawner() {
  const spawner = {
    id: 'deathSentence',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.05;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        spawner.timer = 16 / haste;
        const spot = { x: rand(50, WIDTH - 50), y: rand(50, HEIGHT - 50) };
        run.bullets.push({
          x: spot.x,
          y: spot.y,
          spawnX: spot.x,
          spawnY: spot.y,
          warning: 0.8,
          vx: rand(-30, 30),
          vy: rand(-30, 30),
          radius: 12,
          type: 'circle',
          shape: 'skull',
          color: '#fff1a8',
          damage: 50,
          seek: 25,
          accel: 30,
          maxSpeed: 260,
        });
      }
    },
  };
  return spawner;
}

function createBarrageSpawner() {
  const spawner = {
    id: 'barrageBloom',
    level: 1,
    timer: 0,
    tick(run, dt) {
      spawner.timer -= dt;
      if (spawner.timer <= 0) {
        spawner.timer = 4;
        const target = run.bullets.find((b) => !b.warning);
        if (!target) return;
        spawnRadialBlast(run, {
          x: target.x,
          y: target.y,
          radius: 40 + spawner.level * 6,
          warn: 0.25,
          damage: 8 + spawner.level,
        });
        const idx = run.bullets.indexOf(target);
        if (idx >= 0) run.bullets.splice(idx, 1);
      }
    },
  };
  return spawner;
}

function createVenomSpawner() {
  const spawner = {
    id: 'venom',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.2;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        spawner.timer = 3.5 / haste;
        const spot = { x: rand(60, WIDTH - 60), y: rand(60, HEIGHT - 60) };
        run.bullets.push({
          x: spot.x,
          y: spot.y,
          spawnX: spot.x,
          spawnY: spot.y,
          warning: 0.35,
          vx: rand(-52, 52),
          vy: rand(-52, 52),
          radius: 8,
          type: 'circle',
          color: '#9aff9a',
          damage: 6 + spawner.level,
          life: 6,
          poison: { duration: 15, dps: Math.pow(2, spawner.level - 1) },
        });
      }
    },
  };
  return spawner;
}

function createMagnifySpawner() {
  const spawner = {
    id: 'magnifier',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const base = Math.max(0.8, 1 - (spawner.level - 1) * 0.08);
      spawner.timer -= dt * base;
      if (spawner.timer <= 0) {
        spawner.timer = 4.5 * base;
        const spot = { x: rand(50, WIDTH - 50), y: rand(50, HEIGHT - 50) };
        run.bullets.push({
          x: spot.x,
          y: spot.y,
          spawnX: spot.x,
          spawnY: spot.y,
          warning: 0.4,
          vx: rand(-30, 30),
          vy: rand(-30, 30),
          radius: 5,
          type: 'circle',
          color: '#d2f0ff',
          damage: 8 + spawner.level,
          growth: {
            grow: true,
            speed: 0.8 + spawner.level * 0.1,
            min: 6,
            max: 24 + spawner.level * 3,
          },
        });
      }
    },
  };
  return spawner;
}

function createPreemptSpawner() {
  const spawner = {
    id: 'preempt',
    level: 1,
    timer: 0,
    tick(run, dt) {
      spawner.timer -= dt;
      if (spawner.timer <= 0) {
        spawner.timer = 4;
        run.hazards.push({
          type: 'preemptStrike',
          x: run.player.x,
          y: run.player.y,
          dir: { ...run.player.lastDir },
          life: 1,
          level: spawner.level,
        });
      }
    },
  };
  return spawner;
}

function createChainSpawner() {
  const spawner = {
    id: 'chainReaction',
    level: 1,
    timer: 0,
    tick(run, dt) {
      spawner.timer -= dt;
      if (spawner.timer <= 0) {
        spawner.timer = 7;
        const bursts = 6 + (spawner.level - 1) * 4;
        const hazard = {
          type: 'chain',
          events: Array.from({ length: bursts }, () => ({
            x: rand(60, WIDTH - 60),
            y: rand(60, HEIGHT - 60),
          })),
          index: 0,
          timer: 0.25,
          level: spawner.level,
        };
        run.hazards.push(hazard);
      }
    },
  };
  return spawner;
}

function createPulseSpawner() {
  const spawner = {
    id: 'pulse',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.15;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        spawner.timer = 6 / haste;
        const spot = { x: rand(70, WIDTH - 70), y: rand(70, HEIGHT - 70) };
        run.bullets.push({
          x: spot.x,
          y: spot.y,
          spawnX: spot.x,
          spawnY: spot.y,
          warning: 0.3,
          vx: rand(-20, 20),
          vy: rand(-20, 20),
          radius: 10,
          type: 'circle',
          color: '#9be1ff',
          damage: 6,
          pulse: {
            interval: 1.5,
            timer: 1.5,
            radius: 90 + spawner.level * 10,
            slow: 0.25,
            duration: 1,
          },
          life: 6,
          speed: 20,
        });
      }
    },
  };
  return spawner;
}

function createRascalSpawner() {
  const spawner = {
    id: 'rascal',
    level: 1,
    timer: 0,
    tick(run, dt) {
      spawner.timer -= dt;
      if (spawner.timer <= 0) {
        spawner.timer = 9;
        const point = getEdgePoint(randInt(0, 3));
        const dir = Math.atan2(run.player.y - point.y, run.player.x - point.x);
        run.bullets.push({
          x: point.x,
          y: point.y,
          vx: Math.cos(dir) * 60,
          vy: Math.sin(dir) * 60,
          radius: 12,
          type: 'circle',
          color: '#ffdf9c',
          damage: 14 + spawner.level,
          spin: 1.5,
          rascalShots: {
            timer: 0.5,
            interval: 0.5,
            speed: 260,
          },
        });
      }
    },
  };
  return spawner;
}

function createSquareWaveSpawner() {
  const spawner = {
    id: 'squareWave',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.15;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        spawner.timer = 4 / haste;
        const edge = randInt(0, 3);
        const point = getEdgePoint(edge);
        const angle = Math.atan2(run.player.y - point.y, run.player.x - point.x);
        run.bullets.push({
          x: point.x,
          y: point.y,
          vx: Math.cos(angle) * 140,
          vy: Math.sin(angle) * 140,
          radius: 6,
          type: 'circle',
          color: '#d6b6ff',
          damage: 10 + spawner.level,
          squareWave: {
            axis: Math.abs(Math.cos(angle)) > Math.abs(Math.sin(angle)) ? 'y' : 'x',
            magnitude: 160,
            interval: 0.4,
            timer: 0.4,
            dir: 1,
          },
        });
      }
    },
  };
  return spawner;
}

function createRippleSpawner() {
  const spawner = {
    id: 'rippletide',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.1;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        spawner.timer = 5 / haste;
        const count = 7 + spawner.level * 3;
        for (let i = 0; i < count; i++) {
          const x = rand(40, WIDTH - 40);
          run.bullets.push({
            x,
            y: -20 - i * 10,
            vx: rand(-10, 10),
            vy: 20,
            radius: 6,
            type: 'circle',
            color: '#9fe3ff',
            damage: 11,
            gravity: 90,
          });
        }
      }
    },
  };
  return spawner;
}

function createSplitShotSpawner() {
  const spawner = {
    id: 'splitShell',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.15;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        spawner.timer = 6 / haste;
        const edge = randInt(0, 3);
        const point = getEdgePoint(edge);
        const angle = Math.atan2(run.player.y - point.y, run.player.x - point.x);
        run.bullets.push({
          x: point.x,
          y: point.y,
          vx: Math.cos(angle) * 110,
          vy: Math.sin(angle) * 110,
          radius: 6,
          type: 'circle',
          color: '#ffbbaa',
          damage: 8 + spawner.level,
          split: {
            interval: 2,
            timer: 2,
            count: 2,
            spread: 0.4,
          },
        });
      }
    },
  };
  return spawner;
}

function createGravityNetSpawner() {
  const spawner = {
    id: 'gravityNet',
    level: 1,
    timer: 0,
    tick(run, dt) {
      const haste = 1 + (spawner.level - 1) * 0.1;
      spawner.timer -= dt * haste;
      if (spawner.timer <= 0) {
        spawner.timer = 8 / haste;
        run.hazards.push({
          type: 'gravityNet',
          x: run.player.x,
          y: run.player.y,
          timer: 3 + spawner.level,
          strength: 40 + spawner.level * 10,
        });
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
  const scale = run.explosionScale || 1;
  const scaledSpeed = speed * scale;
  const scaledDamage = damage * scale;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count;
    run.bullets.push({
      x,
      y,
      vx: Math.cos(angle) * scaledSpeed,
      vy: Math.sin(angle) * scaledSpeed,
      radius: 4,
      type: 'circle',
      damage: scaledDamage,
      color,
    });
  }
  audio.play('bullet');
}

function spawnRadialBlast(run, { x, y, radius, warn = 0, duration = 1.2, damage = 10 }) {
  const blast = {
    type: 'announcer',
    x,
    y,
    radius: radius * (run.explosionScale || 1),
    duration,
    damage,
    state: warn > 0 ? 'warn' : 'boom',
    timer: warn > 0 ? warn : duration,
  };
  if (warn > 0) {
    blast.warnTime = warn;
  } else {
    blast.elapsed = 0;
  }
  run.hazards.push(blast);
  return blast;
}

function spawnSlowZone(run, { x, y, radius, duration, slow }) {
  run.hazards.push({
    type: 'slowZone',
    x,
    y,
    radius,
    timer: duration,
    duration,
    slow,
  });
}

function triggerDirgeStorm(run) {
  if (!run || run.dirgeLevel <= 0) return;
  run.hazards.push({
    type: 'dirge',
    timer: 6,
    emit: 0.35,
    angle: 0,
    level: run.dirgeLevel,
  });
  run.dirgeCooldown = 7;
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
  if (run.dirgeCooldown > 0) {
    run.dirgeCooldown = Math.max(0, run.dirgeCooldown - delta);
  }
  handleInput(run, delta);
  updateBullets(run, delta);
  updateHazards(run, delta);
  updatePickups(run, delta);
  updateEffects(run, delta);
  updatePlayerStatus(run, delta);
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
    run.healTimer = run.healInterval;
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

function updatePlayerStatus(run, delta) {
  const player = run.player;
  if (!player) return;
  if (player.poisonTimer > 0) {
    player.poisonTimer = Math.max(0, player.poisonTimer - delta);
    player.poisonAccum = (player.poisonAccum || 0) + delta;
    const tick = player.poisonDamage || 0;
    while (tick > 0 && player.poisonAccum >= 1) {
      applyDamage(run, player, tick, { silent: true, ignoreInvuln: true });
      player.poisonAccum -= 1;
    }
    if (player.poisonTimer <= 0) {
      player.poisonDamage = 0;
      player.poisonAccum = 0;
    }
  }
  if (run.hpDrainRate > 0) {
    applyDamage(run, player, run.hpDrainRate * delta, { silent: true, ignoreInvuln: true });
  }
  player.spin = (player.spin || 0) + delta * 0.6;
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
  if (player.staminaSlowTimer > 0) {
    player.staminaSlowTimer = Math.max(0, player.staminaSlowTimer - delta);
  }
  if (player.empTimer > 0) {
    player.empTimer = Math.max(0, player.empTimer - delta);
    speed *= player.empSlow;
  }
  if (run.paranoia > 0 && run.bullets.length) {
    const nearest = getNearestBulletDistance(player, run.bullets);
    const leash = 180;
    if (nearest < leash) {
      const pct = (leash - nearest) / leash;
    const slow = Math.max(0.65, 1 - pct * 0.2 * run.paranoia);
    speed *= slow;
  }
  }
  if (run.shackleLevel > 0) {
    const hpPct = clamp(player.hp / player.hpMax, 0, 1);
    const fast = 1 + 0.25 * run.shackleLevel;
    const slow = Math.max(0.35, 1 - 0.4 * run.shackleLevel);
    const modifier = fast + (slow - fast) * hpPct;
    speed *= modifier;
  }
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
    const regenRate =
      player.staminaSlowTimer > 0 ? player.staminaRegen * 0.25 : player.staminaRegen;
    player.stamina = Math.min(
      player.staminaMax,
      player.stamina + regenRate * delta,
    );
  }
}

function applyDamage(run, player, amount, options = {}) {
  if (!player || (!options.ignoreInvuln && player.invuln > 0)) return;
  const damage = amount * (run.damageTakenMultiplier || 1);
  if (damage <= 0) return;
  player.hp = Math.max(0, player.hp - damage);
  if (!options.ignoreInvuln && !options.silent) {
    player.invuln = Math.max(player.invuln, HIT_INVULN);
  }
  if (!options.silent) {
    player.hurtTimer = 0.4;
    run.flash = Math.min(1, run.flash + 0.25);
    audio.play('hurt');
    addEffect(run, {
      type: 'hurt',
      x: player.x,
      y: player.y,
      ttl: 0.35,
      radius: player.radius + 6,
    });
  }
  if (!options.silent) {
    const now = run.time || 0;
    if (run.dirgeLevel > 0 && run.dirgeCooldown <= 0 && now - player.lastHitTime <= 3) {
      triggerDirgeStorm(run);
    }
    player.lastHitTime = now;
  }
}

function applyPoison(player, duration, damagePerSecond) {
  player.poisonTimer = Math.max(player.poisonTimer || 0, duration);
  player.poisonDamage = Math.max(damagePerSecond, player.poisonDamage || 0);
  player.poisonAccum = 0;
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
  const speed = rand(65, 117) * run.bulletSpeed;
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

function duplicateBullet(bullet, overrides = {}) {
  const clone = { ...bullet, ...overrides };
  if (bullet.osc) clone.osc = { ...bullet.osc };
  if (bullet.zigzag) clone.zigzag = { ...bullet.zigzag };
  if (bullet.retreat) clone.retreat = { ...bullet.retreat };
  if (bullet.stopGo) clone.stopGo = { ...bullet.stopGo };
  if (bullet.growth) clone.growth = { ...bullet.growth };
  if (bullet.pulse) clone.pulse = { ...bullet.pulse };
  if (bullet.squareWave) clone.squareWave = { ...bullet.squareWave };
  clone.warning = 0;
  clone.spawnX = undefined;
  clone.spawnY = undefined;
  clone.baseVx = undefined;
  clone.baseVy = undefined;
  return clone;
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
  const width = (10 + level * 2) * (run.laserWidthScale || 1);
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

function getLaserEdgeIntersection(origin, dir, length = Math.max(WIDTH, HEIGHT) * 3) {
  const bounds = [
    { axis: 'x', value: -20 },
    { axis: 'x', value: WIDTH + 20 },
    { axis: 'y', value: -20 },
    { axis: 'y', value: HEIGHT + 20 },
  ];
  const candidates = [];
  bounds.forEach((bound) => {
    if (bound.axis === 'x') {
      if (dir.x === 0) return;
      const t = (bound.value - origin.x) / dir.x;
      if (t <= 0) return;
      const y = origin.y + dir.y * t;
      if (y >= -20 && y <= HEIGHT + 20) candidates.push({ t, x: bound.value, y });
    } else {
      if (dir.y === 0) return;
      const t = (bound.value - origin.y) / dir.y;
      if (t <= 0) return;
      const x = origin.x + dir.x * t;
      if (x >= -20 && x <= WIDTH + 20) candidates.push({ t, x, y: bound.value });
    }
  });
  if (!candidates.length) {
    return {
      x: origin.x + dir.x * length,
      y: origin.y + dir.y * length,
    };
  }
  candidates.sort((a, b) => a.t - b.t);
  return candidates[0];
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

function getBulletScale(run, bullet) {
  return (bullet.scale || 1) * (run.bulletScale || 1);
}

function getBulletRadius(run, bullet) {
  return (bullet.radius || 0) * getBulletScale(run, bullet);
}

function getBulletSize(run, bullet) {
  if (typeof bullet.size === 'number') {
    return bullet.size * getBulletScale(run, bullet);
  }
  return getBulletRadius(run, bullet) * 2;
}

function getNearestBulletDistance(player, bullets) {
  if (!bullets.length) return Infinity;
  let closest = Infinity;
  for (let i = 0; i < bullets.length; i++) {
    const bullet = bullets[i];
    if (bullet.warning > 0) continue;
    const dist = Math.hypot(bullet.x - player.x, bullet.y - player.y);
    if (dist < closest) closest = dist;
  }
  return closest;
}

function pointLineDistance(px, py, origin, direction) {
  const vx = px - origin.x;
  const vy = py - origin.y;
  const proj = vx * direction.x + vy * direction.y;
  const closestX = origin.x + direction.x * proj;
  const closestY = origin.y + direction.y * proj;
  return Math.hypot(px - closestX, py - closestY);
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
    if (bullet.pulse) {
      bullet.pulse.timer -= delta;
      if (bullet.pulse.timer <= 0) {
        bullet.pulse.timer += bullet.pulse.interval;
        spawnSlowZone(run, {
          x: bullet.x,
          y: bullet.y,
          radius: bullet.pulse.radius,
          duration: bullet.pulse.duration,
          slow: bullet.pulse.slow,
        });
      }
    }
    if (bullet.rascalShots) {
      bullet.rascalShots.timer -= delta;
      if (bullet.rascalShots.timer <= 0) {
        bullet.rascalShots.timer += bullet.rascalShots.interval;
        const dir = Math.atan2(bullet.vy, bullet.vx);
        run.bullets.push({
          x: bullet.x,
          y: bullet.y,
          spawnX: bullet.x,
          spawnY: bullet.y,
          warning: 0.2,
          vx: Math.cos(dir) * bullet.rascalShots.speed,
          vy: Math.sin(dir) * bullet.rascalShots.speed,
          radius: 4,
          type: 'circle',
          color: '#ffd38f',
          damage: 7,
        });
      }
    }
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
    if (bullet.split && bullet.split.count > 0) {
      bullet.split.timer -= delta;
      if (bullet.split.timer <= 0) {
        bullet.split.count -= 1;
        bullet.split.timer += bullet.split.interval;
        const angle = Math.atan2(bullet.vy, bullet.vx);
        const spread = bullet.split.spread || 0.4;
        const speed = Math.hypot(bullet.vx, bullet.vy) || 100;
        const template = { ...bullet.split };
        [-spread, spread].forEach((offset) => {
          const dir = angle + offset;
          const clone = duplicateBullet(bullet, {
            vx: Math.cos(dir) * speed,
            vy: Math.sin(dir) * speed,
          });
          if (clone.split) clone.split = { ...template };
          run.bullets.push(clone);
        });
      }
    }
    if (bullet.impactBlast && bullet.y >= (bullet.impactBlast.triggerY || (bullet.impactBlast.y || HEIGHT - 20))) {
      spawnRadialBlast(run, {
        x: bullet.x,
        y: bullet.impactBlast.y || HEIGHT - 20,
        radius: bullet.impactBlast.radius,
        warn: bullet.impactBlast.warn || 0,
        duration: bullet.impactBlast.duration || 1,
        damage: bullet.impactBlast.damage || bullet.damage,
      });
      run.bullets.splice(i, 1);
      continue;
    }
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
      const effectiveRadius = getBulletRadius(run, bullet);
      const dist = Math.hypot(bullet.x - player.x, bullet.y - player.y);
      if (dist < effectiveRadius + player.radius) {
        applyDamage(run, player, bullet.damage);
        if (bullet.poison) {
          applyPoison(player, bullet.poison.duration, bullet.poison.dps);
        }
        explodeBullet(run, bullet);
        run.bullets.splice(i, 1);
      }
    } else if (bullet.type === 'square') {
      const effectiveSize = getBulletSize(run, bullet);
      if (
        Math.abs(bullet.x - player.x) < effectiveSize / 2 + player.radius &&
        Math.abs(bullet.y - player.y) < effectiveSize / 2 + player.radius
      ) {
        applyDamage(run, player, bullet.damage);
        if (bullet.poison) {
          applyPoison(player, bullet.poison.duration, bullet.poison.dps);
        }
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
      bullet.vx = (bullet.baseVx ?? bullet.vx) + offset;
    } else {
      bullet.vy = (bullet.baseVy ?? bullet.vy) + offset;
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
      bullet.vx = (bullet.baseVx ?? bullet.vx) + magnitude;
    } else {
      bullet.vy = (bullet.baseVy ?? bullet.vy) + magnitude;
    }
  }
  if (bullet.retreat) {
    if (bullet.retreat.originVx === undefined) {
      bullet.retreat.originVx = bullet.baseVx ?? bullet.vx;
      bullet.retreat.originVy = bullet.baseVy ?? bullet.vy;
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
      bullet.vx = bullet.baseVx ?? bullet.vx;
      bullet.vy = bullet.baseVy ?? bullet.vy;
    }
  }
  if (bullet.wander) {
    bullet.wander.timer -= delta;
    if (bullet.wander.timer <= 0) {
      bullet.wander.timer += bullet.wander.interval;
      const angle = rand(0, Math.PI * 2);
      const speed = bullet.wander.speed || Math.hypot(bullet.vx, bullet.vy) || 120;
      bullet.vx = Math.cos(angle) * speed;
      bullet.vy = Math.sin(angle) * speed;
    }
  }
  if (bullet.squareWave) {
    bullet.squareWave.timer -= delta;
    if (bullet.squareWave.timer <= 0) {
      bullet.squareWave.timer += bullet.squareWave.interval;
      bullet.squareWave.dir = -(bullet.squareWave.dir || 1);
    }
    const magnitude = bullet.squareWave.magnitude * (bullet.squareWave.dir || 1);
    if (bullet.squareWave.axis === 'x') {
      bullet.vx = bullet.baseVx ?? bullet.vx;
      bullet.vy = magnitude;
    } else {
      bullet.vy = bullet.baseVy ?? bullet.vy;
      bullet.vx = magnitude;
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
  if (bullet.sizeGrowth) {
    const key = bullet.sizeGrowth.mode === 'size' ? 'size' : 'radius';
    const current = bullet[key] || 0;
    const dir = current < bullet.sizeGrowth.target ? 1 : -1;
    bullet[key] = current + dir * bullet.sizeGrowth.speed * delta;
    if (
      (dir > 0 && bullet[key] >= bullet.sizeGrowth.target) ||
      (dir < 0 && bullet[key] <= bullet.sizeGrowth.target)
    ) {
      bullet[key] = bullet.sizeGrowth.target;
      delete bullet.sizeGrowth;
    }
  }
  if (bullet.gravity) {
    bullet.vy += bullet.gravity * delta;
  }
  if (bullet.spin) {
    bullet.angle = (bullet.angle || 0) + bullet.spin * delta;
  }
  if (bullet.accel) {
    const dirSpeed = Math.hypot(bullet.vx, bullet.vy) || 1;
    const normX = bullet.vx / dirSpeed;
    const normY = bullet.vy / dirSpeed;
    bullet.vx += normX * bullet.accel * delta;
    bullet.vy += normY * bullet.accel * delta;
  }
  if (bullet.curve) {
    const speed = Math.hypot(bullet.vx, bullet.vy) || 1;
    const angle = Math.atan2(bullet.vy, bullet.vx) + bullet.curve * (bullet.curveDir || 1) * delta;
    bullet.vx = Math.cos(angle) * speed;
    bullet.vy = Math.sin(angle) * speed;
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
          } else if (Math.abs(player.x - hazard.offset) < hazard.width) {
            applyDamage(run, player, hazard.damage);
          }
        }
      }
    } else if (hazard.type === 'roadblock') {
      hazard.life -= delta;
      hazard.timer -= delta;
      if (hazard.timer <= 0) {
        hazard.active = !hazard.active;
        hazard.timer = hazard.blink;
      }
      if (hazard.active && player.invuln <= 0) {
        if (
          Math.abs(player.x - hazard.x) < hazard.size / 2 &&
          Math.abs(player.y - hazard.y) < hazard.size / 2
        ) {
          applyDamage(run, player, hazard.damage);
        }
      }
      if (hazard.life <= 0) {
        run.hazards.splice(i, 1);
      }
    } else if (hazard.type === 'pelletBurst') {
      hazard.timer -= delta;
      if (hazard.timer <= 0) {
        const count = hazard.count;
        for (let j = 0; j < count; j++) {
          const angle = (Math.PI * 2 * j) / count;
          run.bullets.push({
            x: hazard.x,
            y: hazard.y,
            vx: Math.cos(angle) * hazard.speed,
            vy: Math.sin(angle) * hazard.speed,
            radius: 4,
            type: 'circle',
            color: '#ffd86f',
            damage: hazard.damage,
          });
        }
        audio.play('bullet');
        run.hazards.splice(i, 1);
      }
    } else if (hazard.type === 'emp') {
      hazard.timer -= delta;
      if (hazard.timer <= 0) {
        run.hazards.splice(i, 1);
      }
    } else if (hazard.type === 'announcer') {
      hazard.timer -= delta;
      if (hazard.state === 'warn') {
        if (hazard.timer <= 0) {
          hazard.state = 'boom';
          hazard.timer = hazard.duration;
          hazard.elapsed = 0;
        }
      } else {
        hazard.elapsed += delta;
        const pct = Math.max(0, 1 - hazard.timer / hazard.duration);
        const swing = pct < 0.5 ? pct * 2 : (1 - pct) * 2;
        hazard.currentRadius = hazard.radius * swing;
        if (hazard.timer <= 0) {
          run.hazards.splice(i, 1);
          continue;
        }
        if (player.invuln <= 0) {
          if (Math.hypot(player.x - hazard.x, player.y - hazard.y) < hazard.currentRadius) {
            applyDamage(run, player, hazard.damage);
          }
        }
      }
    } else if (hazard.type === 'sniperLaser') {
      if (hazard.telegraph > 0) {
        hazard.telegraph -= delta;
        if (hazard.telegraph <= 0 && !hazard.endpointBlast) {
          const tip = getLaserEdgeIntersection(hazard.origin, hazard.direction, hazard.length);
          spawnRadialBlast(run, {
            x: tip.x,
            y: tip.y,
            radius: 45,
            warn: 0,
            duration: 0.6,
            damage: 12 + (hazard.level || 1) * 2,
          });
          hazard.endpointBlast = true;
        }
      } else {
        hazard.duration -= delta;
        if (hazard.duration <= 0) {
          run.hazards.splice(i, 1);
          continue;
        }
        if (player.invuln <= 0) {
          const dist = pointLineDistance(player.x, player.y, hazard.origin, hazard.direction);
          if (dist < hazard.width) {
            applyDamage(run, player, hazard.damage);
          }
        }
      }
    } else if (hazard.type === 'lightning') {
      hazard.timer -= delta;
      if (hazard.timer <= 0) {
        hazard.vertices.forEach((vertex) => {
          spawnRadialBlast(run, {
            x: vertex.x,
            y: vertex.y,
            radius: 40 + hazard.level * 4,
            warn: 0,
            duration: 0.6,
            damage: 10 + hazard.level,
          });
        });
        run.hazards.splice(i, 1);
      }
    } else if (hazard.type === 'laserQueue') {
      hazard.timer -= delta;
      if (hazard.timer <= 0) {
        spawnLaser(run, hazard.level);
        hazard.remaining -= 1;
        hazard.timer = hazard.interval;
        if (hazard.remaining <= 0) {
          run.hazards.splice(i, 1);
        }
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
        const pellets = 6 + hazard.level;
        spawnRing(run, hazard.x, hazard.y, pellets, 150 + hazard.level * 12, '#ffe682', 8 + hazard.level);
        run.hazards.splice(i, 1);
      }
    } else if (hazard.type === 'dirge') {
      hazard.timer -= delta;
      hazard.angle += delta * (0.8 + hazard.level * 0.15);
      hazard.emit -= delta;
      if (hazard.emit <= 0) {
        hazard.emit = 0.35;
        const shots = 10 + hazard.level * 2;
        for (let j = 0; j < shots; j++) {
          const theta = hazard.angle + (Math.PI * 2 * j) / shots;
          run.bullets.push({
            x: WIDTH / 2,
            y: HEIGHT / 2,
            vx: Math.cos(theta) * (140 + hazard.level * 15),
            vy: Math.sin(theta) * (140 + hazard.level * 15),
            radius: 4,
            type: 'circle',
            color: '#ff9ed1',
            damage: 8 + hazard.level,
            ignoreGravity: true,
          });
        }
        audio.play('bullet');
      }
      if (hazard.timer <= 0) {
        run.hazards.splice(i, 1);
      }
    } else if (hazard.type === 'worm') {
      hazard.angle += rand(-0.8, 0.8) * delta;
      const dirX = Math.cos(hazard.angle);
      const dirY = Math.sin(hazard.angle);
      const head = hazard.segments[0];
      head.x += dirX * hazard.speed * delta;
      head.y += dirY * hazard.speed * delta;
      for (let j = 1; j < hazard.segments.length; j++) {
        const prev = hazard.segments[j - 1];
        const seg = hazard.segments[j];
        seg.x += (prev.x - seg.x) * 5 * delta;
        seg.y += (prev.y - seg.y) * 5 * delta;
      }
      hazard.blinkTimer -= delta;
      if (hazard.blinkTimer <= 0) {
        hazard.blinkTimer += hazard.blink;
        hazard.visible = !hazard.visible;
      }
      if (
        head.x < -80 ||
        head.x > WIDTH + 80 ||
        head.y < -80 ||
        head.y > HEIGHT + 80
      ) {
        run.hazards.splice(i, 1);
        continue;
      }
      if ((hazard.visible ?? true) && player.invuln <= 0) {
        for (let j = 0; j < hazard.segments.length; j++) {
          if (Math.hypot(player.x - hazard.segments[j].x, player.y - hazard.segments[j].y) < 18) {
            applyDamage(run, player, 10 + hazard.level);
            break;
          }
        }
      }
    } else if (hazard.type === 'wave') {
      if (hazard.warn > 0) {
        hazard.warn -= delta;
        if (hazard.warn <= 0) {
          hazard.timer = hazard.duration;
          hazard.emit = 0;
        }
      } else {
        hazard.timer -= delta;
        hazard.emit -= delta;
        if (hazard.emit <= 0) {
          hazard.emit = 0.12;
          const count = 6 + hazard.level * 3;
          for (let j = 0; j < count; j++) {
            if (hazard.axis === 'horizontal') {
              const span = hazard.width / Math.max(1, count - 1);
              const base = hazard.position - hazard.width / 2 + span * j;
              const y = clamp(base + rand(-span * 0.35, span * 0.35), 10, HEIGHT - 10);
              const fromLeft = hazard.side === 'start';
              run.bullets.push({
                x: fromLeft ? -20 : WIDTH + 20,
                y,
                vx: (fromLeft ? 1 : -1) * (260 + hazard.level * 20),
                vy: 0,
                radius: 4,
                type: 'circle',
                color: '#8cd1ff',
                damage: 9 + hazard.level,
              });
            } else {
              const span = hazard.width / Math.max(1, count - 1);
              const base = hazard.position - hazard.width / 2 + span * j;
              const x = clamp(base + rand(-span * 0.35, span * 0.35), 10, WIDTH - 10);
              const fromTop = hazard.side === 'start';
              run.bullets.push({
                x,
                y: fromTop ? -20 : HEIGHT + 20,
                vx: 0,
                vy: (fromTop ? 1 : -1) * (260 + hazard.level * 20),
                radius: 4,
                type: 'circle',
                color: '#8cd1ff',
                damage: 9 + hazard.level,
              });
            }
          }
        }
        if (hazard.timer <= 0) {
          run.hazards.splice(i, 1);
        }
      }
    } else if (hazard.type === 'chaosBurst') {
      hazard.timer -= delta;
      if (hazard.timer <= 0) {
        const count = 4 + hazard.level * 2;
        for (let j = 0; j < count; j++) {
          const angle = (Math.PI * 2 * j) / count;
          run.bullets.push({
            x: hazard.x,
            y: hazard.y,
            vx: Math.cos(angle) * (120 + hazard.level * 12),
            vy: Math.sin(angle) * (120 + hazard.level * 12),
            radius: 4,
            type: 'circle',
            color: '#ffd977',
            damage: 9 + hazard.level,
            spin: 4,
            curve: 1.2,
            curveDir: j % 2 === 0 ? 1 : -1,
          });
        }
        audio.play('bullet');
        run.hazards.splice(i, 1);
      }
    } else if (hazard.type === 'chain') {
      hazard.timer -= delta;
      if (hazard.timer <= 0) {
        if (hazard.index >= hazard.events.length) {
          run.hazards.splice(i, 1);
          continue;
        }
        const point = hazard.events[hazard.index];
        hazard.index += 1;
        spawnRadialBlast(run, {
          x: point.x,
          y: point.y,
          radius: 35 + hazard.level * 5,
          warn: 0.3,
          damage: 8 + hazard.level,
        });
        hazard.timer = 0.25;
      }
    } else if (hazard.type === 'slowZone') {
      hazard.timer -= delta;
      if (hazard.timer <= 0) {
        run.hazards.splice(i, 1);
        continue;
      }
      hazard.currentRadius = hazard.radius * (hazard.timer / hazard.duration);
      if (player.invuln <= 0) {
        if (Math.hypot(player.x - hazard.x, player.y - hazard.y) < hazard.currentRadius) {
          player.empTimer = Math.max(player.empTimer, 2);
          player.empSlow = 0.25;
          player.staminaSlowTimer = Math.max(player.staminaSlowTimer, 2);
        }
      }
    } else if (hazard.type === 'preemptStrike') {
      const dir = hazard.dir && (hazard.dir.x || hazard.dir.y)
        ? hazard.dir
        : { x: 1, y: 0 };
      const len = Math.hypot(dir.x, dir.y) || 1;
      const norm = { x: dir.x / len, y: dir.y / len };
      hazard.x += norm.x * 220 * delta;
      hazard.y += norm.y * 220 * delta;
      hazard.life -= delta;
      if (hazard.life <= 0) {
        spawnRadialBlast(run, {
          x: hazard.x,
          y: hazard.y,
          radius: 40 + hazard.level * 5,
          damage: 7 + hazard.level,
          warn: 0.2,
        });
        run.hazards.splice(i, 1);
      }
    } else if (hazard.type === 'gravityNet') {
      hazard.timer -= delta;
      run.bullets.forEach((bullet) => {
        if (bullet.warning > 0) return;
        const dx = hazard.x - bullet.x;
        const dy = hazard.y - bullet.y;
        const dist = Math.hypot(dx, dy) || 1;
        const pull = (hazard.strength / dist) * delta;
        bullet.vx += (dx / dist) * pull;
        bullet.vy += (dy / dist) * pull;
      });
      if (hazard.timer <= 0) {
        run.hazards.splice(i, 1);
      }
    } else {
      run.hazards.splice(i, 1);
    }
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
  const banned = run.lastChoiceIds || [];
  const filtered = pool.filter((choice) => !banned.includes(choice.id));
  const source = filtered.length >= total ? filtered : pool;
  const options = new Set();
  while (options.size < total && source.length) {
    options.add(source[randInt(0, source.length - 1)]);
    if (source.length <= options.size) break;
  }
  const picks = options.size ? [...options] : CHOICES.slice(0, total);
  run.lastChoiceIds = picks.map((choice) => choice.id);
  return picks;
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
    drawBulletShape(run, bullet);
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
    } else if (hazard.type === 'roadblock') {
      ctx.fillStyle = hazard.active ? 'rgba(255,120,120,0.45)' : 'rgba(255,255,255,0.18)';
      ctx.fillRect(hazard.x - hazard.size / 2, hazard.y - hazard.size / 2, hazard.size, hazard.size);
    } else if (hazard.type === 'pelletBurst') {
      ctx.strokeStyle = 'rgba(255,216,111,0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hazard.x, hazard.y, 20, 0, Math.PI * 2);
      ctx.stroke();
    } else if (hazard.type === 'emp') {
      ctx.fillStyle = 'rgba(120,170,255,0.15)';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    } else if (hazard.type === 'announcer') {
      if (hazard.state === 'warn') {
        ctx.save();
        const warnTime = hazard.warnTime || 1;
        const progress = clamp(1 - hazard.timer / warnTime, 0, 1);
        const swing = progress < 0.5 ? progress / 0.5 : (1 - progress) / 0.5;
        const alpha = 0.15 + swing * 0.35;
        ctx.strokeStyle = `rgba(255,230,140,${alpha + 0.2})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(hazard.x, hazard.y, hazard.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(255,230,140,${alpha})`;
        ctx.beginPath();
        ctx.arc(hazard.x, hazard.y, hazard.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.save();
        ctx.fillStyle = 'rgba(255,150,120,0.35)';
        ctx.beginPath();
        ctx.arc(hazard.x, hazard.y, hazard.currentRadius || hazard.radius * 0.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    } else if (hazard.type === 'sniperLaser') {
      ctx.strokeStyle = hazard.telegraph > 0 ? 'rgba(255,255,255,0.2)' : '#ff7c7c';
      ctx.lineWidth = hazard.width * 2;
      ctx.beginPath();
      const length = hazard.length || Math.max(WIDTH, HEIGHT) * 2.5;
      ctx.moveTo(
        hazard.origin.x - hazard.direction.x * length,
        hazard.origin.y - hazard.direction.y * length,
      );
      ctx.lineTo(
        hazard.origin.x + hazard.direction.x * length,
        hazard.origin.y + hazard.direction.y * length,
      );
      ctx.stroke();
    } else if (hazard.type === 'lightning') {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      hazard.vertices.forEach((point, idx) => {
        if (idx === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
    } else if (hazard.type === 'laserQueue') {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.moveTo(WIDTH - 30, 40);
      ctx.lineTo(WIDTH - 10, 40);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (hazard.type === 'lantern') {
      ctx.fillStyle = 'rgba(255,230,130,0.6)';
      ctx.beginPath();
      ctx.arc(hazard.x, hazard.y, 8 + hazard.level * 1.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (hazard.type === 'dirge') {
      ctx.strokeStyle = 'rgba(255,158,209,0.25)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(WIDTH / 2, HEIGHT / 2, 26 + hazard.level * 6, 0, Math.PI * 2);
      ctx.stroke();
    } else if (hazard.type === 'worm') {
      ctx.fillStyle = (hazard.visible ?? true) ? 'rgba(255,120,120,0.5)' : 'rgba(255,255,255,0.15)';
      hazard.segments.forEach((seg) => {
        ctx.fillRect(seg.x - 10, seg.y - 10, 20, 20);
      });
    } else if (hazard.type === 'wave') {
      ctx.fillStyle = 'rgba(140,209,255,0.15)';
      if (hazard.warn > 0) {
        ctx.strokeStyle = 'rgba(140,209,255,0.35)';
        ctx.lineWidth = 4;
      } else {
        ctx.strokeStyle = 'rgba(140,209,255,0.6)';
        ctx.lineWidth = 2;
      }
      if (hazard.axis === 'horizontal') {
        ctx.strokeRect(0, hazard.position - hazard.width / 2, WIDTH, hazard.width);
        ctx.fillRect(0, hazard.position - hazard.width / 2, WIDTH, hazard.width);
      } else {
        ctx.strokeRect(hazard.position - hazard.width / 2, 0, hazard.width, HEIGHT);
        ctx.fillRect(hazard.position - hazard.width / 2, 0, hazard.width, HEIGHT);
      }
    } else if (hazard.type === 'chaosBurst') {
      ctx.strokeStyle = 'rgba(255,217,119,0.4)';
      ctx.beginPath();
      ctx.arc(hazard.x, hazard.y, 24 + hazard.level * 4, 0, Math.PI * 2);
      ctx.stroke();
    } else if (hazard.type === 'chain') {
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      hazard.events.forEach((point, idx) => {
        if (idx < hazard.index) return;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 10, 0, Math.PI * 2);
        ctx.stroke();
      });
    } else if (hazard.type === 'slowZone') {
      const radius = hazard.currentRadius || hazard.radius;
      ctx.fillStyle = 'rgba(120,170,255,0.15)';
      ctx.beginPath();
      ctx.arc(hazard.x, hazard.y, radius, 0, Math.PI * 2);
      ctx.fill();
    } else if (hazard.type === 'preemptStrike') {
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 3;
      const dir = hazard.dir && (hazard.dir.x || hazard.dir.y) ? hazard.dir : { x: 1, y: 0 };
      ctx.beginPath();
      ctx.moveTo(hazard.x, hazard.y);
      ctx.lineTo(hazard.x - dir.x * 12, hazard.y - dir.y * 12);
      ctx.stroke();
    } else if (hazard.type === 'gravityNet') {
      ctx.strokeStyle = 'rgba(180,255,255,0.3)';
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(hazard.x, hazard.y, 50, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
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

function drawBulletShape(run, bullet) {
  const shape = bullet.shape || (bullet.type === 'circle' ? 'circle' : 'square');
  const color = bullet.color || '#ffffff';
  const size = getBulletSize(run, bullet);
  const radius = getBulletRadius(run, bullet);
  ctx.fillStyle = color;
  switch (shape) {
    case 'ring': {
      const lw = ctx.lineWidth;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, radius, 0, Math.PI * 2);
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
    case 'hammer': {
      ctx.save();
      ctx.translate(bullet.x, bullet.y);
      ctx.rotate(bullet.angle || 0);
      const head = size * 0.55;
      const handle = size * 0.2;
      ctx.fillRect(-head / 2, -head / 2, head, head);
      ctx.fillRect(-handle / 2, head / 2 - handle / 2, handle, size);
      ctx.restore();
      break;
    }
    case 'skull': {
      ctx.save();
      ctx.translate(bullet.x, bullet.y);
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#05070c';
      ctx.beginPath();
      ctx.arc(-radius / 3, -radius / 4, radius / 6, 0, Math.PI * 2);
      ctx.arc(radius / 3, -radius / 4, radius / 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-radius / 3, radius / 4, (radius * 2) / 3, radius / 4);
      ctx.restore();
      ctx.fillStyle = color;
      break;
    }
    case 'square': {
      ctx.fillRect(bullet.x - size / 2, bullet.y - size / 2, size, size);
      break;
    }
    case 'circle':
    default: {
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, radius, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
  ctx.fillStyle = color;
}

function drawPlayerShape(player) {
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(player.spin || 0);
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
