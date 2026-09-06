/* ============ 入口与主循环 ============ */
(function () {
  var started = false;
  function onOpen() {
    document.getElementById("conn").classList.remove("show");
    // 重连后自动回到原阵营
    if (Game.side >= 0) {
      var nick = localStorage.getItem("pvt_nick") || "";
      Net.send({ t: "join", f: Game.side, n: nick });
    }
  }
  function handle(m) {
    if (m.t === "hi") {
      Game.cfg = m.cfg || {};
    } else if (m.t === "ok") {
      Game.myId = m.id;
      Game.side = m.side;
      UI.setJoined(true);
    } else if (m.t === "err") {
      SFX.deny();
      UI.toast(m.msg, "red");
    } else if (m.t === "st") {
      Game.accept(m);
    }
  }
  function loop(now) {
    requestAnimationFrame(loop);
    var st = Game.state;
    if (st) {
      Render.frame(now);
      UI.update(st);
      // 自身重生提示
      var me = Game.myEnt();
      if (me) {
        var res = me.res > 0 ? 1 : 0;
        if (!res && Game.live.prevRes === 1) { UI.toast("重生完成!", ""); SFX.respawn(); }
        Game.live.prevRes = res;
      } else if (Game.live.barPrev) {
        Game.live.barPrev = null; // 离场时取消预览
      }
      if (Game.live.barPrev && (!me || me.res > 0 || me.c > 0)) Game.live.barPrev = null;
    }
  }
  window.addEventListener("DOMContentLoaded", function () {
    if (started) return; started = true;
    UI.init();
    Render.init(document.getElementById("game"));
    Input.init(document.getElementById("game"));
    Net.onMsg = handle;
    Net.onOpen = onOpen;
    Net.onClose = function () { document.getElementById("conn").classList.add("show"); };
    Net.start();
    requestAnimationFrame(loop);
  });
})();
