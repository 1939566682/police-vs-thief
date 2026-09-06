/* ============================================================
 * 警匪追逐 · 实时对战服务端
 * 架构: 服务端权威模拟(30Hz) + WebSocket 广播 + 静态托管
 * 玩法:
 *   - 观众点击加入警察/小偷, 实时显示双方人数与积分
 *   - 警察: 手铐(远程禁锢) / 警犬(追踪减速) / 路障(封锁通道)
 *   - 小偷: 烟雾弹(免疫抓捕+遮挡视野) / 疾跑(加速突围) / 伪装(伪装市民)
 *   - 道具: 冷却触发, 或消耗阵营积分立即兑换
 *   - 胜负: 缉拿/洗劫满 10 分, 或全歼, 或时间到比分定胜负
 * ============================================================ */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const MAP = require("./public/js/map.js");

const PORT = +(process.env.PORT || 3000);
const TEST = process.argv.includes("--test");
const TICK = 1 / 30;
const SIDE = ["警察", "小偷"];

/* ---------------- 调参 ---------------- */
const TUN = {
  round: 100,
  gate: 3.5,
  over: 12.5,
  target: 10,
  base: [175, 183], // 警察 / 小偷
  catchR: 40,
  catchCd: 0.9,
  coinR: 26,
  coinMax: 9,
  coinDelay: 1.4,
  cuff: { sp: 640, life: 1.3, snare: 2.6, cd: 9, cost: 3 },
  dog: { sp: 350, life: 11, cd: 16, cost: 5, slow: 1.6 },
  bar: { len: 170, life: 10, cd: 15, cost: 4 },
  smoke: { r: 160, life: 6.5, cd: 11, cost: 3 },
  sprint: { t: 3.4, mul: 1.72, cd: 12, cost: 2 },
  disg: { t: 7, cd: 17, cost: 5 },
  inv: 2.2,
  cauHold: 1.15,
  lootTime: 0.8,
  maxHumans: 8,
  minBots: 4,
  targetTeam: 6
};
const ITEMS = [
  [
    { name: "手铐", cd: TUN.cuff.cd, cost: TUN.cuff.cost },
    { name: "警犬", cd: TUN.dog.cd, cost: TUN.dog.cost },
    { name: "路障", cd: TUN.bar.cd, cost: TUN.bar.cost }
  ],
  [
    { name: "烟雾弹", cd: TUN.smoke.cd, cost: TUN.smoke.cost },
    { name: "疾跑", cd: TUN.sprint.cd, cost: TUN.sprint.cost },
    { name: "伪装", cd: TUN.disg.cd, cost: TUN.disg.cost }
  ]
];

const BOT_NAMES = [
  ["陈Sir", "李队", "赵Sir", "王Sir", "刘Sir", "阿豪", "沈Sir", "周队", "郑Sir", "老周"],
  ["夜猫", "飞贼K", "影子", "老鬼", "快手", "小九", "黑猫", "独眼", "马六", "阿鼠"]
];

/* ---------------- 世界状态 ---------------- */
const S = {
  tk: 0,
  rnd: 1,
  ph: "go",
  gt: TUN.gate,
  tm: TUN.round,
  sc: [0, 0],
  tgt: [TUN.target, TUN.target],
  pl: [],
  coins: [],
  coinT: 0.6,
  its: { cuff: [], dog: [], bar: [], smoke: [] },
  over: null,
  ev: [],
  feed: [],
  seqP: 0,
  clients: new Map() // ws -> {id, side, name}
};

/* ---------------- 几何工具 ---------------- */
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function fx(type, x, y, d) {
  S.ev.push(Object.assign({ id: ++S.seqP, type: type, x: x, y: y }, d || {}));
}
function feed(msg) {
  S.feed.push(msg);
  if (S.feed.length > 7) S.feed.shift();
}

/* 碰撞几何: 由 MAP 构建 */
const COLL = { blocks: [], segs: [] };
MAP.boxes.forEach((b) => COLL.blocks.push({ x: b.x, y: b.y, w: b.w, h: b.h }));
MAP.segs.forEach((s) => {
  const half = s.st === "outer" ? 11 : s.st === "gate" ? 9 : 6;
  COLL.segs.push({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, half: half });
});

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function segClosest(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  return [x1 + dx * t, y1 + dy * t];
}
function segDist(px, py, x1, y1, x2, y2) {
  const c = segClosest(px, py, x1, y1, x2, y2);
  return Math.hypot(px - c[0], py - c[1]);
}

