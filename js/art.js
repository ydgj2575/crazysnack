/**
 * =====================================================================
 *  躲避蛇 · 渲染层（Canvas 2D）
 * =====================================================================
 *  视觉风格沿用 ..\worddage：
 *    - 页面背景是深色墨水的径向渐变（在 style.css 里，保持不变）；
 *    - 画布是宣纸质地（drawPaper）、墨线格子、圆角「墙」块、朱红「我」。
 *  每个难度地图都不大（10~20 格），所以直接把整张地图铺满画布，不做摄像机。
 * =====================================================================
 */
(function (root) {
  "use strict";

  var PAPER = "#f4ead6";
  var INK = "#2b3540";
  var CHAR_FONT = '"Noto Serif SC","Songti SC","STSong","SimSun","Microsoft YaHei",serif';
  var FONT_UI = '"Noto Sans SC","Microsoft YaHei",system-ui,sans-serif';

  /** 移动动画时长（毫秒）：和引擎 BALANCE.animMs 保持一致 */
  function animMs() {
    var b = root.SnakeDodge && root.SnakeDodge.BALANCE;
    return (b && b.animMs) || 150;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /** 计算地图在画布上的布局：整张地图居中铺满 */
  function computeLayout(game, width, height) {
    var padX = Math.max(16, width * 0.045);
    var padY = Math.max(16, height * 0.055);
    var cell = Math.min((width - padX * 2) / game.cols, (height - padY * 2) / game.rows);
    cell = Math.max(10, cell);
    return {
      cell: cell,
      width: width,
      height: height,
      cols: game.cols,
      rows: game.rows,
      ox: (width - cell * game.cols) / 2,
      oy: (height - cell * game.rows) / 2,
    };
  }

  /** 格子坐标（可以是小数，用于动画插值）→ 屏幕像素中心 */
  function cellScreen(layout, gx, gy) {
    return { x: layout.ox + (gx + 0.5) * layout.cell, y: layout.oy + (gy + 0.5) * layout.cell };
  }

  /* ---------------- 宣纸底 ---------------- */

  function drawPaper(ctx, w, h) {
    var g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "#f7efde");
    g.addColorStop(0.55, PAPER);
    g.addColorStop(1, "#efe2c8");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.strokeStyle = "#8a744f";
    ctx.lineWidth = 1;
    var i;
    for (i = 0; i < 42; i++) {
      var x = (((i * 137) % 997) / 997) * w;
      var y = (((i * 311) % 991) / 991) * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 40 + (i % 5) * 18, y + ((i % 3) - 1) * 6);
      ctx.stroke();
    }
    ctx.restore();

    var v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(70,52,24,0.16)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
  }

  function drawBoard(ctx, game, layout) {
    var x = layout.ox;
    var y = layout.oy;
    var w = layout.cell * layout.cols;
    var h = layout.cell * layout.rows;

    ctx.save();
    ctx.shadowColor = "rgba(60,42,20,0.28)";
    ctx.shadowBlur = layout.cell * 0.5;
    ctx.shadowOffsetY = layout.cell * 0.18;
    roundRect(ctx, x, y, w, h, layout.cell * 0.25);
    ctx.fillStyle = "rgba(244,234,214,0.6)";
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRect(ctx, x, y, w, h, layout.cell * 0.25);
    ctx.clip();
    ctx.fillStyle = "rgba(255,252,244,0.35)";
    ctx.fillRect(x, y, w, h);
    // 墨线格子
    ctx.strokeStyle = "rgba(110,85,48,0.11)";
    ctx.lineWidth = 1;
    for (var gx = 0; gx <= game.cols; gx++) {
      var sx = x + gx * layout.cell;
      ctx.beginPath();
      ctx.moveTo(sx, y);
      ctx.lineTo(sx, y + h);
      ctx.stroke();
    }
    for (var gy = 0; gy <= game.rows; gy++) {
      var sy = y + gy * layout.cell;
      ctx.beginPath();
      ctx.moveTo(x, sy);
      ctx.lineTo(x + w, sy);
      ctx.stroke();
    }
    ctx.restore();

    // 画框
    ctx.save();
    roundRect(ctx, x - 1, y - 1, w + 2, h + 2, layout.cell * 0.26);
    ctx.strokeStyle = "rgba(90,70,40,0.3)";
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }

  /* ---------------- 墙 ---------------- */

  function drawWallTile(ctx, cx, cy, cell) {
    var s = cell * 0.86;
    roundRect(ctx, cx - s / 2, cy - s / 2, s, s, cell * 0.12);
    var g = ctx.createLinearGradient(cx - s / 2, cy - s / 2, cx + s / 2, cy + s / 2);
    g.addColorStop(0, "#6d7d8c");
    g.addColorStop(1, "#54626f");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    if (cell > 24) {
      ctx.fillStyle = "rgba(240,244,247,0.92)";
      ctx.font = "700 " + cell * 0.52 + "px " + CHAR_FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("墙", cx, cy + cell * 0.02);
    }
  }

  /* ---------------- 蛇 ---------------- */

  function drawSnakeBodyTile(ctx, cx, cy, cell, color, dim, index, time) {
    var s = cell * 0.72;
    var wobble = Math.sin(time * 2.2 + index * 0.9) * cell * 0.02;
    ctx.save();
    ctx.translate(cx, cy + wobble);
    if (dim) ctx.globalAlpha = 0.65;

    ctx.shadowColor = "rgba(40,50,30,0.25)";
    ctx.shadowBlur = cell * 0.12;
    ctx.shadowOffsetY = cell * 0.05;
    roundRect(ctx, -s / 2, -s / 2, s, s, cell * 0.16);
    var g = ctx.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2);
    g.addColorStop(0, "#f6f1e2");
    g.addColorStop(1, "#e8dfc9");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    if (cell > 20) {
      ctx.fillStyle = color;
      ctx.font = "700 " + cell * 0.42 + "px " + CHAR_FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("蛇", cell * 0.02, cell * 0.02);
    }
    ctx.restore();
  }

  /**
   * 蛇头：同样使用「蛇」字。
   * 和蛇身块的区别：蛇头块更大、底色更深、白字、描边更亮，右上角标长度；
   * 没僵直的蛇头带红色危险光晕，僵直时变灰、头顶转小星星。
   */
  function drawSnakeHead(ctx, cx, cy, cell, snake, dim, time, telegraph) {
    var L = snake.cells.length;
    var color = snake.headColor || "#7fb05f";
    var bodyColor = snake.color || "#5d8f4a";
    var s = cell * 0.84;
    var pulse = 0.5 + 0.5 * Math.sin(time * (L === 1 ? 2 : 3.2) + snake.id);

    ctx.save();
    // 危险光晕（没僵直的蛇头会一直追我）
    if (telegraph) {
      ctx.beginPath();
      ctx.arc(cx, cy, cell * (0.53 + 0.06 * pulse), 0, Math.PI * 2);
      ctx.fillStyle = "rgba(192,57,43," + (0.1 + 0.07 * pulse) + ")";
      ctx.fill();
    }
    if (dim) ctx.globalAlpha = 0.68;

    // 蛇头文字块：深色底 + 白「蛇」字
    ctx.shadowColor = dim ? "rgba(60,60,60,0.3)" : "rgba(50,70,35,0.5)";
    ctx.shadowBlur = cell * 0.22;
    ctx.shadowOffsetY = cell * 0.06;
    roundRect(ctx, cx - s / 2, cy - s / 2, s, s, cell * 0.16);
    var g = ctx.createLinearGradient(cx - s / 2, cy - s / 2, cx + s / 2, cy + s / 2);
    g.addColorStop(0, color);
    g.addColorStop(1, bodyColor);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowColor = "transparent";

    ctx.strokeStyle = "rgba(255,253,244,0.92)";
    ctx.lineWidth = Math.max(1.4, cell * 0.03);
    ctx.stroke();
    roundRect(ctx, cx - s * 0.42, cy - s * 0.42, s * 0.84, s * 0.84, cell * 0.12);
    ctx.strokeStyle = "rgba(35,45,25,0.5)";
    ctx.lineWidth = Math.max(1, cell * 0.018);
    ctx.stroke();

    if (cell > 18) {
      ctx.fillStyle = "#fffdf4";
      ctx.font = "700 " + cell * 0.46 + "px " + CHAR_FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("蛇", cx + cell * 0.01, cy + cell * 0.02);
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.11, 0, Math.PI * 2);
      ctx.fillStyle = "#fffdf4";
      ctx.fill();
    }

    // 长度角标
    if (cell > 18) {
      var bx = cx + cell * 0.3;
      var by = cy - cell * 0.3;
      ctx.beginPath();
      ctx.arc(bx, by, cell * 0.17, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(27,36,48,0.85)";
      ctx.fill();
      ctx.fillStyle = "#f4d98a";
      ctx.font = "700 " + cell * 0.2 + "px " + FONT_UI;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(L), bx, by + cell * 0.01);
    }

    // 僵直星星
    if (dim) {
      for (var k = 0; k < 3; k++) {
        var a = time * 2.6 + (k * Math.PI * 2) / 3;
        var sx = cx + Math.cos(a) * cell * 0.42;
        var sy = cy + Math.sin(a) * cell * 0.42 - cell * 0.28;
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(1.2, cell * 0.045), 0, Math.PI * 2);
        ctx.fillStyle = "rgba(244,217,138,0.95)";
        ctx.fill();
      }
    }
    ctx.restore();

    // 只剩蛇头（长度 1）的虚线圈
    if (L === 1 && !dim) {
      ctx.save();
      ctx.strokeStyle = "rgba(90,70,40,0.24)";
      ctx.setLineDash([cell * 0.09, cell * 0.07]);
      ctx.lineWidth = 1.2;
      roundRect(ctx, cx - s * 0.56, cy - s * 0.56, s * 1.12, s * 1.12, cell * 0.2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * 画一条蛇：每一节都是「蛇」字块，最后画蛇头（蛇头块更醒目）。
   * 即时制：每条蛇有自己的移动动画（snake.anim = { from, start }），
   * 新分出来的蛇 from 为 null，做「弹出」动画。
   */
  function drawSnake(ctx, snake, layout, time, now) {
    var cells = snake.cells;
    var L = cells.length;
    var dim = snake.stunnedUntil > now;
    var t = 1;
    var animFrom = null;
    if (snake.anim) {
      t = clamp((now - snake.anim.start) / animMs(), 0, 1);
      animFrom = snake.anim.from;
    }
    var ease = 1 - Math.pow(1 - t, 3);
    var positions = [];
    for (var i = 0; i < L; i++) {
      var cell = cells[i];
      var from = animFrom && animFrom[i] ? animFrom[i] : cell;
      var gx = from.x + (cell.x - from.x) * ease;
      var gy = from.y + (cell.y - from.y) * ease;
      positions.push(cellScreen(layout, gx, gy));
    }

    // 新分出来的蛇：轻微「弹出」
    var pop = 1;
    if (snake.anim && snake.anim.from === null && t < 1) {
      pop = 0.72 + 0.28 * Math.min(1, t * 2.2);
    }

    ctx.save();
    ctx.translate(positions[0].x, positions[0].y);
    ctx.scale(pop, pop);
    ctx.translate(-positions[0].x, -positions[0].y);

    // 身体块（从尾到头，一节一个「蛇」字，不用连接符号）
    for (var j = L - 1; j >= 1; j--) {
      drawSnakeBodyTile(ctx, positions[j].x, positions[j].y, layout.cell, snake.color, dim, j, time);
    }
    // 蛇头（也是「蛇」字块）；没僵直的蛇头带危险光晕
    drawSnakeHead(ctx, positions[0].x, positions[0].y, layout.cell, snake, dim, time, !dim);
    ctx.restore();
  }

  /* ---------------- 我 ---------------- */

  function drawPlayer(ctx, cx, cy, cell, time, hp, alive) {
    var r = cell * 0.38;
    var low = hp <= 2;
    var pulse = 0.5 + 0.5 * Math.sin(time * (low ? 7 : 3.4));

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r * (1.18 + 0.13 * pulse), 0, Math.PI * 2);
    ctx.fillStyle = low ? "rgba(192,57,43," + (0.12 + 0.1 * pulse) + ")" : "rgba(192,57,43,0.12)";
    ctx.fill();

    ctx.shadowColor = "rgba(192,57,43,0.55)";
    ctx.shadowBlur = cell * 0.3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    var g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.2, cx, cy, r);
    g.addColorStop(0, alive ? "#e05a47" : "#8a8a8a");
    g.addColorStop(1, alive ? "#a92d22" : "#555555");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,235,225,0.9)";
    ctx.lineWidth = 1.8;
    ctx.stroke();

    if (cell > 18) {
      ctx.fillStyle = "#fff5ec";
      ctx.font = "700 " + cell * 0.44 + "px " + CHAR_FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("我", cx, cy + cell * 0.02);
    }
  }

  /* ---------------- 特效 ---------------- */

  function drawFx(ctx, layout, fx, now) {
    for (var i = 0; i < fx.length; i++) {
      var f = fx[i];
      var t = (now - f.t0) / f.duration;
      if (t < 0 || t > 1) continue;
      var p = cellScreen(layout, f.at.x, f.at.y);
      var cx = p.x;
      var cy = p.y;
      var color = f.color || "#c0392b";
      var ease = 1 - Math.pow(1 - t, 3);
      var cell = layout.cell;

      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3 * (1 - t) + 1;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * (0.18 + ease * 0.75), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      var n = f.particles || 9;
      for (var k = 0; k < n; k++) {
        var a = (k / n) * Math.PI * 2 + (f.seed || 0);
        var dist = cell * (0.25 + ease * (0.6 + (k % 3) * 0.16));
        var px = cx + Math.cos(a) * dist;
        var py = cy + Math.sin(a) * dist + cell * 0.12 * t * t;
        ctx.globalAlpha = (1 - t) * 0.85;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(1.5, cell * 0.045 * (1 - t)), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      if (f.label) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, (1 - t) * 1.8);
        ctx.font = "700 " + Math.max(10, cell * 0.2) + "px " + FONT_UI;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        var tw = ctx.measureText(f.label).width;
        var bh = Math.max(14, cell * 0.3);
        var bw = tw + bh * 0.7;
        roundRect(ctx, cx - bw / 2, cy - cell * (0.7 + ease * 0.55), bw, bh, bh / 2);
        ctx.fillStyle = "rgba(255,250,238,0.95)";
        ctx.fill();
        ctx.fillStyle = color;
        ctx.fillText(f.label, cx, cy - cell * (0.72 + ease * 0.55) + bh * 0.72);
        ctx.restore();
      }
    }
  }

  /* ---------------- 整帧 ---------------- */

  /**
   * 渲染整帧（即时制）
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} game   引擎 Game 实例
   * @param {object} opts   { width, height, time, now, fx }
   */
  function drawScene(ctx, game, opts) {
    var layout = opts.layout || computeLayout(game, opts.width, opts.height);
    var width = opts.width;
    var height = opts.height;
    var time = opts.time || 0;
    var now = opts.now || 0;
    var fx = opts.fx || [];

    ctx.clearRect(0, 0, width, height);
    drawPaper(ctx, width, height);
    drawBoard(ctx, game, layout);

    var cell = layout.cell;

    // 墙
    for (var x = 0; x < game.cols; x++) {
      for (var y = 0; y < game.rows; y++) {
        if (!game.isWall(x, y)) continue;
        var wp = cellScreen(layout, x, y);
        drawWallTile(ctx, wp.x, wp.y, cell);
      }
    }

    // 「我」的位置（我现在被撞后可能处于无敌闪烁状态）
    var playerCell = game.player;
    var playerScreen;
    var pAnim = game.playerAnim;
    if (pAnim) {
      var pt = clamp((now - pAnim.start) / animMs(), 0, 1);
      var pe = 1 - Math.pow(1 - pt, 3);
      playerScreen = cellScreen(
        layout,
        pAnim.from.x + (playerCell.x - pAnim.from.x) * pe,
        pAnim.from.y + (playerCell.y - pAnim.from.y) * pe
      );
    } else {
      playerScreen = cellScreen(layout, playerCell.x, playerCell.y);
    }
    var invuln = game.playerInvulnUntil > now;

    // 蛇
    for (var s = 0; s < game.snakes.length; s++) {
      drawSnake(ctx, game.snakes[s], layout, time, now);
    }

    // 我（无敌时闪烁）
    if (!invuln || Math.floor(time * 18) % 2 === 0) {
      drawPlayer(ctx, playerScreen.x, playerScreen.y, cell, time, game.hp, game.status !== "lost");
    }

    // 特效
    drawFx(ctx, layout, fx, now || Date.now());

    // 四角装饰线
    ctx.save();
    ctx.strokeStyle = "rgba(120,90,50,0.18)";
    ctx.lineWidth = 1.4;
    ctx.strokeRect(8, 8, width - 16, height - 16);
    ctx.restore();
  }

  var api = {
    computeLayout: computeLayout,
    cellScreen: cellScreen,
    drawScene: drawScene,
    PAPER: PAPER,
    INK: INK,
    CHAR_FONT: CHAR_FONT,
    FONT_UI: FONT_UI,
  };

  root.SnakeDodge = root.SnakeDodge || {};
  root.SnakeDodge.art = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
