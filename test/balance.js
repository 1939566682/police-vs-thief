/* ============ 平衡性验证: 路障失败回滚 / 手铐吸附 / 金币盗取读条 ============ */
"use strict";
const WebSocket = require("ws");
const URL = process.env.SMOKE_URL || "ws://localhost:3101";
let fail = 0;
function ok(cond, msg) {
  if (cond) console.log("  ✓ " + msg);
  else { fail++; console.error("  ✗ " + msg); }
}
function client() {
  const ws = new WebSocket(URL);
  const q = [];
  ws.on("message", (d) => { const m = JSON.parse(d.toString()); q.forEach((f) => f(m)); });
  return { ws, q, last: null, on: function (f) { this.q.push(f); }, send: (o) => ws.send(JSON.stringify(o)) };
}
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function findMe(c) {
  if (!c.last || !c.last.pl) return null;
  return c.last.pl.find((p) => p.n === c.n);
}
async function waitFree(c, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 9000)) {
    await wait(150);
    const m = findMe(c);
    if (m && !(m.f & 2) && !(m.f & 1) && m.c <= 0 && m.res < 0) return true;
  }
  return false;
}

(async () => {
  console.log("[balance] 连接测试服务器 " + URL);
  const A = client(); A.n = "平衡警察";
  A.on((m) => { if (m.t === "st") A.last = m; });
  const B = client(); B.n = "平衡小偷";
  B.on((m) => { if (m.t === "st") B.last = m; });
  await wait(400);
  A.send({ t: "join", f: 0, n: A.n });
  B.send({ t: "join", f: 1, n: B.n });
  await wait(600);
  ok(!!findMe(A) && !!findMe(B), "双玩家入场");

  /* 重置对局, 进入稳定进行阶段 */
  A.send({ t: "dev", k: "end", w: 0 });
  for (let i = 0; i < 70; i++) {
    await wait(300);
    if (A.last && A.last.ph === "go" && A.last.gt <= 0.05) break;
  }
  ok(A.last && A.last.ph === "go", "对局已重置并进入进行阶段");

  const tp = (c, x, y) => c.send({ t: "dev", k: "tp", x, y });

  /* ---- 测试1: 路障放进建筑 → 失败 → 冷却回滚/积分不扣 ---- */
  console.log("[balance] 路障失败回滚");
  A.send({ t: "dev", k: "score", p: 5, t: 0 });
  await wait(400);
  const s1 = A.last.sc[0];
  tp(A, 300, 150); // B1 建筑左侧空地
  await wait(250);
  A.send({ t: "mv", x: 0, y: 0, ax: 430, ay: 160 }); // 瞄准 B1 建筑内部
  await wait(200);
  A.send({ t: "use", k: 2, x: 1 }); // 积分兑换路障 → 应失败
  await wait(500);
  const meA = findMe(A);
  const s2 = A.last.sc[0];
  ok(meA && meA.cd[2] <= 0.01, "路障失败后冷却回滚 (cd[2]=" + (meA ? meA.cd[2] : "?") + ")");
  ok(s2 >= s1 - 1, "失败兑换未扣积分 (s1=" + s1 + " → s2=" + s2 + ")");

  /* ---- 测试1b: 基地门口保护区(防堵门) ---- */
  console.log("[balance] 基地门口禁放路障");
  tp(A, 1240, 610);
  await wait(300);
  A.send({ t: "mv", x: 0, y: 0, ax: 1360, ay: 660 }); // 瞄准贼窝门口通道
  await wait(200);
  A.send({ t: "use", k: 2, x: 0 });
  await wait(400);
  const doorMe = findMe(A);
  ok(doorMe && doorMe.cd[2] <= 0.01, "门口保护区拒绝放置且不扣冷却 (cd[2]=" + (doorMe ? doorMe.cd[2] : "?") + ")");

  /* ---- 测试1c: 滚轮朝向 + 小偷贴身拆除路障 ---- */
  console.log("[balance] 路障滚轮朝向与拆除");
  tp(A, 200, 600);
  await wait(300);
  A.send({ t: "mv", x: 0, y: 0, ax: 400, ay: 500 }); // 开阔点: 端点不戳建筑
  await wait(200);
  A.send({ t: "use", k: 2, x: 0, rot: 1.5708 }); // 滚轮旋转 +90°
  await wait(400);
  const haveBar = A.last.its.bar.length > 0;
  ok(haveBar, "警察已在开阔地放置路障 (" + A.last.its.bar.length + " 个)");
  if (haveBar) {
    const bars0 = A.last.its.bar.length;
    const b0 = A.last.its.bar.find((b) => Math.abs((b[0] + b[2]) / 2 - 400) < 60) || A.last.its.bar[0];
    const ang = Math.atan2(b0[3] - b0[1], b0[2] - b0[0]);
    const aimA = Math.atan2(500 - 600, 400 - 200); // 瞄准方向 ≈ -0.46
    const noRot = aimA - Math.PI / 2; // 未旋转时段方向(垂直瞄准)
    ok(Math.abs(ang - aimA) < 0.15 && Math.abs(ang - noRot) > 1.0,
      "滚轮 +90° 朝向生效 (段角=" + ang.toFixed(2) + "rad, 未旋转应为" + noRot.toFixed(2) + ")");
    const mx = (b0[0] + b0[2]) / 2, my = (b0[1] + b0[3]) / 2;
    // 小偷贴到路障中点拆除(最多重试3轮, 防NPC干扰)
    let removed = false;
    for (let r = 0; r < 3 && !removed; r++) {
      await waitFree(B, 5000);
      tp(B, mx, my);
      await wait(900);
      removed = A.last.its.bar.length < bars0;
      if (!removed) console.log("  [retry] 拆除第" + (r + 1) + "轮未完成, 重试");
    }
    ok(removed, "路障被小偷拆除 (" + bars0 + "→" + A.last.its.bar.length + ")");
  }

  /* ---- 测试1d: 贼窝安全区(防人肉堵门) ---- */
  console.log("[balance] 贼窝安全区不可逮捕");
  // 先站到圈外空地, 等重生保护(inv)完全结束, 排除干扰
  tp(B, 1150, 500);
  await waitFree(B, 6000);
  tp(B, 1360, 650); // 圈内(距门口 ~50)
  await wait(300);
  tp(A, 1376, 664); // 警察紧贴小偷(距离 ~20, 同处安全圈)
  await wait(700);
  const bIn = findMe(B);
  ok(bIn && bIn.c <= 0 && bIn.res < 0 && !(bIn.f & 1), "圈内紧贴不触发逮捕 (B.res=" + bIn.res + ")");
  // 圈外对照: 出圈立即恢复可捕(若被NPC干扰自动重试)
  let caught = false;
  for (let r = 0; r < 3 && !caught; r++) {
    tp(B, 1150, 500);
    await waitFree(B, 5000);
    const bf = findMe(B);
    if (!bf || Math.abs(bf.x - 1150) > 80 || Math.abs(bf.y - 500) > 80) continue; // 没站住(被抓重生)
    tp(A, 1170, 515); // 距离 ~28, 圈外
    await wait(800);
    const bo = findMe(B);
    if (bo && (bo.c > 0 || bo.res > 0)) caught = true;
    else console.log("  [retry] 圈外逮捕未触发, 重试");
  }
  ok(caught, "圈外接触正常逮捕");
  // 等 B 重生自由, 供后续用例使用
  await waitFree(B, 8000);

  /* ---- 测试2: 手铐瞄准吸附 ── 偏角 11° 自动修正 ---- */
  console.log("[balance] 手铐弹道吸附");
  await waitFree(B, 6000); // 等待保护期结束
  tp(A, 300, 330);
  tp(B, 460, 330); // B 在 A 正东 160px
  await wait(300);
  A.send({ t: "mv", x: 0, y: 0, ax: 310, ay: 332 }); // 瞄准偏上 ~11°
  await wait(200);
  A.send({ t: "use", k: 0, x: 0 });
  await wait(120); // 手铐 640 速度, 160px 距离 0.25s 命中, 必须提前读取
  const cuff = A.last.its.cuff.length ? A.last.its.cuff[0] : null;
  const meB = findMe(B);
  const snared = meB && (meB.f & 1) ? true : false;
  ok(!!cuff || snared, "手铐已发射(或已命中目标)");
  if (cuff) {
    const flyA = Math.atan2(cuff[3], cuff[2]);
    const diff = Math.abs(flyA);
    ok(diff < 0.12, "飞行方向吸附到正东目标 (偏差=" + (diff * 57.3).toFixed(1) + "°)");
  } else {
    ok(snared, "手铐命中并禁锢目标 (f=" + (meB ? meB.f : "?") + ")");
  }

  /* ---- 测试2b: 禁锢期间道具禁用, 禁锢结束恢复 ---- */
  console.log("[balance] 禁锢期间道具禁用");
  let sna = false;
  for (let i = 0; i < 16; i++) {
    await wait(120);
    const m = findMe(B);
    if (m && (m.f & 1)) { sna = true; break; }
  }
  if (!sna) {
    ok(false, "前置: 小偷未被手铐禁锢(吸附测试未命中?)");
  } else {
    ok(true, "小偷已被手铐禁锢 (f=" + findMe(B).f + ")");
    const cdBefore = findMe(B).cd[1];
    B.send({ t: "use", k: 1, x: 0 }); // 疾跑 → 应被禁锢拒绝
    await wait(600);
    const meB = findMe(B);
    ok(meB.cd[1] === cdBefore && !(meB.f & 8), "禁锢中疾跑被拒绝 (cd[1]=" + meB.cd[1] + ")");
    // 等禁锢结束 + 可能被抓后的重生期, 轮询至完全自由
    await waitFree(B, 8000);
    const freeB = findMe(B);
    if (!freeB || freeB.c > 0 || freeB.res >= 0) {
      ok(false, "目标未能恢复自由状态(被NPC抓走, 环境干扰)");
    } else {
      B.send({ t: "use", k: 1, x: 0 });
      await wait(600);
      const meB2 = findMe(B);
      ok(meB2.cd[1] > 10, "禁锢结束后疾跑可触发 (cd[1]=" + meB2.cd[1] + ", f=" + meB2.f + ")");
    }
  }

  /* ---- 测试3: 金币盗取读条 ── 动态坐标, 站桩0.8s / 打断 / 伪装识破 ---- */
  console.log("[balance] 金币盗取读条");
  const base = findMe(B) ? findMe(B).sc : 0;
  // 完成窃取(金币可能被NPC抢/目标被抓, 最多重试4轮)
  let scored = false, coinFound = false;
  for (let r = 0; r < 4 && !scored; r++) {
    await waitFree(B, 6000);
    let cx = 0, cy = 0;
    for (let i = 0; i < 40; i++) {
      await wait(150);
      if (B.last && B.last.coins.length) { cx = B.last.coins[0][0]; cy = B.last.coins[0][1]; break; }
    }
    if (!cx) continue;
    coinFound = true;
    tp(B, cx - 6, cy - 6);
    for (let i = 0; i < 15; i++) { // 等读条出现
      await wait(120);
      if (findMe(B) && findMe(B).lp >= 0) break;
    }
    for (let i = 0; i < 25; i++) { // 等完成
      await wait(120);
      if (findMe(B) && findMe(B).sc > base) { scored = true; break; }
    }
  }
  ok(coinFound, "找到场上金币");
  ok(scored, "读条完成后 +1 (sc=" + (findMe(B) ? findMe(B).sc : "?") + ")");
  // 打断: 找新金币, 开始读条后离开(失败自动重试一轮)
  let interrupted = false;
  for (let r = 0; r < 3 && !interrupted; r++) {
    await waitFree(B, 6000);
    let c2x = 0, c2y = 0;
    for (let i = 0; i < 40; i++) {
      await wait(150);
      if (B.last && B.last.coins.length) { c2x = B.last.coins[0][0]; c2y = B.last.coins[0][1]; break; }
    }
    if (!c2x) break;
    const base2 = findMe(B) ? findMe(B).sc : 0;
    tp(B, c2x - 6, c2y - 6);
    let started = false;
    for (let i = 0; i < 12; i++) {
      await wait(120);
      const me = findMe(B);
      if (me && me.lp >= 0) { started = true; break; }
    }
    if (!started) continue;
    tp(B, c2x + 140, c2y + 140); // 离开
    await wait(600);
    const me3 = findMe(B);
    const stillThere = B.last.coins.some((c) => c[0] === c2x && c[1] === c2y);
    const notScored = findMe(B) ? findMe(B).sc === base2 : false;
    if (me3 && me3.lp < 0 && stillThere && notScored) interrupted = true;
  }
  ok(interrupted, "离开后读条中断且金币保留未计分");
  A.ws.close(); B.ws.close();
  console.log(fail === 0 ? "\n✅ 平衡性验证全部通过" : "\n❌ 有 " + fail + " 项失败");
  process.exit(fail === 0 ? 0 : 1);
})();