/* 实体碰撞解析(圆 vs 建筑矩形 + 围墙线段 + 动态路障) */
function resolveEnt(p, r, bar) {
  let hit = false;
  for (let pass = 0; pass < 2; pass++) {
    for (const b of COLL.blocks) {
      if (p.x < b.x - r || p.x > b.x + b.w + r || p.y < b.y - r || p.y > b.y + b.h + r) continue;
      const cx = clamp(p.x, b.x, b.x + b.w);
      const cy = clamp(p.y, b.y, b.y + b.h);
      let dx = p.x - cx, dy = p.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r) {
        hit = true;
        if (d2 > 0.0001) {
          const d = Math.sqrt(d2), push = r - d;
          p.x += (dx / d) * push; p.y += (dy / d) * push;
        } else {
          const l = p.x - b.x, rr = b.x + b.w - p.x, t = p.y - b.y, bo = b.y + b.h - p.y;
          const m = Math.min(l, rr, t, bo);
          if (m === l) p.x = b.x - r;
          else if (m === rr) p.x = b.x + b.w + r;
          else if (m === t) p.y = b.y - r;
          else p.y = b.y + b.h + r;
        }
      }
    }
    const all = COLL.segs.concat(bar || []);
    for (const s of all) {
      const half = s.half != null ? s.half : 7;
      const c = segClosest(p.x, p.y, s.x1, s.y1, s.x2, s.y2);
      const dx = p.x - c[0], dy = p.y - c[1];
      const d = Math.hypot(dx, dy);
      if (d < r + half) {
        hit = true;
        if (d > 0.0001) {
          const push = r + half - d;
          p.x += (dx / d) * push; p.y += (dy / d) * push;
        } else {
          const sx = s.x2 - s.x1, sy = s.y2 - s.y1;
          const l = Math.hypot(sx, sy) || 1;
          p.x += (-sy / l) * (r + half); p.y += (sx / l) * (r + half);
        }
      }
    }
  }
  return hit;
}
function isOpen(x, y, r) {
  for (const b of COLL.blocks) {
    if (x > b.x - r && x < b.x + b.w + r && y > b.y - r && y < b.y + b.h + r) return false;
  }
  for (const s of COLL.segs) {
    if (segDist(x, y, s.x1, s.y1, s.x2, s.y2) < r + (s.half != null ? s.half : 7)) return false;
  }
  return true;
}
/* 基地门口保护区: 路障不可放在门口通道内(防堵门) */
function barClear(x, y) {
  for (const dk of MAP.doorKeep) {
    if (Math.hypot(x - dk.x, y - dk.y) < dk.r) return false;
  }
  return true;
}
/* 贼窝安全区: 圈内警察无法逮捕小偷(防出生点人肉堵门),
   圈内也不刷金币, 小偷必须出门才能得分 */
const DEN_SAFE = { x: 1360, y: 700, r: 132 };
function inSafeZone(x, y) {
  return Math.hypot(x - DEN_SAFE.x, y - DEN_SAFE.y) < DEN_SAFE.r;
}

/* ---------------- 玩家 ---------------- */
function makeP(side, bot, name) {
  return {
    id: ++S.seqP, side: side, bot: bot ? 1 : 0, name: name,
    x: 0, y: 0, vx: 0, vy: 0, dir: 0,
    cd: [0, 0, 0], snare: 0, slow: 0, cau: 0, inv: 0, dis: 0, spr: 0, catchCd: 0,
    sc: 0, st: { c: 0, l: 0, i: 0 },
    lootT: 0, lootX: 0, lootY: 0, breakT: 0,
    aimx: 0, aimy: 0, aimSet: 0, inx: 0, iny: 0,
    goal: null, gx: 0, gy: 0, stuck: 0, det: 0, dets: 1, tng: null, disc: 0
  };
}
function spawnPlayer(p) {
  const sp = MAP.spawn[p.side === 0 ? "police" : "thief"];
  const pt = sp[(Math.random() * sp.length) | 0];
  p.x = pt[0]; p.y = pt[1];
  p.vx = p.vy = 0; p.snare = p.slow = p.cau = p.spr = p.dis = 0;
  p.cd = [0, 0, 0]; p.catchCd = 0; p.inv = TUN.inv; p.goal = null; p.det = 0; p.stuck = 0;
  fx("respawn", p.x, p.y, { side: p.side });
}
function spawnAt(p) { spawnPlayer(p); }

function countHumans() {
  const c = [0, 0];
  for (const q of S.pl) if (!q.bot) c[q.side]++;
  return c;
}

