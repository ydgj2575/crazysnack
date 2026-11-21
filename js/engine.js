/**
 * =====================================================================
 *  躲避蛇 · 纯逻辑引擎（不依赖 DOM，可在 Node 中直接测试）
 * =====================================================================
 *
 *  ★ 即时制（实时）：取消回合制 —— 「我」和蛇都可以自由行动。
 *    - 我：按住方向键就持续移动，每 BALANCE.playerStepMs 毫秒走一格；
 *    - 蛇：每条蛇有自己的移动计时器，到点就朝我走一格（约 2.4 格/秒）；
 *          只剩蛇头的蛇更慢（约 1.1 格/秒）；
 *    - 所有计时都用调用方传入的 `now`（毫秒）驱动，引擎本身不读时钟，方便测试。
 *
 *  规则（详见同目录 ../需求说明.md）：
 *    - 地图四周一圈「墙」，中间空地上有「我」和多条「蛇」；
 *    - 「我」有 5 点生命，每被蛇头碰到一次扣 1 点；被撞后短暂无敌（BALANCE.invulnMs）；
 *    - 「我」撞到蛇的**蛇身**会让这条蛇断开：
 *      被撞到的那一节**不会消失**，而是自己变成一条**独立的蛇**（长度 1，只有它一个蛇头）；
 *      断点前面的部分保留原蛇头、断点后面的部分也变成独立的蛇；
 *      我撞在蛇身上会被挡住（身后有空格会被反作用力弹开一格），分出来的几截短暂僵直；
 *    - 只剩蛇头（长度 1）的小蛇可以被「我」撞开一格（同样扣生命），用来摆脱包围；
 *    - 蛇头自动朝「我」寻路移动，身体像小火车一样跟随
 *      （第 k 节走到第 k-1 节的旧位置）；
 *    - 当场上所有蛇的长度都变成 1（每条蛇只剩蛇头）时，玩家胜利。
 *
 *  蛇的算法来自 ..\worddage\js\engine.js 的「蛇」实现：
 *    - 4 邻接成链、按「头 → 尾」排列、
 *    - 头走一格后身体依次移动到前一节的旧位置（小火车跟随）、
 *    - 可复现的伪随机数（用于蛇寻路时的同距离方向打乱）。
 *  本作把「第一个蛇随机走一格」改成「蛇头用 BFS 朝我寻路走一格」。
 *
 *  本文件同时支持两种加载方式：
 *    - 浏览器：<script src="js/engine.js"></script> 后使用 window.SnakeDodge
 *    - Node：require("../js/engine.js") 或 vm 沙箱，引擎挂在 globalThis.SnakeDodge
 * =====================================================================
 */
