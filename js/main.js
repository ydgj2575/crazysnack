/**
 * =====================================================================
 *  躲避蛇 · 入口与交互层（即时制 / 实时）
 * =====================================================================
 *  负责：
 *    - 画布 DPR 尺寸 / 布局、逐帧渲染（玩家和蛇的移动都做平滑插值）；
 *    - 难度选择弹窗（游戏开始时必须选难度）、规则面板、结算弹窗；
 *    - 键盘 / 手机方向键 / 画布滑动输入：按住方向键就持续移动；
 *    - 每帧推进引擎（game.update(now)）：蛇按自己的计时器自由行动；
 *    - HUD、音效（WebAudio 合成，无外部资源）、最佳步数（localStorage）。
 *
 *  入口：<script src="js/engine.js"> → art.js → main.js（普通脚本，双击 index.html 也能玩）
 * =====================================================================
 */
(function (root) {
  "use strict";

  var SD = root.SnakeDodge || {};
  var Game = SD.Game;
  var DIFFICULTIES = SD.DIFFICULTIES;
  var DIFFICULTY_ORDER = SD.DIFFICULTY_ORDER;
  var art = SD.art;
  var computeLayout = art.computeLayout;
  var drawScene = art.drawScene;

  var $ = function (id) {
    return typeof document !== "undefined" ? document.getElementById(id) : null;
  };

  /* ==================================================================
   * DOM
   * ================================================================== */
  var canvas = $("game");
  var ctx = canvas && canvas.getContext ? canvas.getContext("2d") : null;

  var els = {
    stage: $("stage"),
    banner: $("banner"),
    hp: $("hp"),
    snakes: $("snakes"),
    steps: $("steps"),
    best: $("best"),
    mode: $("mode"),
    restart: $("restart"),
    rulesToggle: $("rules-toggle"),
    rules: $("rules"),
    rulesClose: $("rules-close"),
    changeDiff: $("change-diff"),
    startOverlay: $("start-overlay"),
    modalContinue: $("modal-continue"),
    resultOverlay: $("result-overlay"),
    resultTitle: $("result-title"),
    resultEyebrow: $("result-eyebrow"),
    resultDesc: $("result-desc"),
    resultStats: $("result-stats"),
    resultAgain: $("result-again"),
    resultChange: $("result-change"),
  };

  var diffButtons = {};
  for (var di = 0; di < DIFFICULTY_ORDER.length; di++) {
    diffButtons[DIFFICULTY_ORDER[di]] = $("diff-" + DIFFICULTY_ORDER[di]);
  }

  /* ==================================================================
   * 状态
   * ================================================================== */
  var game = new Game("easy");
  var started = false;
  var modalOpen = true;
  var resultOpen = false;
  var frozen = false; // 调试用（?pause=1 / ?demo=1）：冻结实时推进
  var layout = null;
  var width = 960;
  var height = 640;
  var fx = [];
  var bestSteps = 0;
  var audioCtx = null;
  var resultTimer = null;
  var heldDirs = [];
  var lastBlockedSoundAt = 0;
  var hudSignature = "";

  var BEST_KEY_PREFIX = "dodgesnake:best:";

  /* ==================================================================
   * 音效（WebAudio 合成，零资源）
   * ================================================================== */
  function ensureAudio() {
    try {
      if (!audioCtx) {
        var AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) return;
        audioCtx = new AC();
      }
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch (e) {
      audioCtx = null;
    }
  }

  function beep(freq, dur, type, gain, when) {
    if (!audioCtx) return;
    try {
      var t0 = audioCtx.currentTime + (when || 0);
      var osc = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain || 0.05, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + (dur || 0.08));
      osc.connect(g);
      g.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + (dur || 0.08) + 0.02);
    } catch (e) {
      /* 忽略音频错误 */
    }
  }

  var sfx = {
    move: function () {
      beep(330, 0.035, "triangle", 0.018);
    },
    blocked: function () {
      beep(110, 0.08, "sawtooth", 0.026);
    },
    split: function () {
      beep(420, 0.06, "square", 0.032);
      beep(640, 0.09, "sine", 0.038, 0.045);
    },
    hit: function () {
      beep(150, 0.14, "sawtooth", 0.05);
      beep(90, 0.2, "square", 0.045, 0.03);
    },
    win: function () {
      [523, 659, 784, 1046, 1318].forEach(function (f, i) {
        beep(f, 0.2, "sine", 0.055, i * 0.11);
      });
    },
    lose: function () {
      [392, 330, 262, 196].forEach(function (f, i) {
        beep(f, 0.24, "triangle", 0.05, i * 0.14);
      });
    },
    select: function () {
      beep(520, 0.06, "sine", 0.04);
      beep(780, 0.08, "sine", 0.04, 0.05);
    },
  };

  /* ==================================================================
   * 画布尺寸 / 布局
   * ================================================================== */
  function resize() {
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    var w = Math.max(260, Math.round((rect && rect.width) || canvas.clientWidth || 960));
    var h = Math.max(260, Math.round((rect && rect.height) || canvas.clientHeight || 640));
    width = w;
    height = h;
    var dpr = Math.min(root.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    if (ctx && ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout = computeLayout(game, w, h);
  }

  /* ==================================================================
   * 最佳步数
   * ================================================================== */
  function bestKey(id) {
    return BEST_KEY_PREFIX + id;
  }

  function loadBest(id) {
    try {
      var raw = root.localStorage && root.localStorage.getItem(bestKey(id));
      var n = Number(raw || 0);
      return isFinite(n) && n > 0 ? n : 0;
    } catch (e) {
      return 0;
    }
  }

  function saveBest(id, steps) {
    try {
      if (root.localStorage) root.localStorage.setItem(bestKey(id), String(steps));
    } catch (e) {
      /* 忽略 */
    }
  }

  /* ==================================================================
   * HUD
   * ================================================================== */
  function hearts(hp, maxHp) {
    var full = "";
    var empty = "";
    var i;
    for (i = 0; i < hp; i++) full += "♥";
    for (i = hp; i < maxHp; i++) empty += "♡";
    return full + empty;
  }

  function syncHud() {
    var stats = game.snakeStats();
    if (els.mode) {
      els.mode.textContent = started ? game.difficulty.name : "选择难度中";
      if (els.mode.classList) els.mode.classList.toggle("active", started);
    }
    if (els.hp) {
      els.hp.textContent = "生命 " + hearts(game.hp, game.maxHp);
      if (els.hp.classList) els.hp.classList.toggle("low", game.hp <= 2);
    }
    if (els.snakes) {
      els.snakes.textContent = started
        ? "蛇 " + stats.count + " 条 · 总长 " + stats.total + " · 进度 " + Math.round(stats.progress * 100) + "%"
        : "蛇 —";
    }
    if (els.steps) els.steps.textContent = "步数 " + game.steps;
    if (els.best) els.best.textContent = bestSteps > 0 ? "最佳 " + bestSteps + " 步" : "最佳 —";
    if (els.banner) {
      if (!started) {
        els.banner.textContent = "先在弹窗里选一个难度开始游戏";
      } else if (game.status === "won") {
        els.banner.textContent = "全部蛇都只剩蛇头了 —— 胜利！";
      } else if (game.status === "lost") {
        els.banner.textContent = "生命耗尽……被蛇群拖垮了。";
      } else {
        els.banner.textContent =
          "按住方向键自由移动 · 蛇会一直朝你游过来 · 撞「蛇身」让它断开成独立的蛇 · 所有蛇长度变成 1 即胜利";
      }
    }
    hudSignature = hudKey();
  }

  function hudKey() {
    var stats = game.snakeStats();
    return (
      game.steps + "|" + game.hp + "|" + game.snakes.length + "|" + game.status + "|" +
      Math.round(stats.progress * 100) + "|" + started + "|" + frozen + "|" + bestSteps
    );
  }

  function syncHudIfChanged() {
    if (hudSignature !== hudKey()) syncHud();
  }

  /* ==================================================================
   * 特效
   * ================================================================== */
  function now() {
    return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  }

  function addFx(opts) {
    fx.push({
      at: opts.at,
      color: opts.color || "#c0392b",
      label: opts.label || null,
      t0: now(),
      duration: opts.duration || 900,
      particles: opts.particles || 9,
      seed: Math.random() * Math.PI * 2,
    });
    if (fx.length > 26) fx.shift();
  }

  function shakeStage(strong) {
    if (!els.stage || !els.stage.classList) return;
    els.stage.classList.remove("shake", "shake-hard");
    void els.stage.offsetWidth; // 强制重排，重启动画
    els.stage.classList.add(strong ? "shake-hard" : "shake");
  }

  function clearFx() {
    fx.length = 0;
  }

  function blockedSound() {
    var t = now();
    if (t - lastBlockedSoundAt < 350) return;
    lastBlockedSoundAt = t;
    sfx.blocked();
  }

  /* ==================================================================
   * 处理引擎事件
   * ================================================================== */
  function processEvents(events) {
    if (!events || !events.length) return;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev.type === "move") {
        if (ev.through === "recoil") sfx.move();
        else if (ev.through !== "pushHead") sfx.move();
      } else if (ev.type === "split") {
        sfx.split();
        addFx({ at: ev.at, color: "#b8862e", label: "撞断！", particles: 13, duration: 950 });
        shakeStage(false);
      } else if (ev.type === "pushHead") {
        addFx({ at: ev.to, color: "#b8862e", label: "撞开！", particles: 8, duration: 750 });
      } else if (ev.type === "hit") {
        sfx.hit();
        addFx({ at: ev.at, color: "#c0392b", label: "-1 生命", particles: 14, duration: 1000 });
        shakeStage(true);
      } else if (ev.type === "blockedHit") {
        addFx({ at: ev.at, color: "#c9a227", label: "无敌", particles: 6, duration: 520 });
      } else if (ev.type === "blocked") {
        if (ev.why !== "cooldown") blockedSound();
      }
    }
  }

  /* ==================================================================
   * 行动 / 推进
   * ================================================================== */
  function activeHeldDir() {
    return heldDirs.length ? heldDirs[heldDirs.length - 1] : null;
  }

  function clearHeld() {
    heldDirs.length = 0;
  }

  function checkGameStatus() {
    if (game.status !== "playing" && !resultOpen && !resultTimer) {
      scheduleResult(game.status === "won" ? "won" : "lost");
    }
  }

  /** 尝试朝一个方向走一步（即时制里也用于按住连续移动） */
  function doMove(dir) {
    if (!started || modalOpen || resultOpen || frozen) return null;
    if (game.status !== "playing") return null;
    ensureAudio();
    var res = game.tryMove(dir, now());
    processEvents(res.events);
    checkGameStatus();
    syncHudIfChanged();
    return res;
  }

  function startHold(dir) {
    if (heldDirs.indexOf(dir) >= 0) return;
    heldDirs.push(dir);
    doMove(dir);
  }

  function stopHold(dir) {
    var i = heldDirs.indexOf(dir);
    if (i >= 0) heldDirs.splice(i, 1);
  }

  /* ==================================================================
   * 弹窗
   * ================================================================== */
  function openDifficulty() {
    ensureAudio();
    modalOpen = true;
    clearHeld();
    hideResult();
    if (els.startOverlay) els.startOverlay.classList.remove("hidden");
    if (els.modalContinue) {
      if (started) els.modalContinue.classList.remove("hidden");
      else els.modalContinue.classList.add("hidden");
    }
    syncHud();
  }

  function closeDifficulty() {
    modalOpen = false;
    if (els.startOverlay) els.startOverlay.classList.add("hidden");
    syncHud();
  }

  function chooseDifficulty(id) {
    if (!DIFFICULTIES[id]) return false;
    ensureAudio();
    sfx.select();
    started = true;
    game.reset(id);
    bestSteps = loadBest(id);
    clearFx();
    clearHeld();
    hideResult();
    if (resultTimer) {
      clearTimeout(resultTimer);
      resultTimer = null;
    }
    closeDifficulty();
    layout = computeLayout(game, width, height);
    syncHud();
    return true;
  }

  function doRestart() {
    if (!started) return;
    clearHeld();
    if (resultTimer) {
      clearTimeout(resultTimer);
      resultTimer = null;
    }
    hideResult();
    game.reset(game.difficultyId);
    bestSteps = loadBest(game.difficultyId);
    clearFx();
    syncHud();
    ensureAudio();
    sfx.move();
  }

  function scheduleResult(kind) {
    if (resultTimer) return;
    resultTimer = setTimeout(function () {
      resultTimer = null;
      showResult(kind);
    }, 700);
  }

  function showResult(kind) {
    if (resultOpen) return;
    resultOpen = true;
    var won = kind === "won";
    if (won) {
      if (bestSteps === 0 || game.steps < bestSteps) {
        bestSteps = game.steps;
        saveBest(game.difficultyId, bestSteps);
      }
      sfx.win();
    } else {
      sfx.lose();
    }
    if (els.resultEyebrow) els.resultEyebrow.textContent = won ? "胜 利" : "失 败";
    if (els.resultTitle) els.resultTitle.textContent = won ? "全部蛇只剩蛇头！" : "被蛇群撞倒了";
    if (els.resultDesc) {
      els.resultDesc.textContent = won
        ? "场上每条蛇都被你撞成只剩一个蛇头，你赢了！"
        : "生命值归零。撞断蛇身、躲开蛇头，再来一次吧。";
      if (els.resultDesc.classList) els.resultDesc.classList.toggle("lose", !won);
    }
    if (els.resultStats) {
      var stats = game.snakeStats();
      els.resultStats.textContent =
        "难度 " +
        game.difficulty.name +
        " · 用了 " +
        game.steps +
        " 步 · 剩余生命 " +
        game.hp +
        "/" +
        game.maxHp +
        " · 场上 " +
        stats.count +
        " 条蛇" +
        (won && bestSteps > 0 ? " · 最佳 " + bestSteps + " 步" : "");
    }
    if (els.resultOverlay) els.resultOverlay.classList.remove("hidden");
    syncHud();
  }

  function hideResult() {
    resultOpen = false;
    if (els.resultOverlay) els.resultOverlay.classList.add("hidden");
  }

  function toggleRules(force) {
    if (!els.rules) return;
    var show = force === undefined ? els.rules.classList.contains("hidden") : force;
    if (show) els.rules.classList.remove("hidden");
    else els.rules.classList.add("hidden");
  }

  /* ==================================================================
   * 输入
   * ================================================================== */
  var KEY_DIRS = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    w: "up",
    W: "up",
    s: "down",
    S: "down",
    a: "left",
    A: "left",
    d: "right",
    D: "right",
  };

  function modalKeyChoice(key) {
    if (!els.startOverlay || els.startOverlay.classList.contains("hidden")) return false;
    if (key === "1") {
      chooseDifficulty("easy");
      return true;
    }
    if (key === "2") {
      chooseDifficulty("normal");
      return true;
    }
    if (key === "3") {
      chooseDifficulty("hard");
      return true;
    }
    return false;
  }

  function bindInput() {
    if (typeof root.addEventListener === "function") {
      root.addEventListener("keydown", function (e) {
        if (modalOpen) {
          if (modalKeyChoice(e.key)) {
            e.preventDefault();
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            closeDifficulty();
          }
          return;
        }
        if (resultOpen) {
          if (e.key === "r" || e.key === "R" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            doRestart();
          }
          return;
        }
        var dir = KEY_DIRS[e.key];
        if (dir) {
          e.preventDefault();
          if (e.repeat) return;
          startHold(dir);
        } else if (e.key === "r" || e.key === "R") {
          e.preventDefault();
          doRestart();
        } else if (e.key === "n" || e.key === "N") {
          e.preventDefault();
          openDifficulty();
        } else if (e.key === "?" || e.key === "/") {
          e.preventDefault();
          toggleRules();
        } else if (e.key === "Escape") {
          toggleRules(false);
        }
      });

      root.addEventListener("keyup", function (e) {
        var dir = KEY_DIRS[e.key];
        if (!dir) return;
        e.preventDefault();
        stopHold(dir);
      });

      root.addEventListener("blur", function () {
        clearHeld();
      });
    }

    // 按钮
    if (els.restart) els.restart.addEventListener("click", doRestart);
    if (els.changeDiff) els.changeDiff.addEventListener("click", openDifficulty);
    if (els.resultAgain) els.resultAgain.addEventListener("click", doRestart);
    if (els.resultChange) els.resultChange.addEventListener("click", openDifficulty);
    if (els.modalContinue) els.modalContinue.addEventListener("click", closeDifficulty);
    if (els.rulesToggle) els.rulesToggle.addEventListener("click", function () { toggleRules(); });
    if (els.rulesClose) els.rulesClose.addEventListener("click", function () { toggleRules(false); });

    // 难度按钮
    DIFFICULTY_ORDER.forEach(function (id) {
      var btn = diffButtons[id];
      if (btn && btn.addEventListener) {
        btn.addEventListener("click", function () {
          chooseDifficulty(id);
        });
      }
    });

    // 手机方向键：按住连续移动
    if (typeof document !== "undefined" && document.querySelectorAll) {
      var dirBtns = document.querySelectorAll("[data-dir]");
      for (var i = 0; i < dirBtns.length; i++) {
        (function (btn) {
          var dir = btn.getAttribute ? btn.getAttribute("data-dir") : btn.dataset && btn.dataset.dir;
          btn.addEventListener("pointerdown", function (e) {
            if (e.preventDefault) e.preventDefault();
            ensureAudio();
            startHold(dir);
          });
          var stop = function (e) {
            if (e && e.preventDefault) e.preventDefault();
            stopHold(dir);
          };
          btn.addEventListener("pointerup", stop);
          btn.addEventListener("pointercancel", stop);
          btn.addEventListener("pointerleave", stop);
        })(dirBtns[i]);
      }
    }

    // 画布滑动：滑一次走一步
    if (canvas && canvas.addEventListener) {
      var start = null;
      canvas.addEventListener("pointerdown", function (e) {
        start = { x: e.clientX, y: e.clientY };
        ensureAudio();
      });
      canvas.addEventListener("pointerup", function (e) {
        if (!start) return;
        var dx = e.clientX - start.x;
        var dy = e.clientY - start.y;
        start = null;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
        doMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
      });
      canvas.addEventListener("pointercancel", function () {
        start = null;
      });
    }
  }

  /* ==================================================================
   * 主循环（即时制：每帧推进引擎）
   * ================================================================== */
  function frame(t) {
    if (!layout) resize();
    var tNow = now();

    if (started && !modalOpen && !resultOpen && !frozen) {
      // 我：按住方向键就持续移动（引擎里用 playerStepMs 限制速度）
      var held = activeHeldDir();
      if (held) {
        var res = game.tryMove(held, tNow);
        processEvents(res.events);
        checkGameStatus();
      }
      // 蛇：各自按计时器自由行动
      if (game.status === "playing") {
        var upd = game.update(tNow);
        processEvents(upd.events);
        checkGameStatus();
      }
      syncHudIfChanged();
    }

    // 清理过期特效
    for (var i = fx.length - 1; i >= 0; i--) {
      if (tNow - fx[i].t0 > fx[i].duration) fx.splice(i, 1);
    }

    if (ctx && layout) {
      drawScene(ctx, game, {
        layout: layout,
        width: width,
        height: height,
        time: t / 1000,
        now: tNow,
        fx: fx,
      });
    }

    if (typeof root.requestAnimationFrame === "function") root.requestAnimationFrame(frame);
  }

  /* ==================================================================
   * 规则面板
   * ================================================================== */
  function buildRulesPanel() {
    if (!els.rules) return;
    var B = SD.BALANCE || {};
    var playerSpeed = B.playerStepMs ? (1000 / B.playerStepMs).toFixed(1) : "6.7";
    var snakeSpeed = B.snakeStepMs ? (1000 / B.snakeStepMs).toFixed(1) : "2.4";
    var loneSpeed = B.loneHeadStepMs ? (1000 / B.loneHeadStepMs).toFixed(1) : "1.1";
    var stunSec = B.stunMs ? (B.stunMs / 1000).toFixed(1) : "1.4";
    var invulnSec = B.invulnMs ? (B.invulnMs / 1000).toFixed(1) : "0.8";
    els.rules.innerHTML =
      '<button class="rules-close" id="rules-close" type="button" aria-label="关闭规则">×</button>' +
      "<h3>怎么玩（即时制）</h3>" +
      '<p class="rules-lead">你控制「<b>我</b>」，在地图中央；四周一圈「<b>墙</b>」。' +
      "<b>按住方向键 / 手机方向键</b>我就持续移动（约 " + playerSpeed + " 格/秒）；" +
      "蛇也会<b>自由行动</b>，一直朝我游过来。每被蛇头碰到一次，<b>扣 1 点生命</b>（共 5 点，归零就输）。</p>" +
      "<h3>撞断蛇身</h3>" +
      '<ul class="rules-list">' +
      "<li>朝「<b>蛇身</b>」（不是蛇头）走一步 = 撞断它：被撞的那一节<b>不会消失</b>，它自己变成一条<b>独立的蛇</b>（长度 1，只有它一个蛇头）；</li>" +
      "<li>断点<b>前面</b>的蛇身保留原来的蛇头；断点<b>后面</b>的蛇身也变成一条<b>独立的新蛇</b>；</li>" +
      "<li>所以撞一次蛇身，一条蛇会变成 2～3 条各自独立的蛇，都会继续追你（一条蛇只有一个蛇头）；</li>" +
      "<li>我撞在蛇身上会被挡住；如果<b>身后有空格</b>，会被反作用力<b>弹开一格</b>；</li>" +
      "<li>被撞断后分出来的这几截都会<b>僵直 " + stunSec + " 秒</b>，这段时间不会撞你；</li>" +
      "<li>撞到蛇头不会切蛇，只会扣生命；撞到墙或边界则原地不动。</li>" +
      "</ul>" +
      "<h3>撞开蛇头（自救）</h3>" +
      '<p class="rules-lead">如果被蛇头围住，可以撞向<b>只剩蛇头</b>的蛇：扣 1 点生命把它<b>往前撞开一格</b>，' +
      "你踏进它原来的格子；如果它后面被挡住（墙/蛇/边界）就推不动，只能停在原地。" +
      "蛇身完整的蛇头（长度 ≥ 2）推不动。</p>" +
      "<h3>速度与保护</h3>" +
      '<ul class="rules-list">' +
      "<li>我约 <b>" + playerSpeed + " 格/秒</b>；完整蛇约 <b>" + snakeSpeed + " 格/秒</b>；只剩蛇头的蛇更慢，约 <b>" + loneSpeed + " 格/秒</b>；</li>" +
      "<li>被蛇头撞到后我会有 <b>" + invulnSec + " 秒无敌</b>，避免被一群蛇头瞬间连撞（无敌时我身上会闪烁）；</li>" +
      "<li>被撞到的蛇头会僵直 " + stunSec + " 秒，趁机拉开距离。</li>" +
      "</ul>" +
      "<h3>胜利条件</h3>" +
      '<p class="rules-lead">当场上<b>所有蛇的长度都变成 1</b>（每条蛇只剩一个蛇头）时，玩家胜利。</p>' +
      "<h3>操作</h3>" +
      '<p class="rules-tip">按住 WASD / 方向键移动；手机可按住右下角方向键；也可以在画布上滑动（滑一次走一步）。' +
      "R 重开；N 换难度；? 打开规则。</p>";
    var close = $("rules-close");
    if (close) close.addEventListener("click", function () { toggleRules(false); });
  }

  /* ==================================================================
   * 启动
   * ================================================================== */
  /** 调试/截图用：`?demo=1` 摆一个「已经撞断几条蛇」的中局并冻结 */
  function applyDemoState() {
    var t = now();
    game.nextSnakeId = 1;
    var lists = [
      [
        { x: 3, y: 3 },
        { x: 4, y: 3 },
        { x: 5, y: 3 },
        { x: 5, y: 4 },
      ],
      [
        { x: 11, y: 4 },
        { x: 11, y: 5 },
      ],
      [{ x: 3, y: 9 }],
      [{ x: 9, y: 10 }],
      [{ x: 10, y: 10 }],
    ];
    game.snakes = [];
    for (var i = 0; i < lists.length; i++) {
      var s = game.makeSnake(lists[i]);
      s.stunnedUntil = i >= 3 ? t + 1e9 : 0;
      if (i >= 3) s.anim = null;
      game.snakes.push(s);
    }
    game.player = { x: 7, y: 7 };
    game.hp = 3;
    game.steps = 7;
    game.status = "playing";
    game.winReason = null;
    game.playerAnim = null;
    frozen = true;
    layout = computeLayout(game, width, height);
    syncHud();
  }

  function boot() {
    resize();
    buildRulesPanel();
    bindInput();

    // 调试/截图用：index.html?d=easy|normal|hard 直接开局；?pause=1 冻结；?demo=1 摆中局
    var auto = null;
    var demo = false;
    var pause = false;
    try {
      var search = root.location && root.location.search ? root.location.search : "";
      var m = /[?&]d=(easy|normal|hard)/.exec(search);
      if (m) auto = m[1];
      demo = /[?&]demo=1/.test(search);
      pause = /[?&]pause=1/.test(search);
    } catch (e) {
      auto = null;
      demo = false;
      pause = false;
    }
    if (auto || demo) {
      chooseDifficulty(auto || "easy");
      if (demo) applyDemoState();
      else if (pause) frozen = true;
    } else {
      openDifficulty();
    }
    syncHud();

    if (typeof root.addEventListener === "function") root.addEventListener("resize", resize);
    if (typeof ResizeObserver !== "undefined" && els.stage) {
      try {
        new ResizeObserver(function () {
          resize();
          syncHudIfChanged();
        }).observe(els.stage);
      } catch (e) {
        /* 忽略 */
      }
    }
    if (typeof root.requestAnimationFrame === "function") root.requestAnimationFrame(frame);
  }

  /* ==================================================================
   * 导出（调试 / 页面测试用）
   * ================================================================== */
  root.SnakeDodgeMain = {
    game: game,
    chooseDifficulty: chooseDifficulty,
    doMove: doMove,
    doRestart: doRestart,
    openDifficulty: openDifficulty,
    closeDifficulty: closeDifficulty,
    showResult: showResult,
    hideResult: hideResult,
    syncHud: syncHud,
    toggleRules: toggleRules,
    resize: resize,
    getLayout: function () { return layout; },
    getFx: function () { return fx; },
    getHeldDirs: function () { return heldDirs.slice(); },
    isModalOpen: function () { return modalOpen; },
    isResultOpen: function () { return resultOpen; },
    isStarted: function () { return started; },
    isFrozen: function () { return frozen; },
  };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
