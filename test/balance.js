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

  /* ---- 测试2: 手铐瞄准吸附 ── 偏角 11° 自动修正 ---- */
  console.log("[balance] 手铐弹道吸附");
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
    for (let i = 0; i < 60; i++) {
      await wait(120);
      const m = findMe(B);
      if (m && !(m.f & 1) && m.c <= 0 && m.res < 0) break;
    }
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
  // 等待目标完全自由(可能被NPC抓走重生)
  for (let i = 0; i < 40; i++) {
    await wait(150);
    const m = findMe(B);
    if (m && m.c <= 0 && m.res < 0) break;
  }
  let coin = null, cx = 0, cy = 0, base = findMe(B) ? findMe(B).sc : 0;
  for (let i = 0; i < 40; i++) {
    await wait(150);
    const st = B.last;
    if (st && st.coins.length) { coin = st.coins[0]; cx = coin[0]; cy = coin[1]; break; }
  }
  ok(!!coin, "找到场上金币 (" + cx + "," + cy + ")");
  if (coin) {
    tp(B, cx - 6, cy - 6);
    let lp = -1;
    for (let i = 0; i < 20; i++) {
      await wait(120);
      const me = findMe(B);
      if (me && me.lp >= 0) { lp = me.lp; break; }
    }
    ok(lp >= 0, "读条出现 (lp=" + lp + ")");
    // 等待完成 +1
    let done = false, gone = false;
    for (let i = 0; i < 25; i++) {
      await wait(120);
      const me = findMe(B);
      if (me && me.sc > base) done = true;
      if (!B.last.coins.some((c) => c[0] === cx && c[1] === cy)) gone = true;
      if (done && gone) break;
    }
    ok(done && gone, "读条完成后 +1 且金币消失 (sc=" + (findMe(B) ? findMe(B).sc : "?") + ")");
    // 打断: 找新金币, 开始读条后离开
    let coin2 = null, c2x = 0, c2y = 0;
    for (let i = 0; i < 40; i++) {
      await wait(150);
      const st = B.last;
      if (st && st.coins.length) { coin2 = st.coins[0]; c2x = coin2[0]; c2y = coin2[1]; break; }
    }
    if (coin2) {
      const base2 = findMe(B) ? findMe(B).sc : 0;
      tp(B, c2x - 6, c2y - 6);
      let started = false;
      for (let i = 0; i < 12; i++) {
        await wait(120);
        const me = findMe(B);
        if (me && me.lp >= 0) { started = true; break; }
      }
      tp(B, c2x + 140, c2y + 140); // 离开
      await wait(500);
      const me3 = findMe(B);
      const stillThere = B.last.coins.some((c) => c[0] === c2x && c[1] === c2y);
      const notScored = findMe(B) ? findMe(B).sc === base2 : false;
      ok(started && me3.lp < 0 && stillThere && notScored, "离开后读条中断且金币保留未计分");
    } else {
      ok(false, "无新金币可测打断");
    }
  }
  A.ws.close(); B.ws.close();
  console.log(fail === 0 ? "\n✅ 平衡性验证全部通过" : "\n❌ 有 " + fail + " 项失败");
  process.exit(fail === 0 ? 0 : 1);
})();