(function (root) {
  "use strict";

  /* ================= 方向 ================= */

  var DIRS = {
    up: { dx: 0, dy: -1 },
    down: { dx: 0, dy: 1 },
    left: { dx: -1, dy: 0 },
    right: { dx: 1, dy: 0 },
  };
  var DIR_NAMES = ["up", "down", "left", "right"];

  /* ================= 三档难度 =================
   * 需求：简单 15×15 地图 1 条蛇；普通 20×20 地图 2 条蛇；困难 30×30 地图 3 条蛇。
   * 每条蛇初始长度都是 10；「我」固定 5 点生命；地图四周一圈墙。
   * snakeRegions 是每条蛇初始蜷曲的区域（蛇身呈蛇形铺满该区域），
   * 区域都避开了地图正中心的「我」，且互不重叠。
   */
  var DIFFICULTIES = {
    easy: {
      id: "easy",
      name: "简单模式",
      short: "简单",
      cols: 15,
      rows: 15,
      snakeCount: 1,
      snakeLength: 10,
      hp: 5,
      seed: 20261122,
      desc: "15×15 地图 · 1 条长 10 的蛇",
      tip: "适合先熟悉「撞断蛇身」的手感",
      snakeRegions: [{ x1: 2, y1: 1, x2: 12, y2: 2 }],
    },
    normal: {
      id: "normal",
      name: "普通模式",
      short: "普通",
      cols: 20,
      rows: 20,
      snakeCount: 2,
      snakeLength: 10,
      hp: 5,
      seed: 20261123,
      desc: "20×20 地图 · 2 条长 10 的蛇",
      tip: "两条蛇会同时朝你游过来",
      snakeRegions: [
        { x1: 3, y1: 1, x2: 16, y2: 2 },
        { x1: 3, y1: 17, x2: 16, y2: 18 },
      ],
    },
    hard: {
      id: "hard",
      name: "困难模式",
      short: "困难",
      cols: 30,
      rows: 30,
      snakeCount: 3,
      snakeLength: 10,
      hp: 5,
      seed: 20261124,
      desc: "30×30 地图 · 3 条长 10 的蛇",
      tip: "三条蛇三面夹击，切开后蛇头会更多",
      snakeRegions: [
        { x1: 8, y1: 1, x2: 25, y2: 2 },
        { x1: 8, y1: 27, x2: 25, y2: 28 },
        { x1: 1, y1: 11, x2: 8, y2: 14 },
      ],
    },
  };
  var DIFFICULTY_ORDER = ["easy", "normal", "hard"];

  /** 每条蛇一种颜色（切出来的独立蛇颜色不同，方便分辨） */
  var SNAKE_COLORS = ["#5d8f4a", "#4f7f9f", "#a06a44", "#7a5f9f", "#8f8f3f", "#3f8f7f", "#9f4f6f", "#5f5f9f"];
  var SNAKE_HEAD_COLORS = ["#7fb05f", "#6fa0bf", "#c98a5f", "#9a7fbf", "#b0b05f", "#5faf9f", "#bf6f8f", "#7f7fbf"];

  /**
   * 平衡参数（开发/调平衡用，游戏内规则面板有说明）
   * 所有时间都是毫秒，由调用 update(now) / tryMove(dir, now) 传入。
   *
   * 撞断蛇身不会让蛇身消失，所以越到后期场上独立的蛇越多
   * （简单 10 条、普通 20 条、困难 30 条），因此：
   *   - 我比蛇快（150ms/格 ≈ 6.7 格/秒 vs 蛇 420ms/格 ≈ 2.4 格/秒）；
   *   - 只剩蛇头的蛇更慢（900ms/格 ≈ 1.1 格/秒）；
   *   - 被撞的蛇头会僵直，我也有一点无敌时间，避免被蛇群瞬间连撞。
   */
  var BALANCE = {
    playerStepMs: 190,
    snakeStepMs: 300,
    loneHeadStepMs: 650,
    stunMs: 700,
    invulnMs: 1000,
    animMs: 170,
    snakeStartDelayMs: 500,
    playerRetryMs: 80,
    snakeRetryMs: 160,
  };

  /* ================= 小工具 ================= */

  function keyOf(x, y) {
    return x + "," + y;
  }

  function manhattan(x1, y1, x2, y2) {
    return Math.abs(x1 - x2) + Math.abs(y1 - y2);
  }

  function cloneCell(c) {
    return { x: c.x, y: c.y };
  }

  function cloneCells(cells) {
    var out = [];
    for (var i = 0; i < cells.length; i++) out.push(cloneCell(cells[i]));
    return out;
  }

  /** 可复现的伪随机数（与 worddage 同款 LCG），同种子行为一致，方便测试 */
  function makeRng(seed) {
    var s = (seed >>> 0) || 1;
    return function rand() {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function shuffledDirs(rng) {
    var arr = DIR_NAMES.slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /** 地图正中心（偶数边长时取右下侧那一格，例如 10×10 → (5,5)） */
  function centerOf(cols, rows) {
    return { x: Math.floor(cols / 2), y: Math.floor(rows / 2) };
  }

  /* ================= 初始蛇身 ================= */

  /**
   * 把一条长度为 length 的蛇「蛇形」铺进矩形区域：
   * 第 1 行从左到右、第 2 行从右到左……保证相邻两节 4 邻接。
   */
  function serpentineCells(region, length) {
    var cells = [];
    var right = true;
    for (var y = region.y1; y <= region.y2 && cells.length < length; y++) {
      var x;
      if (right) {
        for (x = region.x1; x <= region.x2 && cells.length < length; x++) cells.push({ x: x, y: y });
      } else {
        for (x = region.x2; x >= region.x1 && cells.length < length; x--) cells.push({ x: x, y: y });
      }
      right = !right;
    }
    return cells;
  }

  /**
   * 生成初始蛇（头在 cells[0]）。规律：
   *   1. 在区域里蛇形铺满 length 格；
   *   2. 把离「我」更近的那一端当作蛇头（蛇头总是先朝我游过来）。
   */
  function buildInitialSnakes(cfg, player) {
    var snakes = [];
    for (var i = 0; i < cfg.snakeCount; i++) {
      var region = cfg.snakeRegions[i] || cfg.snakeRegions[cfg.snakeRegions.length - 1];
      var cells = serpentineCells(region, cfg.snakeLength);
      if (!cells.length) continue;
      var first = cells[0];
      var last = cells[cells.length - 1];
      if (manhattan(first.x, first.y, player.x, player.y) > manhattan(last.x, last.y, player.x, player.y)) {
        cells.reverse();
      }
      snakes.push(cells);
    }
    return snakes;
  }

  /* ================= 游戏主体 ================= */

  function Game(difficultyId) {
    this.reset(difficultyId || "easy");
  }

  Game.prototype.reset = function reset(difficultyId) {
    var id = DIFFICULTIES[difficultyId] ? difficultyId : "easy";
    var cfg = DIFFICULTIES[id];

    this.difficultyId = id;
    this.difficulty = cfg;
    this.cols = cfg.cols;
    this.rows = cfg.rows;
    this.hp = cfg.hp;
    this.maxHp = cfg.hp;
    this.player = centerOf(cfg.cols, cfg.rows);
    this.rng = makeRng(cfg.seed);

    // 四周一圈「墙」
    this.walls = new Set();
    for (var x = 0; x < cfg.cols; x++) {
      this.walls.add(keyOf(x, 0));
      this.walls.add(keyOf(x, cfg.rows - 1));
    }
    for (var y = 0; y < cfg.rows; y++) {
      this.walls.add(keyOf(0, y));
      this.walls.add(keyOf(cfg.cols - 1, y));
    }

    // 蛇：头在 cells[0]，长度 10
    this.nextSnakeId = 1;
    this.snakes = [];
    var initial = buildInitialSnakes(cfg, this.player);
    for (var i = 0; i < initial.length; i++) {
      this.snakes.push(this.makeSnake(initial[i]));
    }

    this.steps = 0; // 我行动（走格/撞击）的次数
    this.status = "playing"; // playing | won | lost
    this.winReason = null;
    this.lastEvent = null;

    // 即时制的计时状态（毫秒时间戳，由调用方传入 now）
    this.playerNextMoveAt = 0;
    this.playerInvulnUntil = 0;
    this.playerAnim = null;
    this.lastTurn = { events: [], hit: false, cut: false };
    return this;
  };

  Game.prototype.restart = function restart() {
    return this.reset(this.difficultyId);
  };

  Game.prototype.makeSnake = function makeSnake(cells) {
    var id = this.nextSnakeId++;
    return {
      id: id,
      cells: cloneCells(cells),
      color: SNAKE_COLORS[(id - 1) % SNAKE_COLORS.length],
      headColor: SNAKE_HEAD_COLORS[(id - 1) % SNAKE_HEAD_COLORS.length],
      stunnedUntil: 0, // 僵直到什么时候（毫秒时间戳）
      nextMoveAt: null, // 下一次行动时间（null 表示还没初始化，等 update 里错开启动）
      anim: null, // { from: cells|null, start: now }
    };
  };

  /* ---------------- 基础查询 ---------------- */

  Game.prototype.inBounds = function inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  };

  Game.prototype.isWall = function isWall(x, y) {
    return this.walls.has(keyOf(x, y));
  };

  /** 该格是哪条蛇的第几节（index 0 是蛇头）；空格返回 null */
  Game.prototype.cellOccupant = function cellOccupant(x, y) {
    for (var s = 0; s < this.snakes.length; s++) {
      var snake = this.snakes[s];
      for (var i = 0; i < snake.cells.length; i++) {
        if (snake.cells[i].x === x && snake.cells[i].y === y) return { snake: snake, index: i };
      }
    }
    return null;
  };

  Game.prototype.snakeAt = function snakeAt(x, y) {
    var occ = this.cellOccupant(x, y);
    return occ ? occ.snake : null;
  };

  /** 所有蛇的长度数组，例如 [10, 10] */
  Game.prototype.snakeLengths = function snakeLengths() {
    var out = [];
    for (var i = 0; i < this.snakes.length; i++) out.push(this.snakes[i].cells.length);
    return out;
  };

  /** 蛇的汇总信息（HUD 用） */
  Game.prototype.snakeStats = function snakeStats() {
    var lengths = this.snakeLengths();
    var total = 0;
    var max = 0;
    for (var i = 0; i < lengths.length; i++) {
      total += lengths[i];
      if (lengths[i] > max) max = lengths[i];
    }
    // dValue = 场上蛇身总节数 - 蛇的条数；每条蛇都只剩 1 节时 dValue = 0（胜利）
    var dValue = Math.max(0, total - lengths.length);
    var initial = this.difficulty
      ? this.difficulty.snakeCount * (this.difficulty.snakeLength - 1)
      : dValue;
    return {
      count: lengths.length,
      lengths: lengths,
      total: total,
      max: max,
      dValue: dValue,
      progress: initial > 0 ? Math.min(1, Math.max(0, 1 - dValue / initial)) : 1,
    };
  };

  /** 胜利条件：场上所有蛇的长度都是 1 */
  Game.prototype.allLengthOne = function allLengthOne() {
    if (!this.snakes.length) return false;
    for (var i = 0; i < this.snakes.length; i++) {
      if (this.snakes[i].cells.length !== 1) return false;
    }
    return true;
  };

  /** 这条蛇现在是不是僵直状态（给渲染/测试用） */
  Game.prototype.isStunned = function isStunned(snake, now) {
    return snake.stunnedUntil > now;
  };

  /** 这条蛇多久走一格（毫秒）：只剩蛇头的蛇更慢 */
  Game.prototype.intervalOf = function intervalOf(snake) {
    return snake.cells.length === 1 ? BALANCE.loneHeadStepMs : BALANCE.snakeStepMs;
  };

  /** 状态指纹（测试用：同时间序列 + 同操作序列应当得到相同指纹） */
  Game.prototype.fingerprint = function fingerprint() {
    var snakes = [];
    for (var i = 0; i < this.snakes.length; i++) {
      var s = this.snakes[i];
      snakes.push({
        id: s.id,
        cells: cloneCells(s.cells),
        stunnedUntil: s.stunnedUntil,
        nextMoveAt: s.nextMoveAt,
      });
    }
    return JSON.stringify({
      difficulty: this.difficultyId,
      player: this.player,
      hp: this.hp,
      steps: this.steps,
      status: this.status,
      playerNextMoveAt: this.playerNextMoveAt,
      playerInvulnUntil: this.playerInvulnUntil,
      snakes: snakes,
    });
  };

  /* ---------------- 我：自由移动（受移动速度限制） ---------------- */

  Game.prototype.blockedResult = function blockedResult(why) {
    var events = [{ type: "blocked", why: why }];
    this.lastEvent = events[0];
    return {
      moved: false,
      blocked: why,
      events: events,
      status: this.status,
      winReason: this.winReason,
      hp: this.hp,
      steps: this.steps,
    };
  };

  /**
   * 我尝试朝某个方向走一步（即时制：随时可以按，但受 playerStepMs 移动间隔限制）。
   *   - 空地 → 移动；
   *   - 蛇身 → 撞断（那条蛇断成 2~3 条独立蛇），我被挡住/可能被弹开一格；
   *   - 蛇头 → 扣 1 点生命（可能把只剩蛇头的小蛇撞开一格）。
   * @param {"up"|"down"|"left"|"right"} dirName
   * @param {number} now 当前时间（毫秒）
   */
  Game.prototype.tryMove = function tryMove(dirName, now) {
    now = Number(now) || 0;
    var dir = DIRS[dirName];
    if (!dir) return this.blockedResult("bad_dir");
    if (this.status !== "playing") return this.blockedResult(this.status);
    if (now < this.playerNextMoveAt) return this.blockedResult("cooldown");

    var nx = this.player.x + dir.dx;
    var ny = this.player.y + dir.dy;
    var from = { x: this.player.x, y: this.player.y };
    if (!this.inBounds(nx, ny)) {
      this.playerNextMoveAt = now + BALANCE.playerRetryMs;
      return this.blockedResult("edge");
    }
    if (this.isWall(nx, ny)) {
      this.playerNextMoveAt = now + BALANCE.playerRetryMs;
      return this.blockedResult("wall");
    }

    var events = [];
    this.playerAnim = null;
    var occ = this.cellOccupant(nx, ny);

    if (!occ) {
      // 走进空地
      this.player = { x: nx, y: ny };
      this.playerAnim = { from: from, start: now };
      this.playerNextMoveAt = now + BALANCE.playerStepMs;
      this.steps += 1;
      events.push({ type: "move", from: from, to: { x: nx, y: ny } });
    } else if (occ.index === 0) {
      // 撞到蛇头：扣生命；只剩蛇头的小蛇可以被撞开一格
      var headSnake = occ.snake;
      var pushed = false;
      if (headSnake.cells.length === 1) {
        var pushX = nx + dir.dx;
        var pushY = ny + dir.dy;
        if (this.inBounds(pushX, pushY) && !this.isWall(pushX, pushY) && !this.cellOccupant(pushX, pushY)) {
          headSnake.anim = { from: [cloneCell(headSnake.cells[0])], start: now };
          headSnake.cells[0] = { x: pushX, y: pushY };
          headSnake.nextMoveAt = null;
          this.player = { x: nx, y: ny };
          this.playerAnim = { from: from, start: now };
          pushed = true;
          events.push({
            type: "pushHead",
            snakeId: headSnake.id,
            from: { x: nx, y: ny },
            to: { x: pushX, y: pushY },
          });
          events.push({ type: "move", from: from, to: { x: nx, y: ny }, through: "pushHead" });
        }
      }
      this.damagePlayer(headSnake, now, events);
      this.playerNextMoveAt = now + BALANCE.playerStepMs;
      this.steps += 1;
    } else {
      // 撞到蛇身：那条蛇断开；我被挡住，身后有空格会被反作用力弹开一格
      this.splitSnake(occ.snake, occ.index, now, events);
      var back = { x: from.x - dir.dx, y: from.y - dir.dy };
      if (this.inBounds(back.x, back.y) && !this.isWall(back.x, back.y) && !this.cellOccupant(back.x, back.y)) {
        this.player = back;
        this.playerAnim = { from: from, start: now };
        events.push({ type: "move", from: from, to: back, through: "recoil" });
      }
      this.playerNextMoveAt = now + BALANCE.playerStepMs;
      this.steps += 1;
      // 胜利检查：所有蛇都只剩蛇头
      if (this.status === "playing" && this.allLengthOne()) {
        this.status = "won";
        this.winReason = "all_length_one";
        events.push({ type: "win", steps: this.steps, hp: this.hp });
      }
    }

    this.lastTurn = { events: events };
    this.lastEvent = events.length ? events[events.length - 1] : null;
    return {
      moved: this.player.x !== from.x || this.player.y !== from.y,
      blocked: null,
      events: events,
      status: this.status,
      winReason: this.winReason,
      hp: this.hp,
      steps: this.steps,
    };
  };

  /** 扣 1 点生命；被撞到的蛇头会被「撞晕」；我刚被撞过时短暂无敌 */
  Game.prototype.damagePlayer = function damagePlayer(snake, now, events) {
    if (this.status !== "playing") return false;
    if (now < this.playerInvulnUntil) {
      // 无敌时间内不再扣血，但蛇头也会被顶住/僵直一小段
      if (snake) snake.stunnedUntil = Math.max(snake.stunnedUntil, now + BALANCE.stunMs * 0.6);
      events.push({
        type: "blockedHit",
        snakeId: snake ? snake.id : null,
        at: snake ? cloneCell(snake.cells[0]) : cloneCell(this.player),
      });
      return false;
    }
    this.hp = Math.max(0, this.hp - 1);
    this.playerInvulnUntil = now + BALANCE.invulnMs;
    if (snake) snake.stunnedUntil = Math.max(snake.stunnedUntil, now + BALANCE.stunMs);
    events.push({
      type: "hit",
      snakeId: snake ? snake.id : null,
      at: snake ? cloneCell(snake.cells[0]) : cloneCell(this.player),
      hp: this.hp,
      maxHp: this.maxHp,
    });
    if (this.hp <= 0) {
      this.status = "lost";
      this.winReason = null;
      events.push({ type: "lose", at: cloneCell(this.player) });
    }
    return true;
  };

  /**
   * 我把蛇撞断：撞到的是第 index 节（index >= 1）。
   *   - 被撞的那一节**不会消失**，它自己变成一条独立的蛇（长度 1，只有它一个蛇头）；
   *   - 前段：第 0 ~ index-1 节，保留原蛇头，仍然是一条蛇；
   *   - 后段：第 index+1 ~ 末节，也变成一条独立的新蛇（蛇头是断点后面那一节）。
   *   - 分出来的几截都会僵直一段时间，这一段时间不会撞我。
   * 撞断不会减少蛇身总节数，只会让蛇的条数变多。
   */
  Game.prototype.splitSnake = function splitSnake(snake, index, now, events) {
    var oldCells = snake.cells;
    if (index < 1 || index >= oldCells.length) return null;
    var front = [];
    var rear = [];
    var i;
    for (i = 0; i < index; i++) front.push(cloneCell(oldCells[i]));
    for (i = index + 1; i < oldCells.length; i++) rear.push(cloneCell(oldCells[i]));
    var hitCell = cloneCell(oldCells[index]);

    // 前段保留原蛇（含原 id）
    snake.cells = front;
    snake.stunnedUntil = Math.max(snake.stunnedUntil, now + BALANCE.stunMs);
    snake.nextMoveAt = null;

    // 被撞的那一节变成独立的蛇（长度 1）
    var hitSnake = this.makeSnake([hitCell]);
    hitSnake.stunnedUntil = now + BALANCE.stunMs;
    hitSnake.anim = { from: null, start: now }; // 新蛇：渲染层做「弹出」动画
    this.snakes.push(hitSnake);

    // 断点后面的部分变成另一条独立的新蛇
    var rearSnake = null;
    if (rear.length) {
      rearSnake = this.makeSnake(rear);
      rearSnake.stunnedUntil = now + BALANCE.stunMs;
      rearSnake.anim = { from: null, start: now };
      this.snakes.push(rearSnake);
    }

    events.push({
      type: "split",
      snakeId: snake.id,
      hitSnakeId: hitSnake.id,
      newSnakeId: rearSnake ? rearSnake.id : null,
      at: hitCell,
      frontLength: front.length,
      hitLength: 1,
      rearLength: rear.length,
    });
    return hitSnake;
  };

  /* ---------------- 蛇的 AI：头朝我寻路 + 身体跟随（实时） ---------------- */

  /**
   * 推进蛇的行动：每条蛇到点就朝我走一格（每帧每条蛇最多走一格）。
   * 时间完全由 now 决定，引擎不读系统时钟。
   * @param {number} now 当前时间（毫秒）
   */
  Game.prototype.update = function update(now) {
    now = Number(now) || 0;
    var events = [];
    if (this.status !== "playing") return { events: events, status: this.status, hp: this.hp };

    var list = this.snakes.slice();
    for (var i = 0; i < list.length; i++) {
      if (this.status !== "playing") break;
      var snake = list[i];
      if (snake.stunnedUntil > now) continue;
      if (snake.nextMoveAt === null) {
        // 开局/刚分出来的蛇：错开出发时间，避免所有蛇同一帧一起动
        snake.nextMoveAt = now + BALANCE.snakeStartDelayMs + ((snake.id * 137) % 5) * 110;
        continue;
      }
      if (now < snake.nextMoveAt) continue;

      var step = this.nextStepFor(snake);
      if (!step) {
        snake.nextMoveAt = now + BALANCE.snakeRetryMs;
        events.push({ type: "snakeStuck", snakeId: snake.id });
        continue;
      }
      // 蛇头走到「我」身上：撞我（蛇头不进入我的格子）
      if (step.x === this.player.x && step.y === this.player.y) {
        this.damagePlayer(snake, now, events);
        snake.stunnedUntil = Math.max(snake.stunnedUntil, now + BALANCE.stunMs);
        snake.nextMoveAt = now + this.intervalOf(snake);
        continue;
      }
      var from = cloneCells(snake.cells);
      // 小火车跟随：从尾巴到头，第 k 节走到第 k-1 节的旧位置
      for (var k = snake.cells.length - 1; k >= 1; k--) {
        snake.cells[k] = { x: from[k - 1].x, y: from[k - 1].y };
      }
      snake.cells[0] = { x: step.x, y: step.y };
      snake.anim = { from: from, start: now };
      snake.nextMoveAt = now + this.intervalOf(snake);
      events.push({
        type: "snakeMove",
        snakeId: snake.id,
        from: cloneCell(from[0]),
        to: { x: step.x, y: step.y },
        length: snake.cells.length,
      });
    }
    return { events: events, status: this.status, hp: this.hp };
  };

  /**
   * 某条蛇这一帧能走的格子。
   * 计算 BFS 时：自己的蛇身（除尾巴，因为尾巴会移走）和别的蛇全身都是障碍，
   * 墙和边界也是障碍，「我」所在的格子是目标（走到就是撞我）。
   */
  Game.prototype.nextStepFor = function nextStepFor(snake) {
    var head = snake.cells[0];
    var player = this.player;
    var blocked = this.blockedSetFor(snake);
    var startKey = keyOf(head.x, head.y);
    var parent = new Map();
    parent.set(startKey, null);
    var queue = [{ x: head.x, y: head.y }];
    var qi = 0;
    var dirs = shuffledDirs(this.rng);
    var foundKey = null;

    while (qi < queue.length && !foundKey) {
      var cur = queue[qi++];
      for (var d = 0; d < dirs.length; d++) {
        var dir = DIRS[dirs[d]];
        var nx = cur.x + dir.dx;
        var ny = cur.y + dir.dy;
        if (!this.inBounds(nx, ny)) continue;
        if (this.isWall(nx, ny)) continue;
        var k = keyOf(nx, ny);
        if (parent.has(k)) continue;
        if (nx === player.x && ny === player.y) {
          parent.set(k, keyOf(cur.x, cur.y));
          foundKey = k;
          break;
        }
        if (blocked.has(k)) continue;
        parent.set(k, keyOf(cur.x, cur.y));
        queue.push({ x: nx, y: ny });
      }
    }

    if (foundKey) {
      // 从「我」的格子回溯到第一步
      var step = foundKey;
      var prev = parent.get(step);
      while (prev !== null && prev !== startKey) {
        step = prev;
        prev = parent.get(step);
      }
      var xy = step.split(",");
      return { x: Number(xy[0]), y: Number(xy[1]) };
    }

    // 被蛇身围死 / 无路可走：退而求其次，走一个离我更近的空格
    return this.fallbackStep(snake, blocked);
  };

  Game.prototype.blockedSetFor = function blockedSetFor(snake) {
    var blocked = new Set();
    for (var s = 0; s < this.snakes.length; s++) {
      var other = this.snakes[s];
      // 自己的尾巴这一步会空出来，可以走进去；其余蛇身都不能重叠
      var count = other === snake ? Math.max(0, other.cells.length - 1) : other.cells.length;
      for (var i = 0; i < count; i++) blocked.add(keyOf(other.cells[i].x, other.cells[i].y));
    }
    return blocked;
  };

  Game.prototype.fallbackStep = function fallbackStep(snake, blocked) {
    var head = snake.cells[0];
    var dirs = shuffledDirs(this.rng);
    var options = [];
    for (var d = 0; d < dirs.length; d++) {
      var dir = DIRS[dirs[d]];
      var nx = head.x + dir.dx;
      var ny = head.y + dir.dy;
      if (!this.inBounds(nx, ny)) continue;
      if (this.isWall(nx, ny)) continue;
      if (blocked.has(keyOf(nx, ny))) continue;
      var hits = nx === this.player.x && ny === this.player.y;
      options.push({
        x: nx,
        y: ny,
        dist: hits ? -1 : manhattan(nx, ny, this.player.x, this.player.y),
      });
    }
    if (!options.length) return null;
    options.sort(function (a, b) {
      return a.dist - b.dist;
    });
    return { x: options[0].x, y: options[0].y };
  };

  /* ================= 导出 ================= */

  var api = {
    Game: Game,
    DIFFICULTIES: DIFFICULTIES,
    DIFFICULTY_ORDER: DIFFICULTY_ORDER,
    DIRS: DIRS,
    DIR_NAMES: DIR_NAMES,
    SNAKE_COLORS: SNAKE_COLORS,
    SNAKE_HEAD_COLORS: SNAKE_HEAD_COLORS,
    BALANCE: BALANCE,
    makeRng: makeRng,
    centerOf: centerOf,
    serpentineCells: serpentineCells,
    buildInitialSnakes: buildInitialSnakes,
  };

  root.SnakeDodge = api;
  // Node 环境（CommonJS）下也能 require 到
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
