/* ============ 客户端状态/插值/事件 ============ */
window.Game = (function () {
  var live = {
    myId: null, side: -1, cfg: {},
    state: null, prev: null, tPrev: 0, tRecv: 0,
    floats: [], fx: [], lastEv: 0,
    prevRes: -1, shake: 0,
    barPrev: null // 路障预览: {x, y, ok} | null
  };

  function myEnt() {
    if (!live.state || live.myId == null) return null;
    for (var i = 0; i < live.state.pl.length; i++)
      if (live.state.pl[i].id === live.myId) return live.state.pl[i];
    return null;
  }
  function alpha() {
    var dt = live.tRecv - live.tPrev;
    if (!dt) return 1;
    var a = (performance.now() - live.tPrev) / dt;
    return a < 0 ? 0 : a > 1 ? 1 : a;
  }
  function accept(st) {
    live.prev = live.state;
    live.state = st;
    live.tPrev = live.tRecv;
    live.tRecv = performance.now();
    process(st);
  }
  function float(x, y, txt, col) {
    live.floats.push({ x: x, y: y, txt: txt, col: col || "#fff", t0: performance.now(), life: 1300 });
  }
  function fxP(type, x, y, side) {
    live.fx.push({ type: type, x: x, y: y, side: side, t0: performance.now(), life: 700 });
  }
  function process(st) {
    if (!st.ev) return;
    for (var i = 0; i < st.ev.length; i++) {
      var e = st.ev[i];
      if (e.id <= live.lastEv) continue;
      live.lastEv = e.id;
      var me = myEnt();
      switch (e.type) {
        case "arrest":
          SFX.arrest(); fxP("ring", e.x, e.y, 0);
          float(e.x, e.y - 26, "⛓ 抓获!", "#ff6b6b");
          if (me && live.side === 0 && e.n === me.n) UI.toast("你抓获了 " + e.t + "!", "red");
          if (me && live.side === 1 && e.t === me.n) UI.toast("你被逮捕了!", "red");
          break;
        case "loot":
          SFX.coin(); fxP("coin", e.x, e.y, 1);
          float(e.x, e.y - 24, "+1 💰", "#ffd76e");
          if (me && live.side === 1 && e.n === me.n) UI.toast("盗得金币 +1", "");
          break;
        case "cuff": SFX.whoosh(); fxP("cuff", e.x, e.y, 0); break;
        case "dog": SFX.bark(); fxP("dog", e.x, e.y, 0); break;
        case "bar": SFX.thunk(); fxP("bar", e.x, e.y, 0); break;
        case "smoke": SFX.poof(); fxP("smoke", e.x, e.y, 1); break;
        case "sprint": SFX.sprint(); fxP("sprint", e.x, e.y, 1); break;
        case "disg": SFX.poof(); fxP("disg", e.x, e.y, 1); break;
        case "snare": SFX.zap(); fxP("ring", e.x, e.y, 1); float(e.x, e.y - 24, "🔒 被禁锢!", "#7fb2ff"); break;
        case "deny":
          SFX.deny(); fxP("deny", e.x, e.y, e.side);
          if (me && e.n === me.n) {
            UI.toast(e.why === "point" ? "积分不足, 无法兑换" :
              e.why === "snare" ? "被铐住了, 道具无法使用!" :
              "此处无法放置路障, 已取消", "red");
          }
          break;
        case "bite": SFX.bite(); fxP("bite", e.x, e.y, 0); break;
        case "respawn": SFX.respawn(); fxP("ring", e.x, e.y, e.side); break;
        case "reveal": SFX.poof(); fxP("deny", e.x, e.y, 1); float(e.x, e.y - 24, "🕵️ 伪装识破!", "#ff9a5a"); break;
        case "join": SFX.join(); break;
        case "go": SFX.go(); UI.toast("对局开始!", ""); break;
        case "win": SFX.win(); break;
      }
    }
  }

  return {
    live: live,
    get state() { return live.state; },
    get myId() { return live.myId; }, set myId(v) { live.myId = v; },
    get side() { return live.side; }, set side(v) { live.side = v; },
    get cfg() { return live.cfg; },
    get fxList() { return live.fx; },
    get floatList() { return live.floats; },
    get shake() { return live.shake; }, set shake(v) { live.shake = v; },
    accept: accept,
    myEnt: myEnt,
    alpha: alpha,
    float: float,
    fxP: fxP
  };
})();
