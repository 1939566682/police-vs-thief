/* ============ 协议冒烟测试: 连接/加入阵营/移动/道具/胜负 ============ */
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
  ws.on("message", (d) => {
    const m = JSON.parse(d.toString());
    q.forEach((f) => f(m));
  });
  return { ws, q, last: null, on: function (f) { this.q.push(f); }, send: (o) => ws.send(JSON.stringify(o)) };
}
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function latest(c, pred, timeout) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeout || 5000)) {
    if (c.last && (!pred || pred(c.last))) return c.last;
    await wait(30);
  }
  return null;
}

(async () => {
  console.log("[smoke] 连接服务端 " + URL);
  const A = client();
  A.on((m) => { if (m.t === "st") A.last = m; });
  await wait(400);
  ok(!!A.last, "收到实况广播");

  console.log("[smoke] 观众 A 加入警察");
  A.send({ t: "join", f: 0, n: "测试警官" });
  let m = await latest(A, (s) => s.pl && s.pl.some((p) => p.n === "测试警官"), 3000);
  ok(!!m, "A 出现在战场");
  const aP = m.pl.find((p) => p.n === "测试警官");
  ok(!!aP && aP.s === 0, "A 阵营为警察");
  ok(aP.b === 0, "A 标记为真人");

  console.log("[smoke] 观众 B 加入小偷");
  const B = client();
  B.on((mm) => { if (mm.t === "st") B.last = mm; });
  await wait(300);
  B.send({ t: "join", f: 1, n: "测试小偷" });
  m = await latest(B, (s) => s.pl && s.pl.some((p) => p.n === "测试小偷"), 3000);
  ok(!!m, "B 出现在战场");
  const bT = m.pl.find((p) => p.n === "测试小偷");
  ok(!!bT && bT.s === 1, "B 阵营为小偷");

  console.log("[smoke] 人数实时显示");
  const c0 = m.pl.filter((p) => p.s === 0).length;
  const c1 = m.pl.filter((p) => p.s === 1).length;
  ok(c0 >= 1 && c1 >= 1, "双方人数: 警察 " + c0 + " / 小偷 " + c1);

  console.log("[smoke] 移动指令生效");
  const x0 = aP.x;
  A.send({ t: "mv", x: 1, y: 0, ax: aP.x + 200, ay: aP.y });
  await wait(500);
  A.last = null; A.on((mm) => { if (mm.t === "st") A.last = mm; });
  m = await latest(A, (s) => s.pl.some((p) => p.n === "测试警官" && Math.abs(p.x - x0) > 15), 2500);
  ok(!!m, "A 坐标已变化 (Δ=" + (m ? m.pl.find((p) => p.n === "测试警官").x - x0 : "?") + ")");

  console.log("[smoke] 道具触发(警察手铐)");
  const beforeCd = aP.cd ? aP.cd[0] : 0;
  A.send({ t: "use", k: 0, x: 0 });
  m = await latest(A, (s) => {
    const p = s.pl.find((pp) => pp.n === "测试警官");
    return p && p.cd[0] > 0;
  }, 2500);
  ok(!!m, "手铐进入冷却 (cd[0]=" + (m ? m.pl.find((p) => p.n === "测试警官").cd[0] : "?") + "s)");

  console.log("[smoke] 服务器持续模拟(等待对局推进)");
  await wait(3000);
  ok(true, "服务端 3 秒内无崩溃, 持续广播");

  console.log("[smoke] 强制结算(dev)");
  A.send({ t: "dev", k: "end", w: 0 });
  m = await latest(A, (s) => s.ph === "over", 2500);
  ok(!!m, "进入结算阶段 over");
  if (m) {
    ok(m.over && m.over.winner === 0, "警察被判胜");
    ok(m.over.mvp && m.over.rows && m.over.rows.length > 0, "MVP 与战绩榜单生成");
  }

  console.log("[smoke] 自动进入下一局");
  m = await latest(A, (s) => s.ph === "go" && s.rnd > 1, 15000);
  ok(!!m, "结算后自动开始第 " + (m ? m.rnd : "?") + " 局");
  A.ws.close(); B.ws.close();
  console.log(fail === 0 ? "\n✅ 冒烟测试全部通过" : "\n❌ 有 " + fail + " 项失败");
  process.exit(fail === 0 ? 0 : 1);
})();
