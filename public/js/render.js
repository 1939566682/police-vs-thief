/* ============ 渲染: 夜城追逐场景 / 角色 / 道具特效 ============ */
window.Render = (function () {
  var cv, ctx, cw = 0, ch = 0, dpr = 1;
  var staticCv = null;
  var camX = MAP.world.w / 2, camY = MAP.world.h / 2, scale = 1;
  var ghosts = {}, dogPrev = {};
  var RND = 1234567;
  function rnd() { RND = (RND * 16807) % 2147483647; return RND / 2147483647; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  var BUILD_CC = ["#3a4462", "#423a5e", "#31506b", "#4a3f5c", "#37486a", "#54384e", "#39506a", "#3f445e", "#47506a"];
  var BUILD_RC = ["#4a5578", "#534b72", "#3f6586", "#5b4f72", "#475a84", "#6a475f", "#4b6784", "#505672", "#596284"];

  /* 与服务端 isOpen 一致的合法性判定(供路障预览变色) */
  function segDistPt(px, py, s) {
    var dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    var l2 = dx * dx + dy * dy;
    var t = l2 ? ((px - s.x1) * dx + (py - s.y1) * dy) / l2 : 0;
    t = clamp(t, 0, 1);
    var cx = s.x1 + dx * t, cy = s.y1 + dy * t;
    return Math.hypot(px - cx, py - cy);
  }
  function clientIsOpen(x, y, r) {
    for (var i = 0; i < MAP.boxes.length; i++) {
      var b = MAP.boxes[i];
      if (x > b.x - r && x < b.x + b.w + r && y > b.y - r && y < b.y + b.h + r) return false;
    }
    for (var j = 0; j < MAP.segs.length; j++) {
      var s = MAP.segs[j];
      var half = s.st === "outer" ? 11 : s.st === "gate" ? 9 : 6;
      if (segDistPt(x, y, s) < r + half) return false;
    }
    return true;
  }
  /* 与服务端一致的基地门口保护区(路障不可覆盖门口) */
  function barClear(x, y) {
    var dk = MAP.doorKeep || [];
    for (var i = 0; i < dk.length; i++) {
      if (Math.hypot(x - dk[i].x, y - dk[i].y) < dk[i].r) return false;
    }
    return true;
  }

  function init(canvas) {
    cv = canvas; ctx = canvas.getContext("2d");
    resize();
    window.addEventListener("resize", resize);
    buildStatic();
  }
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cw = window.innerWidth; ch = window.innerHeight;
    cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
    cv.style.width = cw + "px"; cv.style.height = ch + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  /* ---------------- 静态图层 ---------------- */
  function buildStatic() {
    var c = document.createElement("canvas");
    c.width = MAP.world.w; c.height = MAP.world.h;
    var g = c.getContext("2d");
    var W = MAP.world.w, H = MAP.world.h;
    // 路面
    g.fillStyle = "#171b26"; g.fillRect(0, 0, W, H);
    // 沥青砖格
    g.fillStyle = "rgba(255,255,255,0.02)";
    var tw = 90, th = 90;
    for (var x = 0; x < W; x += tw) for (var y = 0; y < H; y += th) {
      g.fillRect(x + 2, y + 2, tw - 4, th - 4);
    }
    // 噪点
    g.fillStyle = "rgba(255,255,255,0.025)";
    for (var i = 0; i < 2600; i++) g.fillRect((rnd() * W) | 0, (rnd() * H) | 0, 1.4, 1.4);
    // 中心广场地砖
    g.strokeStyle = "rgba(160,180,220,0.05)"; g.lineWidth = 1;
    for (var a = -3; a <= 3; a++) for (var b = -3; b <= 3; b++) {
      g.strokeRect(700 + a * 46, 470 + b * 46, 46, 46);
    }
    // 道路虚线
    g.strokeStyle = "rgba(200,215,255,0.22)"; g.lineWidth = 6;
    g.setLineDash([26, 20]); g.lineCap = "round";
    MAP.road.forEach(function (r) {
      g.beginPath(); g.moveTo(r.x1, r.y1); g.lineTo(r.x2, r.y2); g.stroke();
    });
    g.setLineDash([]);
    // 建筑
    MAP.boxes.forEach(function (b, i) {
      var cc = BUILD_CC[b.c % BUILD_CC.length];
      var rc = BUILD_RC[b.c % BUILD_RC.length];
      // 阴影
      g.fillStyle = "rgba(0,0,0,0.35)";
      rr(g, b.x + 5, b.y + 7, b.w, b.h, 10); g.fill();
      // 楼体
      g.fillStyle = cc; rr(g, b.x, b.y, b.w, b.h, 10); g.fill();
      g.fillStyle = rc; rr(g, b.x + 4, b.y + 4, b.w - 8, b.h - 8, 7); g.fill();
      // 窗格
      var rows = Math.max(2, Math.round(b.h / 34)), cols = Math.max(2, Math.round(b.w / 30));
      var lit = (b.x * 7 + b.y * 13 + b.c * 31) % 10;
      for (var ry = 0; ry < rows; ry++) for (var cx = 0; cx < cols; cx++) {
        var wx = b.x + 10 + cx * ((b.w - 20) / cols) + 4;
        var wy = b.y + 10 + ry * ((b.h - 20) / rows) + 4;
        var lw = ((b.w - 20) / cols) - 8, lh = ((b.h - 20) / rows) - 8;
        var on = ((cx * 3 + ry * 5 + b.c * 7) % 5) === (lit % 5) && (cx + ry) % 3 !== 0;
        g.fillStyle = on ? "rgba(255,214,120,0.9)" : "rgba(10,14,24,0.85)";
        if (on) { g.shadowColor = "rgba(255,214,120,0.7)"; g.shadowBlur = 6; }
        g.fillRect(wx, wy, lw, lh);
        g.shadowBlur = 0;
      }
      // 屋顶边缘
      g.strokeStyle = "rgba(0,0,0,0.4)"; g.lineWidth = 2;
      rr(g, b.x + 1, b.y + 1, b.w - 2, b.h - 2, 10); g.stroke();
    });
    // 围墙
    MAP.segs.forEach(function (s) {
      var nearP = s.x1 < 360 && s.y1 < 360;
      var nearT = s.x1 > 1200 && s.y1 > 640;
      var thick = s.st === "outer" ? 24 : s.st === "gate" ? 20 : 12;
      var col;
      if (s.st === "outer") col = "#0c0f16";
      else if (s.st === "gate") col = nearP ? "#2b4a8f" : nearT ? "#a0481f" : "#3d4458";
      else col = "#e6e9f2";
      g.lineCap = "round"; g.lineWidth = thick;
      g.strokeStyle = col;
      g.beginPath(); g.moveTo(s.x1, s.y1); g.lineTo(s.x2, s.y2); g.stroke();
      g.lineWidth = 3; g.strokeStyle = "rgba(255,255,255,0.18)";
      g.beginPath(); g.moveTo(s.x1, s.y1); g.lineTo(s.x2, s.y2); g.stroke();
      if (s.st === "outer") {
        g.strokeStyle = "rgba(0,0,0,0.5)"; g.lineWidth = 2;
        g.beginPath(); g.moveTo(s.x1 + 4, s.y1 + 4); g.lineTo(s.x2 + 4, s.y2 + 4); g.stroke();
      }
    });
    // 据点地板
    [MAP.station, MAP.den].forEach(function (b) {
      var grad = g.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
      grad.addColorStop(0, "rgba(60,74,110,0.55)");
      grad.addColorStop(1, "rgba(30,38,60,0.55)");
      g.fillStyle = grad; rr(g, b.x + 12, b.y + 12, b.w - 24, b.h - 24, 14); g.fill();
      g.strokeStyle = b.color; g.lineWidth = 2; g.setLineDash([10, 8]);
      rr(g, b.x + 12, b.y + 12, b.w - 24, b.h - 24, 14); g.stroke(); g.setLineDash([]);
    });
    // 据点招牌
    g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "800 30px 'PingFang SC','Microsoft YaHei',sans-serif";
    g.fillStyle = "rgba(255,255,255,0.92)";
    g.shadowColor = MAP.station.color; g.shadowBlur = 16;
    g.fillText("POLICE 警局", 160, 140);
    g.shadowColor = MAP.den.color;
    g.fillText("盗贼巢穴", 1340, 760);
    g.shadowBlur = 0;
    g.font = "700 13px sans-serif"; g.fillStyle = "rgba(255,255,255,0.6)";
    g.fillText("▼ 出入口 ▼", 180, 268);
    g.fillText("▼ 出入口 ▼", 1360, 708);
    // 出生点光晕
    MAP.spawn.police.forEach(function (p) {
      g.fillStyle = "rgba(91,155,255,0.25)"; g.beginPath(); g.arc(p[0], p[1], 13, 0, 7); g.fill();
    });
    MAP.spawn.thief.forEach(function (p) {
      g.fillStyle = "rgba(255,138,66,0.25)"; g.beginPath(); g.arc(p[0], p[1], 13, 0, 7); g.fill();
    });
    // 装饰
    MAP.decor.forEach(function (d) {
      if (d.k === "tree") {
        var sh = g.createRadialGradient(d.x, d.y, 2, d.x, d.y, 24);
        sh.addColorStop(0, "rgba(30,70,40,0.9)"); sh.addColorStop(1, "rgba(15,40,25,0.15)");
        g.fillStyle = sh; g.beginPath(); g.arc(d.x, d.y, 24, 0, 7); g.fill();
        g.fillStyle = "rgba(50,120,70,0.85)"; g.beginPath(); g.arc(d.x, d.y, 15, 0, 7); g.fill();
        g.fillStyle = "rgba(90,170,100,0.55)"; g.beginPath(); g.arc(d.x - 4, d.y - 5, 8, 0, 7); g.fill();
      } else if (d.k === "lamp") {
        var lg = g.createRadialGradient(d.x, d.y, 2, d.x, d.y, 46);
        lg.addColorStop(0, "rgba(255,220,140,0.5)"); lg.addColorStop(1, "rgba(255,220,140,0)");
        g.fillStyle = lg; g.beginPath(); g.arc(d.x, d.y, 46, 0, 7); g.fill();
        g.fillStyle = "#3a4152"; g.fillRect(d.x - 2, d.y - 14, 4, 16);
        g.fillStyle = "#ffd76e"; g.beginPath(); g.arc(d.x, d.y - 16, 6, 0, 7); g.fill();
      } else if (d.k === "car") {
        g.save(); g.translate(d.x, d.y); g.rotate(d.r || 0);
        g.fillStyle = "rgba(0,0,0,0.3)"; rr(g, -18, -9, 36, 18, 5); g.fill();
        g.fillStyle = "#3a4152"; rr(g, -20, -10, 40, 20, 6); g.fill();
        g.fillStyle = "rgba(120,150,200,0.55)"; rr(g, -10, -7, 14, 10, 3); g.fill();
        g.fillStyle = "#ffd76e"; g.fillRect(-14, -10, 6, 3); g.fillRect(8, -10, 6, 3);
        g.fillRect(-14, 7, 6, 3); g.fillRect(8, 7, 6, 3);
        g.restore();
      } else if (d.k === "can") {
        g.fillStyle = "#2f3648"; g.beginPath(); g.arc(d.x, d.y, 8, 0, 7); g.fill();
        g.fillStyle = "#55607a"; g.beginPath(); g.arc(d.x, d.y, 4, 0, 7); g.fill();
      } else if (d.k === "hydrant") {
        g.fillStyle = "#c0392b"; rr(g, d.x - 7, d.y - 9, 14, 18, 4); g.fill();
        g.fillStyle = "rgba(255,255,255,0.5)"; g.fillRect(d.x - 7, d.y - 9, 14, 3);
      }
    });
    staticCv = c;
  }

  /* ---------------- 相机 ---------------- */
  function fitScale() { return Math.min(cw / MAP.world.w, ch / MAP.world.h); }
  function updateCamera() {
    var me = Game.myEnt();
    var follow = Game.myId != null && me && !(me.res > 0 || me.c > 0);
    var zt = follow ? 1.7 : fitScale();
    if (follow && Game.state && Game.state.gt > 0) zt = 1.45;
    scale += (zt - scale) * 0.06;
    var tcx = follow ? me.x : MAP.world.w / 2;
    var tcy = follow ? me.y : MAP.world.h / 2;
    camX += (tcx - camX) * 0.1;
    camY += (tcy - camY) * 0.1;
    var vw = cw / scale, vh = ch / scale;
    if (vw >= MAP.world.w) camX = MAP.world.w / 2;
    else camX = clamp(camX, vw / 2, MAP.world.w - vw / 2);
    if (vh >= MAP.world.h) camY = MAP.world.h / 2;
    else camY = clamp(camY, vh / 2, MAP.world.h - vh / 2);
  }
  function worldFromScreen(sx, sy) {
    return { x: camX + (sx - cw / 2) / scale, y: camY + (sy - ch / 2) / scale };
  }

  /* ---------------- 主帧 ---------------- */
  function frame(now) {
    updateCamera();
    var G = Game.state;
    ctx.clearRect(0, 0, cw, ch);
    // 背景
    var bg = ctx.createRadialGradient(cw / 2, ch / 2, 80, cw / 2, ch / 2, Math.max(cw, ch) * 0.8);
    bg.addColorStop(0, "#141a28"); bg.addColorStop(1, "#0a0d16");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, cw, ch);
    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    if (Game.shake > 0) {
      ctx.translate((Math.random() - 0.5) * Game.shake, (Math.random() - 0.5) * Game.shake);
    }
    ctx.scale(scale, scale);
    ctx.translate(-camX, -camY);
    // 世界
    if (staticCv) ctx.drawImage(staticCv, 0, 0);
    if (G) {
      drawSafeZone();
      drawSmokes(G);
      drawCoins(G);
      drawBars(G);
      drawBarPreview(now);
      drawDogs(G, now);
      drawCuffs(G, now);
      drawPlayers(G, now);
      drawFx(now);
      drawFloats(now);
    }
    ctx.restore();
  }

  /* ---------------- 贼窝安全区(防堵门, 圈内不可逮捕) ---------------- */
  function drawSafeZone() {
    ctx.fillStyle = "rgba(80,220,180,0.05)";
    ctx.beginPath(); ctx.arc(1360, 700, 132, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(80,220,180,0.45)";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([16, 12]);
    ctx.beginPath(); ctx.arc(1360, 700, 132, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "bold 13px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(110,240,200,0.85)";
    ctx.shadowColor = "rgba(80,220,180,0.6)"; ctx.shadowBlur = 8;
    ctx.fillText("🛡 安全区 · 圈内不可被捕", 1360, 700 - 132 - 12);
    ctx.shadowBlur = 0;
  }

  /* ---------------- 金币 ---------------- */
  function drawCoins(G) {
    var t = performance.now() / 900;
    for (var i = 0; i < G.coins.length; i++) {
      var c = G.coins[i];
      var s = 1 + Math.sin(t + i * 1.3) * 0.08;
      ctx.save();
      ctx.translate(c[0], c[1]); ctx.scale(s, s);
      ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.beginPath(); ctx.ellipse(0, 9, 14, 5, 0, 0, 7); ctx.fill();
      var grad = ctx.createRadialGradient(-3, -5, 2, 0, 0, 14);
      grad.addColorStop(0, "#ffe9a3"); grad.addColorStop(0.6, "#ffc24d"); grad.addColorStop(1, "#d98a1f");
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(0, 0, 12, 0, 7); ctx.fill();
      ctx.strokeStyle = "rgba(160,100,20,0.8)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 12, 0, 7); ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, 6.5, 0, 7); ctx.stroke();
      ctx.fillStyle = "#a3630f"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("¥", 0, 1);
      ctx.restore();
    }
  }

  /* ---------------- 烟雾 ---------------- */
  function drawSmokes(G) {
    var now = performance.now();
    for (var i = 0; i < G.its.smoke.length; i++) {
      var c = G.its.smoke[i];
      var a = clamp(c[3] / 6.5, 0, 1);
      ctx.globalAlpha = a * 0.85;
      for (var k = 0; k < 6; k++) {
        var ang = (i * 1.7 + k * 1.05) + now / 2400;
        var off = Math.sin(ang + i) * c[2] * 0.32;
        var px = c[0] + Math.cos(ang) * off;
        var py = c[1] + Math.sin(ang) * 0.8 * off;
        var rr2 = c[2] * (0.5 + ((k * 29) % 30) / 42);
        var gr = ctx.createRadialGradient(px, py, rr2 * 0.2, px, py, rr2);
        gr.addColorStop(0, "rgba(190,196,210,0.5)");
        gr.addColorStop(1, "rgba(120,128,148,0)");
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(px, py, rr2, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  /* ---------------- 路障 ---------------- */
  function drawBars(G) {
    for (var i = 0; i < G.its.bar.length; i++) {
      var b = G.its.bar[i];
      var fade = b[4] < 2 ? clamp(b[4] / 2, 0, 1) : 1;
      var dx = b[2] - b[0], dy = b[3] - b[1];
      var len = Math.hypot(dx, dy) || 1;
      var nx = -dy / len, ny = dx / len;
      // 辉光
      ctx.globalAlpha = fade * 0.4;
      ctx.strokeStyle = "#ff5a4a"; ctx.lineWidth = 20; ctx.lineCap = "round";
      ctx.shadowColor = "#ff4136"; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(b[2], b[3]); ctx.stroke();
      ctx.shadowBlur = 0;
      // 支架
      ctx.globalAlpha = fade;
      ctx.strokeStyle = "#232a38"; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(b[0] + nx * 8, b[1] + ny * 8); ctx.lineTo(b[2] + nx * 8, b[3] + ny * 8); ctx.stroke();
      // 栏体(红白斜纹)
      ctx.save();
      ctx.translate((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
      ctx.rotate(Math.atan2(dy, dx));
      var w = len, h = 15;
      ctx.beginPath(); ctx.rect(-w / 2 - 6, -h / 2, w + 12, h); ctx.clip();
      ctx.fillStyle = "#e02f26";
      ctx.fillRect(-w / 2 - 6, -h / 2, w + 12, h);
      ctx.fillStyle = "#fff";
      for (var s = -w - 20; s < w + 20; s += 22) {
        ctx.beginPath(); ctx.moveTo(s, -h / 2); ctx.lineTo(s + 14, -h / 2); ctx.lineTo(s - 6, h / 2); ctx.lineTo(s - 20, h / 2);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      // 警示灯
      ctx.globalAlpha = fade;
      var blink = Math.sin(performance.now() / 180 + i * 2) > 0;
      ctx.fillStyle = blink ? "#ffd76e" : "#b8860b";
      ctx.shadowColor = "#ffd76e"; ctx.shadowBlur = blink ? 10 : 0;
      ctx.beginPath(); ctx.arc((b[0] + b[2]) / 2 + nx * 6, (b[1] + b[3]) / 2 + ny * 6, 4, 0, 7); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  }

  /* ---------------- 警犬 ---------------- */
  function drawDogs(G, now) {
    var t = now / 220;
    for (var i = 0; i < G.its.dog.length; i++) {
      var d = G.its.dog[i];
      var px = d[0], py = d[1];
      var tired = d.length > 3 && d[3] === 1;
      var ang = 0;
      if (dogPrev[d[2]]) { ang = Math.atan2(py - dogPrev[d[2]][1], px - dogPrev[d[2]][0]); }
      dogPrev[d[2]] = [px, py];
      ctx.save();
      ctx.translate(px, py);
      ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.ellipse(0, 9, 12, 5, 0, 0, 7); ctx.fill();
      ctx.rotate(ang);
      // 尾巴(疲惫时耷拉不摇)
      ctx.strokeStyle = "#6d4c33"; ctx.lineWidth = 4; ctx.lineCap = "round";
      ctx.beginPath();
      if (tired) { ctx.moveTo(-10, -2); ctx.quadraticCurveTo(-16, 2, -20, 3); }
      else ctx.moveTo(-10, -2); ctx.quadraticCurveTo(-16, -6 + Math.sin(t * 3) * 4, -20, -8);
      ctx.stroke();
      // 身体(疲惫时更暗)
      ctx.fillStyle = tired ? "#6d4526" : "#8a5a33";
      ctx.beginPath(); ctx.ellipse(0, 0, 13, 9, 0, 0, 7); ctx.fill();
      ctx.fillStyle = tired ? "#9c6c3c" : "#c98d56";
      ctx.beginPath(); ctx.ellipse(2, 0, 11, 7, 0, 0, 7); ctx.fill();
      // 头
      ctx.fillStyle = tired ? "#6d4526" : "#8a5a33";
      ctx.beginPath(); ctx.arc(12, -1, 7, 0, 7); ctx.fill();
      // 耳朵(疲惫时下垂)
      ctx.fillStyle = "#5d3b22";
      if (tired) {
        ctx.beginPath(); ctx.moveTo(8, -4); ctx.quadraticCurveTo(10, 1, 8, 4); ctx.fill();
        ctx.beginPath(); ctx.moveTo(14, -4); ctx.quadraticCurveTo(16, 1, 14, 4); ctx.fill();
      } else {
        ctx.beginPath(); ctx.moveTo(8, -6); ctx.lineTo(12, -12); ctx.lineTo(15, -6); ctx.fill();
        ctx.beginPath(); ctx.moveTo(14, -6); ctx.lineTo(18, -11); ctx.lineTo(20, -5); ctx.fill();
      }
      // 鼻子
      ctx.fillStyle = "#2b1c10"; ctx.beginPath(); ctx.arc(18, 0, 2.4, 0, 7); ctx.fill();
      // 舌头(疲惫时吐出)
      if (tired) {
        ctx.fillStyle = "#e88";
        ctx.beginPath(); ctx.ellipse(15, 5, 2.6, 3.6, 0, 0, 7); ctx.fill();
      }
      // 项圈
      ctx.strokeStyle = "#3d7bff"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(12, -1, 7, -1, 1.4); ctx.stroke();
      // 脚(疲惫时缓慢拖步)
      ctx.strokeStyle = "#5d3b22"; ctx.lineWidth = 3; ctx.lineCap = "round";
      var step = Math.sin(t * (tired ? 4 : 9));
      ctx.beginPath();
      ctx.moveTo(-8, 6); ctx.lineTo(-8 + step * 2, 12);
      ctx.moveTo(-2, 7); ctx.lineTo(-2 - step * 2, 13);
      ctx.moveTo(4, 6); ctx.lineTo(4 + step * 2, 12);
      ctx.stroke();
      // 疲惫气泡
      if (tired) {
        ctx.font = "13px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = "#8fb4d8";
        ctx.fillText("💤", 0, -22);
      }
      ctx.restore();
    }
  }

  /* ---------------- 手铐 ---------------- */
  function drawCuffs(G, now) {
    for (var i = 0; i < G.its.cuff.length; i++) {
      var c = G.its.cuff[i];
      var a = Math.atan2(c[3], c[2]);
      ctx.save();
      ctx.translate(c[0], c[1]);
      ctx.rotate(a);
      ctx.strokeStyle = "rgba(200,210,235,0.9)"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(9, 0); ctx.stroke();
      ctx.fillStyle = "#d7dcea";
      ctx.beginPath(); ctx.arc(-9, 0, 5, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(9, 0, 5, 0, 7); ctx.fill();
      ctx.strokeStyle = "#8b93a8"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(-9, 0, 5, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.arc(9, 0, 5, 0, 7); ctx.stroke();
      // 火花
      var sp = (now / 90 + i) % 3;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath(); ctx.arc(9 + Math.sin(sp * 2) * 7, Math.cos(sp * 3) * 6, 1.6, 0, 7); ctx.fill();
      ctx.restore();
    }
  }

  /* ---------------- 玩家 ---------------- */
  function drawPlayers(G, now) {
    var a = Game.alpha();
    var prevMap = {};
    if (Game.prev && Game.prev.pl) for (var i = 0; i < Game.prev.pl.length; i++) prevMap[Game.prev.pl[i].id] = Game.prev.pl[i];
    for (var j = 0; j < G.pl.length; j++) {
      var p = G.pl[j];
      var px = p.x, py = p.y;
      if (prevMap[p.id]) {
        px = prevMap[p.id].x + (p.x - prevMap[p.id].x) * a;
        py = prevMap[p.id].y + (p.y - prevMap[p.id].y) * a;
      }
      drawChar(p, px, py, now);
    }
  }
  function drawChar(p, x, y, now) {
    var side = p.s;
    var f = p.f;
    var sna = f & 1, inv = f & 2, dis = f & 4, spr = f & 8, slow = f & 16;
    var cau = p.c > 0;
    var bodyCol = dis ? "#93a1b8" : side === 0 ? "#4f8dff" : "#ff8c42";
    var darkCol = dis ? "#64707f" : side === 0 ? "#2b56c0" : "#d85a24";
    var blink = inv && Math.floor(now / 90) % 2 === 0;
    ctx.save();
    ctx.translate(x, y);
    // 疾跑残影
    if (spr) {
      if (!ghosts[p.id]) ghosts[p.id] = [];
      var gs = ghosts[p.id];
      gs.push({ x: x, y: y, t: now });
      while (gs.length > 8) gs.shift();
      for (var i = 0; i < gs.length - 1; i++) {
        var gg = gs[i];
        var ga = (i / gs.length) * 0.45;
        ctx.globalAlpha = ga;
        ctx.fillStyle = side === 0 ? "#7fb2ff" : "#ffc18a";
        ctx.beginPath(); ctx.arc(gg.x - x, gg.y - y, 13, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (ghosts[p.id]) ghosts[p.id] = [];
    if (blink) ctx.globalAlpha = 0.35;
    // 阴影
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath(); ctx.ellipse(0, 9, 14, 6, 0, 0, 7); ctx.fill();
    if (cau) {
      // 被抓获
      ctx.fillStyle = "#8f99ad";
      ctx.beginPath(); ctx.arc(0, 0, 14, 0, 7); ctx.fill();
      ctx.fillStyle = "#c7d0e0";
      ctx.beginPath(); ctx.arc(0, 0, 14, 0, 7); ctx.stroke();
      ctx.font = "15px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("⛓️", 0, -1);
      ctx.fillStyle = "#ff6b6b"; ctx.font = "bold 10px sans-serif";
      ctx.fillText("已被捕", 0, 26);
      ctx.restore();
      return;
    }
    // 身体
    var grd = ctx.createRadialGradient(-4, -6, 2, 0, 0, 17);
    grd.addColorStop(0, bodyCol); grd.addColorStop(1, darkCol);
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(0, 0, 15, 0, 7); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.45)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 15, 0, 7); ctx.stroke();
    // 朝向眼睛
    var ex = Math.cos(p.dir || 0), ey = Math.sin(p.dir || 0);
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(ex * 5 - 3, ey * 5 - 3, 2.6, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(ex * 5 + 3, ey * 5 - 3, 2.6, 0, 7); ctx.fill();
    ctx.fillStyle = "#141821";
    ctx.beginPath(); ctx.arc(ex * 5 - 3 + ex * 1, ey * 5 - 3 + ey * 1, 1.2, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(ex * 5 + 3 + ex * 1, ey * 5 - 3 + ey * 1, 1.2, 0, 7); ctx.fill();
    if (dis) {
      // 伪装市民: 帽子换发型
      ctx.fillStyle = "#3d4657";
      ctx.beginPath(); ctx.arc(0, -8, 6, Math.PI, 0); ctx.fill();
      ctx.fillStyle = "#5d6a80"; ctx.font = "11px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("?", 0, -22);
    } else if (side === 0) {
      // 警帽
      ctx.fillStyle = "#1d3a7a";
      ctx.beginPath(); ctx.ellipse(0, -11, 9, 4.5, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "#16306a";
      ctx.beginPath(); ctx.arc(0, -12, 5.5, Math.PI, 0); ctx.fill();
      ctx.fillStyle = "#ffd76e";
      ctx.beginPath(); ctx.arc(0, -12, 2, 0, 7); ctx.fill();
    } else {
      // 小偷蒙面
      ctx.fillStyle = "#1c2028";
      ctx.fillRect(-9, -6, 18, 5);
      ctx.fillStyle = "#fff";
      ctx.fillRect(-7, -4.5, 4, 1.6); ctx.fillRect(3, -4.5, 4, 1.6);
    }
    // 状态
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    if (sna) {
      ctx.fillStyle = "#ff5a5a"; ctx.font = "14px sans-serif";
      ctx.fillText("🔒", 0, -24);
    }
    if (slow) {
      ctx.fillStyle = "#7fb2ff"; ctx.font = "11px sans-serif";
      ctx.fillText("🐾", 12, -8);
    }
    // 盗取读条(金币窃取进度)
    if (p.lp >= 0) {
      ctx.fillStyle = "rgba(24,18,4,.6)";
      ctx.beginPath(); ctx.arc(0, 23, 13, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 5; ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(255,255,255,.28)";
      ctx.beginPath(); ctx.arc(0, 23, 13, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = "#ffd76e";
      ctx.shadowColor = "#ffd76e"; ctx.shadowBlur = 9;
      ctx.beginPath(); ctx.arc(0, 23, 13, -Math.PI / 2, -Math.PI / 2 + p.lp * Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.font = "bold 12px sans-serif";
      ctx.fillStyle = "#ffd76e";
      ctx.fillText("⏳", 16, 24);
    }
    // 名字
    var nm = p.n;
    if (nm) {
      ctx.font = "bold 11px 'PingFang SC','Microsoft YaHei',sans-serif";
      var w = ctx.measureText(nm).width + 10;
      ctx.fillStyle = "rgba(8,10,16,0.66)";
      rr(ctx, -w / 2, -34, w, 15, 7); ctx.fill();
      ctx.fillStyle = side === 0 ? "#a9c6ff" : dis ? "#c3ccda" : "#ffc9a6";
      ctx.fillText(nm, 0, -26.5);
      ctx.font = "bold 9px sans-serif";
      ctx.fillStyle = "#ffd76e";
      ctx.fillText(p.lp >= 0 ? "偷取中" : "★" + p.sc, 0, 47);
    }
    ctx.restore();
  }

  /* ---------------- 路障预览(跟随鼠标的幽灵路障) ---------------- */
  function drawBarPreview(now) {
    var prev = Game.live.barPrev;
    if (!prev) return;
    if (Game.side !== 0) { Game.live.barPrev = null; return; } // 防御: 非警察不画警察预览
    var me = Game.myEnt();
    if (!me) return;
    var aim = Input.aim;
    var dir = me.d || 0;
    var px, py;
    var ax = aim.has ? aim.x : 0, ay = aim.has ? aim.y : 0;
    var d = Math.hypot(ax - me.x, ay - me.y);
    if (aim.has && d >= 80 && d <= 460) {
      px = ax; py = ay;
      dir = Math.atan2(ay - me.y, ax - me.x); // 端点和放置方向必须与服务端一致(瞄准方向)
    } else {
      px = me.x + Math.cos(dir) * 300;
      py = me.y + Math.sin(dir) * 300;
    }
    // 滚轮旋转: 在基准朝向上叠加偏转角
    var rot = prev.rot || 0;
    if (rot !== 0) dir = dir + rot;
    prev.x = px; prev.y = py;
    // 合法性: 与服务端一致(放置点 + 两端点 + 门口保护区)
    var h = 85;
    var sx1 = px - Math.sin(dir) * h, sy1 = py + Math.cos(dir) * h;
    var sx2 = px + Math.sin(dir) * h, sy2 = py - Math.cos(dir) * h;
    var ok = clientIsOpen(px, py, 10) && clientIsOpen(sx1, sy1, 8) && clientIsOpen(sx2, sy2, 8) &&
      barClear(px, py) && barClear(sx1, sy1) && barClear(sx2, sy2);
    prev.ok = ok;
    var col = ok ? "#2ecc71" : "#ff4136";
    var dark = ok ? "#1d8f4a" : "#c92a2a";
    ctx.save();
    ctx.translate(px, py);
    // 地面落点标记
    ctx.globalAlpha = 0.9;
    var pulse = 1 + Math.sin(now / 180) * 0.08;
    ctx.strokeStyle = col; ctx.lineWidth = 3;
    ctx.shadowColor = col; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.ellipse(0, 8, 46 * pulse, 12 * pulse, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.rotate(dir - Math.PI / 2);
    var w = 176, bh = 16;
    // 主体
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.rect(-w / 2, -bh / 2, w, bh); ctx.fill();
    ctx.fillStyle = col;
    var s = 0;
    for (s = -w / 2; s < w / 2; s += 22) {
      ctx.beginPath(); ctx.moveTo(s, -bh / 2); ctx.lineTo(s + 14, -bh / 2); ctx.lineTo(s - 6, bh / 2); ctx.lineTo(s - 20, bh / 2);
      ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 2;
    ctx.strokeRect(-w / 2, -bh / 2, w, bh);
    // 端点
    ctx.fillStyle = col; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(-w / 2, 0, 6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(w / 2, 0, 6, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.restore();
    // 提示文字
    ctx.font = "bold 12px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    var tip = ok ? "左键/再按3放置 · 滚轮转方向" : "无法放置 · 滚轮转方向";
    var tw = ctx.measureText(tip).width + 20;
    ctx.fillStyle = "rgba(8,10,16,.78)";
    rr(ctx, px - tw / 2, py - 46, tw, 20, 10); ctx.fill();
    ctx.fillStyle = ok ? "#8dffb0" : "#ff9b8a";
    ctx.fillText(tip, px, py - 36);
    // 方向指示箭头(旋转朝向)
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(dir - Math.PI / 2);
    ctx.strokeStyle = ok ? "#8dffb0" : "#ff9b8a"; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(w / 2 + 8, 0); ctx.lineTo(w / 2 + 20, 0);
    ctx.moveTo(w / 2 + 14, -5); ctx.lineTo(w / 2 + 20, 0); ctx.lineTo(w / 2 + 14, 5);
    ctx.stroke();
    ctx.restore();
    // 状态词
    ctx.font = "bold 13px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillStyle = col;
    ctx.shadowColor = col; ctx.shadowBlur = 10;
    ctx.fillText(ok ? "🟢 可放置" : "🔴 不可放置", px, py + 26);
    ctx.shadowBlur = 0;
  }

  /* ---------------- 一次性特效 ---------------- */
  function drawFx(now) {
    var F = Game.fxList;
    for (var i = F.length - 1; i >= 0; i--) {
      var e = F[i];
      var pr = clamp((now - e.t0) / e.life, 0, 1);
      if (pr >= 1) { F.splice(i, 1); continue; }
      ctx.save();
      ctx.translate(e.x, e.y);
      var col = e.side === 0 ? "#5b9bff" : e.side === 1 ? "#ff9a5a" : "#fff";
      switch (e.type) {
        case "ring":
          ctx.globalAlpha = 1 - pr;
          ctx.strokeStyle = col; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(0, 0, 10 + pr * 42, 0, 7); ctx.stroke();
          break;
        case "coin":
          ctx.globalAlpha = 1 - pr;
          ctx.fillStyle = "#ffd76e";
          for (var k = 0; k < 8; k++) {
            var a = k / 8 * Math.PI * 2 + pr * 1.5;
            ctx.beginPath(); ctx.arc(Math.cos(a) * pr * 30, Math.sin(a) * pr * 30, 2.4, 0, 7); ctx.fill();
          }
          break;
        case "deny":
          ctx.globalAlpha = 1 - pr;
          ctx.strokeStyle = "#ff5a5a"; ctx.lineWidth = 3.5;
          ctx.beginPath();
          ctx.moveTo(-10, -10); ctx.lineTo(10, 10);
          ctx.moveTo(10, -10); ctx.lineTo(-10, 10);
          ctx.stroke();
          break;
        case "sprint":
          ctx.globalAlpha = 1 - pr;
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          ctx.fillRect(-22 + pr * 12, -1.5, 22, 3);
          break;
        case "cuff":
          ctx.globalAlpha = 1 - pr;
          ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(-14, 0); ctx.lineTo(14, 0);
          ctx.stroke();
          break;
        case "dog":
        case "smoke":
        case "disg":
          ctx.globalAlpha = (1 - pr) * 0.6;
          ctx.fillStyle = e.type === "disg" ? "#93a1b8" : "#cfd6e2";
          for (var m = 0; m < 5; m++) {
            var r = 6 + pr * 26;
            ctx.beginPath(); ctx.arc(Math.cos(m * 1.3) * pr * 14, Math.sin(m * 1.9) * pr * 14, r * 0.6, 0, 7); ctx.fill();
          }
          break;
        case "bar":
          ctx.globalAlpha = 1 - pr;
          ctx.strokeStyle = "#ff8a6a"; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(0, 0, pr * 30, 0, 7); ctx.stroke();
          break;
        case "bite":
          ctx.globalAlpha = 1 - pr;
          ctx.fillStyle = "#fff";
          ctx.beginPath(); ctx.arc(0, 0, 2 + pr * 6, 0, 7); ctx.fill();
          break;
      }
      ctx.restore();
    }
  }
  function drawFloats(now) {
    var F = Game.floatList;
    for (var i = F.length - 1; i >= 0; i--) {
      var e = F[i];
      var pr = clamp((now - e.t0) / e.life, 0, 1);
      if (pr >= 1) { F.splice(i, 1); continue; }
      ctx.globalAlpha = 1 - pr * pr;
      ctx.font = "bold 14px 'PingFang SC','Microsoft YaHei',sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 3;
      ctx.strokeText(e.txt, e.x, e.y - pr * 26);
      ctx.fillStyle = e.col;
      ctx.fillText(e.txt, e.x, e.y - pr * 26);
    }
    ctx.globalAlpha = 1;
  }

  return {
    init: init, frame: frame, worldFromScreen: worldFromScreen, worldToScreen: worldToScreen,
    get scale() { return scale; }
  };
  function worldToScreen(wx, wy) {
    return { x: (wx - camX) * scale + cw / 2, y: (wy - camY) * scale + ch / 2 };
  }
})();
