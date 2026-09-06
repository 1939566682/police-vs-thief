/* ============ 输入: 键盘 / 鼠标 / 触屏虚拟摇杆 ============ */
window.Input = (function () {
  var keys = {};
  var aim = { x: 0, y: 0, has: false };
  var joy = { active: false, id: -1, ax: 0, ay: 0, dx: 0, dy: 0, el: null, knob: null };
  var cv = null, raf = null;
  var coarse = window.matchMedia && window.matchMedia("(pointer:coarse)").matches;
  var lastSent = 0;

  function init(canvas) {
    cv = canvas;
    joy.el = document.getElementById("stick");
    joy.knob = document.getElementById("stickKnob");
    window.addEventListener("keydown", function (e) {
      if (e.repeat) return;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].indexOf(e.key) >= 0) e.preventDefault();
      keys[e.code] = true;
      if (e.code === "Digit1") useItem(0);
      else if (e.code === "Digit2") useItem(1);
      else if (e.code === "Digit3") toggleBar();
      else if (e.code === "Escape") cancelBar();
    });
    window.addEventListener("keyup", function (e) { keys[e.code] = false; });
    window.addEventListener("blur", function () { keys = {}; joy.active = false; updateStick(); });

    cv.addEventListener("pointermove", function (e) {
      var p = Render.worldFromScreen(e.clientX, e.clientY);
      aim.x = p.x; aim.y = p.y; aim.has = true;
      if (joy.active && e.pointerId === joy.id) moveJoy(e);
    });
    cv.addEventListener("pointerdown", function (e) {
      Sound.unlock();
      // 路障预览: 左键确认放置, 右键取消
      if (Game.live.barPrev) {
        if (e.button === 2) cancelBar();
        else confirmBar();
        return;
      }
      if (coarse && e.clientX < window.innerWidth * 0.5 && e.clientY > window.innerHeight * 0.42 && e.pointerType === "touch") {
        joy.active = true; joy.id = e.pointerId; joy.ax = e.clientX; joy.ay = e.clientY; joy.dx = 0; joy.dy = 0;
        joy.el.classList.add("active");
        cv.setPointerCapture(e.pointerId);
        moveJoy(e);
      }
    });
    window.addEventListener("contextmenu", function (e) {
      if (Game.live.barPrev) { e.preventDefault(); cancelBar(); }
    });
    window.addEventListener("pointerup", function (e) {
      if (joy.active && e.pointerId === joy.id) { joy.active = false; joy.dx = 0; joy.dy = 0; updateStick(); }
    });
    window.addEventListener("pointercancel", function () {
      joy.active = false; joy.dx = 0; joy.dy = 0; updateStick();
    });
    // 网络节流: 30Hz
    setInterval(sendInput, 33);
  }

  function moveJoy(e) {
    var dx = e.clientX - joy.ax, dy = e.clientY - joy.ay;
    var d = Math.hypot(dx, dy);
    var max = 46;
    if (d > max) { dx = dx / d * max; dy = dy / d * max; }
    joy.dx = dx / max; joy.dy = dy / max;
    updateStick();
  }
  function updateStick() {
    var el = joy.el;
    if (!joy.active) { el.classList.remove("active"); joy.knob.style.transform = "translate(-50%,-50%)"; return; }
    var dx = joy.dx * 26, dy = joy.dy * 26;
    joy.knob.style.transform = "translate(calc(-50% + " + dx + "px), calc(-50% + " + dy + "px))";
  }

  function dirVector() {
    var x = 0, y = 0;
    if (keys["KeyW"] || keys["ArrowUp"]) y -= 1;
    if (keys["KeyS"] || keys["ArrowDown"]) y += 1;
    if (keys["KeyA"] || keys["ArrowLeft"]) x -= 1;
    if (keys["KeyD"] || keys["ArrowRight"]) x += 1;
    if (joy.active) { x += joy.dx; y += joy.dy; }
    var d = Math.hypot(x, y);
    if (d > 1) { x /= d; y /= d; }
    return [x, y];
  }
  function sendInput() {
    var now = performance.now();
    if (now - lastSent < 30) return;
    lastSent = now;
    var v = dirVector();
    Net.send({
      t: "mv", x: +v[0].toFixed(3), y: +v[1].toFixed(3),
      ax: +aim.x.toFixed(1), ay: +aim.y.toFixed(1)
    });
  }
  function useItem(k, xch) {
    SFX.click();
    Net.send({ t: "use", k: k, x: xch ? 1 : 0 });
  }
  /* ---- 路障预览模式: 1次触发进入预览, 2次触发/左键确认放置, 右键/Esc取消 ---- */
  function toggleBar() {
    var st = Game.state;
    if (!st || Game.myId == null) return;
    if (Game.live.barPrev) { confirmBar(); return; }
    var me = Game.myEnt();
    if (!me || me.res > 0 || me.c > 0) return;
    if (st.ph !== "go" || st.gt > 0) return;
    if (me.cd[2] > 0.01) return; // 冷却中由道具按钮走积分兑换
    Game.live.barPrev = { x: 0, y: 0, ok: true };
    SFX.click();
  }
  function confirmBar() {
    if (!Game.live.barPrev) return;
    Game.live.barPrev = null;
    var st = Game.state;
    var me = Game.myEnt();
    if (!st || st.ph !== "go" || st.gt > 0 || !me || me.res > 0 || me.c > 0 || me.cd[2] > 0.01) return;
    Net.send({ t: "use", k: 2, x: 0 });
    // 放置成功 → 服务端 fx bar; 失败 → fx deny + toast, 冷却不扣(服务端回滚)
  }
  function cancelBar() {
    if (Game.live.barPrev) { Game.live.barPrev = null; SFX.click(); }
  }
  return { init: init, useItem: useItem, toggleBar: toggleBar, cancelBar: cancelBar, get aim() { return aim; } };
})();