/* ---------------- 道具 ---------------- */
function applyEffect(p, k) {
  // 归一化瞄准: 玩家从未设置过瞄准(未移动鼠标)时, 回退到角色朝向 300px(与客户端路障预览规则一致)
  if (!p.aimSet) {
    p.aimx = p.x + Math.cos(p.dir) * 300;
    p.aimy = p.y + Math.sin(p.dir) * 300;
  }
  if (p.side === 0) {
    if (k === 0) {
      let a = Math.atan2(p.aimy - p.y, p.aimx - p.x);
      if (Math.hypot(p.aimx - p.x, p.aimy - p.y) < 70) a = p.dir;
      // 瞄准辅助: 投掷方向 ±26° 内最近可见的小偷, 自动修正弹道(含速度预判)
      let best = null, bda = 0.46;
      for (const t of enemies(1)) {
        if (t.cau > 0 || t.inv > 0 || t.dis > 0 || inSmokeAny(t)) continue;
        const d = Math.hypot(t.x - p.x, t.y - p.y);
        if (d < 40 || d > 460) continue;
        const da = Math.abs(angDiff(a, Math.atan2(t.y - p.y, t.x - p.x)));
        if (da < bda) { bda = da; best = t; }
      }
      if (best) a = Math.atan2(best.y + best.vy * 0.22 - p.y, best.x + best.vx * 0.22 - p.x);
      S.its.cuff.push({
        id: ++S.seqP, x: p.x, y: p.y, vx: Math.cos(a) * TUN.cuff.sp, vy: Math.sin(a) * TUN.cuff.sp,
        t: TUN.cuff.life, ox: p.x, oy: p.y
      });
      fx("cuff", p.x, p.y, { side: 0 });
    } else if (k === 1) {
      S.its.dog.push({ id: ++S.seqP, x: p.x + Math.cos(p.dir) * 20, y: p.y + Math.sin(p.dir) * 20, t: TUN.dog.life, tg: null, hitCd: 0, dir: p.dir });
      fx("dog", p.x, p.y, { side: 0 });
    } else if (k === 2) {
      const a = Math.atan2(p.aimy - p.y, p.aimx - p.x);
      let d = Math.hypot(p.aimx - p.x, p.aimy - p.y);
      let cx, cy;
      if (d < 80 || d > 460) { cx = p.x + Math.cos(a) * 300; cy = p.y + Math.sin(a) * 300; }
      else { cx = p.aimx; cy = p.aimy; }
      const h = TUN.bar.len / 2;
      const s = { id: ++S.seqP, x1: cx - Math.sin(a) * h, y1: cy + Math.cos(a) * h, x2: cx + Math.sin(a) * h, y2: cy - Math.cos(a) * h, t: TUN.bar.life, side: 0 };
      if (TEST && k === 2) console.log("[bar]", p.name, "cand=" + cx.toFixed(0) + "," + cy.toFixed(0), "d=" + d.toFixed(0), "ok=" + (isOpen(cx, cy, 10) && isOpen(s.x1, s.y1, 8) && isOpen(s.x2, s.y2, 8) && barClear(cx, cy) && barClear(s.x1, s.y1) && barClear(s.x2, s.y2)));
      if (!isOpen(cx, cy, 10) || !isOpen(s.x1, s.y1, 8) || !isOpen(s.x2, s.y2, 8) ||
        !barClear(cx, cy) || !barClear(s.x1, s.y1) || !barClear(s.x2, s.y2)) {
        fx("deny", cx, cy, { side: 0, n: p.name, why: "place" });
        return false; // 放置失败: 不扣冷却 / 不扣积分
      }
      S.its.bar.push(s);
      fx("bar", cx, cy, { side: 0 });
    }
  } else {
    if (k === 0) {
      S.its.smoke.push({ id: ++S.seqP, x: p.x, y: p.y, r: TUN.smoke.r, t: TUN.smoke.life });
      fx("smoke", p.x, p.y, { side: 1 });
    } else if (k === 1) {
      p.spr = TUN.sprint.t;
      fx("sprint", p.x, p.y, { side: 1 });
    } else if (k === 2) {
      p.dis = TUN.disg.t;
      fx("disg", p.x, p.y, { side: 1 });
    }
  }
  return true;
}
function useItem(p, k, xch, fromBot) {
  const spec = ITEMS[p.side][k];
  if (S.ph !== "go" || S.gt > 0 || p.cau > 0) return false;
  if (p.snare > 0) {
    // 被手铐禁锢期间无法使用任何道具(疾跑/烟雾弹/伪装均不可)
    fx("deny", p.x, p.y, { side: p.side, n: p.name, why: "snare" });
    return false;
  }
  if (p.cd[k] > 0 && !xch) return false;
  let spent = 0;
  if (p.cd[k] > 0 && xch) {
    if (S.sc[p.side] < spec.cost) { fx("deny", p.x, p.y, { side: p.side, n: p.name, why: "point" }); return false; }
    S.sc[p.side] -= spec.cost;
    spent = spec.cost;
    feed("⚡ " + SIDE[p.side] + "消耗 " + spec.cost + " 分兑换「" + spec.name + "」");
  }
  const before = p.cd[k];
  p.cd[k] = spec.cd;
  p.st.i++;
  const ok = applyEffect(p, k);
  if (!ok) {
    // 释放失败(如路障卡进建筑): 冷却与兑换积分全部回滚
    p.cd[k] = before;
    p.st.i--;
    if (spent) S.sc[p.side] += spent;
  }
  return ok;
}

/* ---------------- AI ---------------- */
function enemies(side) { return S.pl.filter((q) => q.side === side); }
function setDir(p, x, y) { p.inx = x; p.iny = y; }
function nearestCoin(p, maxD) {
  let best = null, bd = maxD;
  for (const c of S.coins) {
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
function wander(p) {
  if (!p.goal || Math.hypot(p.gx - p.x, p.gy - p.y) < 60) {
    let x, y, tries = 0;
    do {
      x = 120 + Math.random() * (MAP.world.w - 240);
      y = 120 + Math.random() * (MAP.world.h - 240);
      tries++;
    } while (!isOpen(x, y, 18) && tries < 20);
    p.goal = { x, y }; p.gx = x; p.gy = y;
  }
  const a = Math.atan2(p.gy - p.y, p.gx - p.x);
  setDir(p, Math.cos(a), Math.sin(a));
}
function thiefAI(p) {
  let nc = null, nd = 1e9;
  for (const c of enemies(0)) {
    if (c.cau > 0) continue;
    const d = dist(c, p);
    if (d < nd) { nd = d; nc = c; }
  }
  if (nc && nd < 235) {
    const a = Math.atan2(p.y - nc.y, p.x - nc.x) + (Math.random() - 0.5) * 0.9;
    setDir(p, Math.cos(a), Math.sin(a));
    if (p.cd[1] <= 0 && (nd < 150 || p.stuck > 0.35) && !p.spr) useItem(p, 1, false, true);
    if (p.cd[0] <= 0 && nd < 175 && Math.random() < 0.5) useItem(p, 0, false, true);
    if (p.cd[2] <= 0 && !p.dis && nd < 265 && Math.random() < 0.35) useItem(p, 2, false, true);
    p.goal = null;
    return;
  }
  const coin = nearestCoin(p, 950);
  if (coin) {
    const dC = Math.hypot(coin.x - p.x, coin.y - p.y);
    if (dC < 48) {
      // 贴近金币: 驻留等待盗取读条完成
      setDir(p, 0, 0);
    } else {
      const a = Math.atan2(coin.y - p.y, coin.x - p.x);
      setDir(p, Math.cos(a), Math.sin(a));
    }
    p.goal = null;
    if (nc && nd < 480 && p.cd[1] <= 0 && !p.spr && Math.random() < 0.1) useItem(p, 1, false, true);
  } else {
    wander(p);
  }
}
function copAI(p) {
  let nt = null, nd = 1e9;
  for (const t of enemies(1)) {
    if (t.cau > 0 || t.dis > 0 || t.inv > 0) continue;
    if (inSmokeAny(t)) continue;
    const d = dist(t, p);
    if (d < nd) { nd = d; nt = t; }
  }
  if (nt) {
    p.aimx = nt.x + nt.vx * 0.22; p.aimy = nt.y + nt.vy * 0.22;
    const a = Math.atan2(nt.y - p.y, nt.x - p.x);
    setDir(p, Math.cos(a), Math.sin(a));
    p.goal = null;
    if (p.cd[0] <= 0 && nd > 150 && nd < 360 && !smokeBetween(p, nt)) useItem(p, 0, false, true);
    else if (p.cd[1] <= 0 && nd > 430) useItem(p, 1, false, true);
    else if (p.cd[2] <= 0 && nd < 300 && nt.spr > 0) { p.aimx = nt.x; p.aimy = nt.y; useItem(p, 2, false, true); }
  } else {
    wander(p);
  }
}
function botBrain(p) {
  if (p.cau > 0 || S.ph !== "go" || S.gt > 0) return;
  if ((p.id + S.tk) % 5 !== 0) return;
  if (p.side === 1) thiefAI(p);
  else copAI(p);
}

/* ---------------- 烟雾 / 路障 辅助 ---------------- */
function inSmokeAny(p) {
  for (const c of S.its.smoke) {
    if (c.t <= 0) continue;
    if (Math.hypot(c.x - p.x, c.y - p.y) < c.r - 6) return true;
  }
  return false;
}
function smokeBetween(a, b) {
  for (const c of S.its.smoke) {
    if (c.t <= 0) continue;
    if (segDist(c.x, c.y, a.x, a.y, b.x, b.y) < c.r) return true;
  }
  return false;
}

/* ---------------- 每帧更新 ---------------- */
function stepPlayer(p, dt) {
  for (let i = 0; i < 3; i++) if (p.cd[i] > 0) p.cd[i] -= dt;
  if (p.catchCd > 0) p.catchCd -= dt;
  if (p.snare > 0) p.snare -= dt;
  if (p.slow > 0) p.slow -= dt;
  if (p.inv > 0) p.inv -= dt;
  if (p.spr > 0) p.spr -= dt;
  if (p.dis > 0) p.dis -= dt;
  if (p.cau > 0) {
    p.cau -= dt; p.vx = p.vy = 0;
    if (p.cau <= 0) spawnPlayer(p);
    return;
  }
  // 机器人绕障(卡住切向)
  if (p.bot && p.det > 0) {
    p.det -= dt;
    const a = Math.atan2(p.gy - p.y, p.gx - p.x) + Math.PI / 2 * p.dets;
    setDir(p, Math.cos(a), Math.sin(a));
  } else if (p.bot && p.goal) {
    if (p.stuck > 0.55 && !p.det) { p.det = 0.5; p.dets = Math.random() < 0.5 ? 1 : -1; }
  }
  let sp = TUN.base[p.side];
  if (p.spr > 0) sp *= TUN.sprint.mul;
  if (p.slow > 0) sp *= 0.5;
  if (p.snare > 0) sp = 0;
  let ix = p.inx || 0, iy = p.iny || 0;
  const il = Math.hypot(ix, iy);
  if (il > 1) { ix /= il; iy /= il; }
  p.vx = ix * sp; p.vy = iy * sp;
  p.x += p.vx * dt; p.y += p.vy * dt;
  if (il > 0.01) p.dir = Math.atan2(iy, ix);
  const blocked = resolveEnt(p, 15, p.side === 1 ? S.its.bar : null);
  if (blocked && Math.hypot(p.vx, p.vy) > 20 && p.goal) p.stuck += dt;
  else if (Math.abs(p.vx) + Math.abs(p.vy) > 10) p.stuck = Math.max(0, p.stuck - dt * 2);
  // 玩家间软分离
  for (const q of S.pl) {
    if (q === p || q.cau > 0) continue;
    const d = dist(p, q);
    if (d > 0.001 && d < 30) {
      const push = (30 - d) / 2;
      const nx = (p.x - q.x) / d, ny = (p.y - q.y) / d;
      p.x += nx * push; p.y += ny * push;
      q.x -= nx * push; q.y -= ny * push;
    }
  }
  p.x = clamp(p.x, 10, MAP.world.w - 10);
  p.y = clamp(p.y, 10, MAP.world.h - 10);
}
function stepCoins(dt) {
  // 盗取读条: 小偷需贴近金币 0.8 秒完成窃取, 离开范围/被抓即中断
  for (const t of S.pl) {
    if (t.side !== 1 || t.cau > 0) { t.lootT = 0; continue; }
    let c = null, cd = 1e9;
    for (const coin of S.coins) {
      const d = Math.hypot(coin.x - t.x, coin.y - t.y);
      if (d < cd) { cd = d; c = coin; }
    }
    if (c && cd < TUN.coinR + 8) {
      if (t.lootT <= 0) {
        if (t.dis > 0) {
          // 伪装状态下盗取会被当场识破
          t.dis = 0;
          fx("reveal", t.x, t.y, { side: 1 });
          feed("🕵️ " + t.name + " 偷窃时被识破伪装!");
        }
        t.lootT = TUN.lootTime;
      }
      t.lootT -= dt;
      t.lootX = c.x; t.lootY = c.y;
      if (t.lootT <= 0) {
        const idx = S.coins.indexOf(c);
        if (idx >= 0) S.coins.splice(idx, 1);
        S.sc[1]++; t.sc++; t.st.l++;
        fx("loot", c.x, c.y, { side: 1, n: t.name });
        feed("💰 " + t.name + " 盗走金币 (+1)");
        t.lootT = 0;
      }
    } else {
      t.lootT = 0;
    }
  }
  S.coinT -= dt;
  if (S.coins.length < TUN.coinMax && S.coinT <= 0) {
    S.coinT = TUN.coinDelay;
    let x, y, tries = 0, ok = false;
    while (tries++ < 30 && !ok) {
      x = 80 + Math.random() * (MAP.world.w - 160);
      y = 80 + Math.random() * (MAP.world.h - 160);
      if (isOpen(x, y, 22) &&
        Math.hypot(x - 160, y - 160) > 175 &&
        Math.hypot(x - 1340, y - 800) > 175 &&
        !inSafeZone(x, y)) ok = true;
    }
    if (ok) S.coins.push({ x, y, ph: Math.random() * 6.28 });
  }
}
function stepCuffs(dt) {
  const arr = S.its.cuff;
  for (let i = arr.length - 1; i >= 0; i--) {
    const c = arr[i];
    c.t -= dt;
    let dead = c.t <= 0;
    if (!dead) {
      c.x += c.vx * dt; c.y += c.vy * dt;
      if (resolveEnt(c, 6, null)) dead = true; // 撞墙
      else for (const cl of S.its.smoke) {
        if (Math.hypot(c.x - cl.x, c.y - cl.y) < cl.r - 10) { dead = true; break; }
      }
    }
    if (!dead) {
      for (const t of enemies(1)) {
        if (t.cau > 0 || t.inv > 0 || t.dis > 0) continue;
        if (Math.hypot(t.x - c.x, t.y - c.y) < 24) {
          t.snare = TUN.cuff.snare; t.spr = 0;
          fx("snare", t.x, t.y, { side: 1 });
          dead = true;
          break;
        }
      }
    }
    if (dead) arr.splice(i, 1);
  }
}
function dogTarget(dog) {
  let best = null, bd = 1e9;
  for (const t of enemies(1)) {
    if (t.cau > 0 || t.dis > 0 || t.inv > 0 || inSmokeAny(t)) continue;
    const d = Math.hypot(t.x - dog.x, t.y - dog.y);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}
function stepDogs(dt) {
  const arr = S.its.dog;
  for (let i = arr.length - 1; i >= 0; i--) {
    const d = arr[i];
    d.t -= dt;
    if (d.t <= 0) { arr.splice(i, 1); continue; }
    d.hitCd -= dt;
    if (!d.tg || d.tg.cau > 0 || d.tg.dis > 0 || d.tg.inv > 0 || inSmokeAny(d.tg)) d.tg = dogTarget(d);
    const t = d.tg;
    let a;
    if (t) a = Math.atan2(t.y - d.y, t.x - d.x);
    else { a = d.dir; d.dir += 0.1; }
    d.x += Math.cos(a) * TUN.dog.sp * dt;
    d.y += Math.sin(a) * TUN.dog.sp * dt;
    resolveEnt(d, 14, null);
    if (t && Math.hypot(t.x - d.x, t.y - d.y) < 26 && d.hitCd <= 0) {
      t.slow = TUN.dog.slow; d.hitCd = 1.1;
      fx("bite", t.x, t.y, { side: 0 });
    }
  }
}
function stepBarriers(dt) {
  // 小偷可贴身拆除路障(0.55秒), 防止路障堵死基地门口/通道
  for (const t of S.pl) {
    if (t.side !== 1 || t.cau > 0) { t.breakT = 0; continue; }
    let best = null, bd = 1e9;
    for (const b of S.its.bar) {
      const d = segDist(t.x, t.y, b.x1, b.y1, b.x2, b.y2);
      if (d < bd) { bd = d; best = b; }
    }
    if (best && bd < 26) {
      t.breakT += dt;
      if (t.breakT >= 0.55) {
        const idx = S.its.bar.indexOf(best);
        if (idx >= 0) S.its.bar.splice(idx, 1);
        t.breakT = 0;
        fx("break_bar", (best.x1 + best.x2) / 2, (best.y1 + best.y2) / 2, { side: 1, n: t.name });
      }
    } else {
      t.breakT = 0;
    }
  }
  for (let i = S.its.bar.length - 1; i >= 0; i--) {
    S.its.bar[i].t -= dt;
    if (S.its.bar[i].t <= 0) S.its.bar.splice(i, 1);
  }
}
function stepSmoke(dt) {
  for (let i = S.its.smoke.length - 1; i >= 0; i--) {
    S.its.smoke[i].t -= dt;
    if (S.its.smoke[i].t <= 0.2) S.its.smoke.splice(i, 1);
  }
}
function checkCatches() {
  for (const p of enemies(0)) {
    if (p.cau > 0 || p.catchCd > 0) continue;
    for (const t of enemies(1)) {
      if (t.cau > 0 || t.inv > 0 || t.dis > 0) continue;
      if (inSafeZone(t.x, t.y)) continue; // 安全区内不可逮捕
      if (inSmokeAny(t) || smokeBetween(p, t)) continue;
      if (TEST && t.bot === 0 && (p.bot === 0 || Math.random() < 0.05)) console.log("[catch]", p.name, "→", t.name, "d=" + dist(p, t).toFixed(1), "inv=" + t.inv.toFixed(1), "sna?f=" + t.f);
      if (dist(p, t) > TUN.catchR) continue;
      t.cau = TUN.cauHold; t.snare = 0; t.spr = 0;
      S.sc[0]++; p.sc++; p.st.c++;
      p.catchCd = TUN.catchCd;
      fx("arrest", t.x, t.y, { side: 0, n: p.name, t: t.name });
      feed("🚨 " + p.name + " 抓获了 " + t.name + " (+1)");
      break;
    }
  }
}
function checkVictory() {
  if (S.ph !== "go" || S.gt > 0) return;
  const th = enemies(1), cp = enemies(0);
  if (cp.length > 0 && th.length > 0 && th.every((t) => t.cau > 0)) { endRound(0, "sweep"); return; }
  if (S.sc[0] >= TUN.target) { endRound(0, "target"); return; }
  if (S.sc[1] >= TUN.target) { endRound(1, "target"); return; }
  if (S.tm <= 0) {
    if (S.sc[0] > S.sc[1]) endRound(0, "time");
    else if (S.sc[1] > S.sc[0]) endRound(1, "time");
    else endRound(-1, "draw");
  }
}
function endRound(winner, reason) {
  S.ph = "over";
  S.gt = TUN.over;
  S.its.cuff = []; S.its.dog = []; S.its.bar = []; S.its.smoke = [];
  const rows = S.pl.slice().sort((a, b) => b.sc - a.sc);
  const mvp = rows[0] || null;
  S.over = {
    winner: winner, reason: reason,
    mvp: mvp ? { n: mvp.name, s: mvp.side, b: mvp.bot, sc: mvp.sc } : null,
    rows: rows.slice(0, 10).map((q) => ({ n: q.name, s: q.side, b: q.bot, sc: q.sc, c: q.st.c, l: q.st.l }))
  };
  fx("win", MAP.world.w / 2, MAP.world.h / 2, { winner });
  feed(winner === -1 ? "🤝 平局!" : "🏆 " + SIDE[winner] + "阵营获胜! 进入结算…");
}
function rebalance() {
  const hum = countHumans();
  const want = [Math.min(TUN.maxHumans, Math.max(TUN.minBots, TUN.targetTeam - hum[0])),
    Math.min(TUN.maxHumans, Math.max(TUN.minBots, TUN.targetTeam - hum[1]))];
  const now = [0, 0];
  for (const q of S.pl) if (q.bot) now[q.side]++;
  for (let s = 0; s < 2; s++) {
    while (now[s] < want[s]) {
      const p = makeP(s, true, BOT_NAMES[s][(Math.random() * BOT_NAMES[s].length) | 0]);
      spawnPlayer(p);
      S.pl.push(p); now[s]++;
    }
    while (now[s] > want[s]) {
      const idx = S.pl.findIndex((q) => q.bot && q.side === s);
      if (idx >= 0) { S.pl.splice(idx, 1); now[s]--; } else break;
    }
  }
}
function resetRound() {
  rebalance();
  for (const p of S.pl) { p.sc = 0; p.st = { c: 0, l: 0, i: 0 }; spawnPlayer(p); }
  S.sc = [0, 0];
  S.tm = TUN.round; S.gt = TUN.gate; S.ph = "go";
  S.rnd++; S.coins = []; S.coinT = 0.8; S.over = null;
  S.its = { cuff: [], dog: [], bar: [], smoke: [] };
  fx("go", MAP.world.w / 2, MAP.world.h / 2, {});
}

/* ---------------- 主循环 ---------------- */
let lastT = Date.now();
function tick() {
  S.tk++;
  const now = Date.now();
  // 用真实经过时间驱动,避免 Windows 定时器精度(约21Hz)导致游戏时间变慢
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  try {
  if (S.ph === "go") {
    if (S.gt > 0) {
      S.gt -= dt;
      if (S.gt <= 0) fx("go", MAP.world.w / 2, MAP.world.h / 2, {});
    } else {
      S.tm -= dt;
      for (const p of S.pl) {
        if (p.bot) botBrain(p);
        stepPlayer(p, dt);
      }
      stepCoins(dt);
      stepCuffs(dt);
      stepDogs(dt);
      stepBarriers(dt);
      stepSmoke(dt);
      checkCatches();
      checkVictory();
    }
  } else if (S.ph === "over") {
    S.gt -= dt;
    if (S.gt <= 0) resetRound();
  }
  } catch (e) { console.error("[tick] ERROR: " + (e && e.stack || e)); }
  broadcast();
}

/* ---------------- 网络 ---------------- */
function send(ws, o) {
  if (ws.readyState === 1) {
    try { ws.send(JSON.stringify(o)); } catch (e) {}
  }
}
function buildState() {
  const pl = S.pl.map((p) => ({
    id: p.id, s: p.side, b: p.bot, n: p.name, x: Math.round(p.x), y: Math.round(p.y),
    cd: p.cd.map((v) => +v.toFixed(1)),
    f: (p.snare > 0 ? 1 : 0) | (p.inv > 0 ? 2 : 0) | (p.dis > 0 ? 4 : 0) | (p.spr > 0 ? 8 : 0) | (p.slow > 0 ? 16 : 0),
    c: p.cau > 0 ? 1 : 0, res: p.cau > 0 ? +p.cau.toFixed(1) : -1,
    d: +p.dir.toFixed(2),
    lp: p.lootT > 0 ? +(1 - p.lootT / TUN.lootTime).toFixed(2) : -1,
    sc: p.sc
  }));
  const its = {
    cuff: S.its.cuff.map((c) => [Math.round(c.x), Math.round(c.y), +c.vx.toFixed(0), +c.vy.toFixed(0), c.id]),
    dog: S.its.dog.map((d) => [Math.round(d.x), Math.round(d.y), d.id]),
    bar: S.its.bar.map((b) => [Math.round(b.x1), Math.round(b.y1), Math.round(b.x2), Math.round(b.y2), b.id]),
    smoke: S.its.smoke.map((c) => [Math.round(c.x), Math.round(c.y), Math.round(c.r), +c.t.toFixed(1), c.id])
  };
  const coins = S.coins.map((c) => [Math.round(c.x), Math.round(c.y)]);
  return {
    t: "st", tk: S.tk, ph: S.ph, gt: +S.gt.toFixed(2), tm: +Math.max(0, S.tm).toFixed(1), rnd: S.rnd,
    sc: S.sc, tgt: S.tgt, over: S.over,
    pl: pl, coins: coins, its: its,
    ev: S.ev, feed: S.feed.slice()
  };
}
function broadcast() {
  const st = buildState();
  const s = JSON.stringify(st);
  S.ev = [];
  for (const ws of S.clients.keys()) {
    if (ws.readyState === 1) {
      try { ws.send(s); } catch (e) {}
    }
  }
}

/* ---------------- HTTP 静态托管 ---------------- */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json"
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const file = path.join(__dirname, "public", p);
  if (!file.startsWith(path.join(__dirname, "public"))) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not Found"); return; }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(data);
  });
});
const wss = new WebSocketServer({ server });

function sanitize(name) {
  name = String(name || "").replace(/[<>&"']/g, "").trim().slice(0, 10);
  return name || "路人" + ((Math.random() * 900 + 100) | 0);
}

wss.on("connection", (ws) => {
  ws.p = null;
  ws.side = -1;
  S.clients.set(ws, { id: null, side: -1 });
  send(ws, { t: "hi", cfg: { round: TUN.round, target: TUN.target } });
  ws.on("message", (buf) => {
    let m;
    try { m = JSON.parse(buf.toString()); } catch (e) { return; }
    if (m.t === "join") {
      const side = m.f === 1 ? 1 : 0;
      const hum = countHumans();
      if (hum[side] >= TUN.maxHumans) { send(ws, { t: "err", msg: "该阵营已满员, 请加入另一阵营或观战" }); return; }
      if (ws.p) { S.pl = S.pl.filter((q) => q !== ws.p); ws.p = null; }
      const p = makeP(side, false, sanitize(m.n));
      spawnPlayer(p);
      S.pl.push(p);
      ws.p = p; ws.side = side;
      send(ws, { t: "ok", id: p.id, side: side });
      feed("📢 " + p.name + " 加入了" + SIDE[side]);
      fx("join", p.x, p.y, { side: side });
    } else if (m.t === "mv" && ws.p) {
      const p = ws.p;
      p.inx = +m.x || 0; p.iny = +m.y || 0;
      if (m.ax != null) { p.aimx = +m.ax; p.aimy = +m.ay; p.aimSet = 1; }
    } else if (m.t === "use" && ws.p) {
      if (TEST) console.log("[use]", ws.p.name, "k=" + m.k, "cd=" + ws.p.cd.map(v => v.toFixed(1)).join(","), "aim=" + ws.p.aimx.toFixed(0) + "," + ws.p.aimy.toFixed(0), "ph=" + S.ph, "gt=" + S.gt.toFixed(2), "cau=" + ws.p.cau);
      useItem(ws.p, m.k | 0, m.x ? 1 : 0, false);
    } else if (m.t === "leave" && ws.p) {
      const nm = ws.p.name;
      S.pl = S.pl.filter((q) => q !== ws.p);
      feed("👋 " + nm + " 离开战场");
      ws.p = null; ws.side = -1;
    } else if (m.t === "dev" && TEST) {
      if (m.k === "end") endRound(m.w != null ? m.w : 0, "dev");
      if (m.k === "score") S.sc = [+m.p || 0, +m.t || 0];
      if (m.k === "tp" && ws.p) { ws.p.x = +m.x || 100; ws.p.y = +m.y || 100; }
    }
  });
  ws.on("close", () => {
    S.clients.delete(ws);
    if (ws.p) {
      // 真人掉线 → AI 接管, 保持战场人数
      ws.p.bot = 1; ws.p.disc = 1; ws.p.inx = ws.p.iny = 0;
      ws.p.name = ws.p.name + "(托管)";
      feed("📡 " + ws.p.name + " 掉线, 已由 AI 接管");
      ws.p = null;
    }
  });
  ws.on("error", () => {});
});
// 心跳
setInterval(() => {
  for (const ws of S.clients.keys()) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  }
}, 20000);
wss.on("connection", (ws) => {
  ws.on("pong", () => { ws.isAlive = true; });
});

/* ---------------- 启动 ---------------- */
// 初始机器人阵容
rebalance();
S.pl.forEach((p) => spawnPlayer(p));
setInterval(tick, 1000 / 30);
server.listen(PORT, "0.0.0.0", () => {
  console.log("🚨 警匪追逐服务端已启动:  http://localhost:" + PORT + "   (test模式: " + TEST + ")");
  console.log("   对战人数: " + S.pl.length + "  |  每局 " + TUN.round + " 秒  |  目标 " + TUN.target + " 分");
});
