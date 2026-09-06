/* ============ UI: 计分板 / 道具栏 / 播报 / 结算 / 加入 ============ */
window.UI = (function () {
  var el = {};
  var nick = "";
  var joined = false;
  var feedKey = "";
  var resDismiss = false;
  var toastT = null;
  var OVER_SEC = 12.5;

  var ITEMS = [
    [{ n: "手铐", e: "⛓️", cd: 9, cost: 3 }, { n: "警犬", e: "🐕", cd: 16, cost: 5 }, { n: "路障", e: "🚧", cd: 15, cost: 4 }],
    [{ n: "烟雾弹", e: "💨", cd: 11, cost: 3 }, { n: "疾跑", e: "⚡", cd: 12, cost: 2 }, { n: "伪装", e: "🎭", cd: 17, cost: 5 }]
  ];
  var NICK_POOL = ["可乐加冰", "深夜不睡", "柠檬精", "阿伟", "老王", "爆米花", "路人甲", "键盘侠", "热心市民", "夜行者", "小钢炮", "吃瓜群众"];

  function $(id) { return document.getElementById(id); }
  function init() {
    ["cntP", "barP", "scP", "cntT", "barT", "scT", "roundL", "roundT", "roundPh",
      "feed", "items", "toast", "res", "joinbox", "floatjoin", "leaveBtn", "conn",
      "nick", "jbP", "jbT"].forEach(function (id) { el[id] = $(id); });
    // 昵称
    nick = localStorage.getItem("pvt_nick");
    if (!nick) nick = NICK_POOL[(Math.random() * NICK_POOL.length) | 0];
    el.nick.value = nick;
    el.nick.addEventListener("change", function () {
      nick = el.nick.value.trim() || nick;
      localStorage.setItem("pvt_nick", nick);
    });
    // 加入按钮
    document.querySelectorAll("[data-f]").forEach(function (b) {
      b.addEventListener("click", function () { join(+b.getAttribute("data-f")); });
    });
    el.leaveBtn.addEventListener("click", function () {
      Net.send({ t: "leave" });
      joined = false;
      Game.myId = null; Game.side = -1; Game.live.prevRes = 0;
      el.joinbox.classList.add("hide");
      el.floatjoin.classList.remove("hide");
      el.leaveBtn.classList.remove("show");
      toast("已退出阵营, 继续观战", "");
    });
    // 道具槽
    var itemsHtml = "";
    for (var i = 0; i < 3; i++) itemsHtml +=
      '<div class="item" data-k="' + i + '"><div class="key">' + (i + 1) + '</div>' +
      '<div class="ic"></div><div class="nm"></div><div class="xc"></div><div class="cd"></div></div>';
    el.items.innerHTML = itemsHtml;
    document.querySelectorAll(".items .item").forEach(function (it) {
      it.addEventListener("click", function () { onItem(+it.getAttribute("data-k")); });
    });
  }

  function join(f) {
    nick = el.nick.value.trim() || nick;
    localStorage.setItem("pvt_nick", nick);
    Sound.unlock();
    SFX.click();
    Net.send({ t: "join", f: f, n: nick });
  }

  function onItem(k) {
    var G = Game.state;
    if (!G || Game.myId == null) return;
    var my = Game.myEnt();
    if (!my) return;
    var spec = ITEMS[Game.side][k];
    if (k === 2 && Game.side === 0 && my.cd[k] <= 0.01) {
      // 路障走预览模式: 首次点击进入预览, 再次点击确认放置
      Input.toggleBar();
      return;
    }
    if (my.cd[k] <= 0.01) { Input.useItem(k, false); }
    else if (G.sc[Game.side] >= spec.cost) { Input.useItem(k, true); }
    else { SFX.deny(); toast("积分不足(" + spec.cost + "), 无法兑换", "red"); }
  }

  function toast(txt, cls) {
    el.toast.innerHTML = '<div class="tt ' + (cls || "") + '">' + txt + "</div>";
    el.toast.classList.add("show");
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.toast.classList.remove("show"); }, 1700);
  }

  function setJoined(v) {
    joined = v;
    el.joinbox.classList.toggle("hide", v);
    el.floatjoin.classList.toggle("hide", v);
    el.leaveBtn.classList.toggle("show", v);
    if (v) { toast("已加入战斗!", ""); SFX.join(); }
  }

  function update(st) {
    if (!st) return;
    var hum = [0, 0], tot = [0, 0];
    for (var i = 0; i < st.pl.length; i++) {
      var p = st.pl[i];
      tot[p.s]++; if (!p.b) hum[p.s]++;
    }
    el.cntP.textContent = tot[0] + (hum[0] ? " ·" + hum[0] : "");
    el.cntT.textContent = (hum[1] ? hum[1] + "· " : "") + tot[1];
    el.barP.style.width = Math.min(100, st.sc[0] / st.tgt[0] * 100) + "%";
    el.barT.style.width = Math.min(100, st.sc[1] / st.tgt[1] * 100) + "%";
    el.scP.textContent = st.sc[0] + " / " + st.tgt[0];
    el.scT.textContent = st.sc[1] + " / " + st.tgt[1];
    el.roundL.textContent = "第 " + st.rnd + " 局";
    var m = Math.floor(st.tm / 60), s = Math.floor(st.tm % 60);
    el.roundT.textContent = (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
    if (st.ph === "over") { el.roundPh.textContent = "结算中"; el.roundPh.classList.remove("low"); }
    else if (st.gt > 0) { el.roundPh.textContent = "准备…"; el.roundPh.classList.remove("low"); }
    else { el.roundPh.textContent = "对局中"; el.roundPh.classList.add("low"); }
    el.jbP.textContent = tot[0] + " 人"; el.jbT.textContent = tot[1] + " 人";
    // 播报
    var fk = st.feed.join("|");
    if (fk !== feedKey) {
      feedKey = fk;
      var html = "";
      for (var f = 0; f < st.feed.length; f++) {
        var line = st.feed[f];
        html += '<div class="f' + (line.indexOf("💰") === 0 ? " t" : "") + '">' + esc(line) + "</div>";
      }
      el.feed.innerHTML = html;
    }
    updateItems(st);
    updateRes(st);
  }

  function updateItems(st) {
    if (Game.myId == null || Game.side < 0) { el.items.style.visibility = "hidden"; return; }
    el.items.style.visibility = "visible";
    var my = Game.myEnt();
    var spec = ITEMS[Game.side];
    var G = Game.state;
    document.querySelectorAll(".items .item").forEach(function (it, k) {
      var s = spec[k];
      it.querySelector(".ic").textContent = s.e;
      it.querySelector(".nm").textContent = s.n;
      var cdEl = it.querySelector(".cd");
      var xcEl = it.querySelector(".xc");
      if (!my) { it.classList.add("no"); cdEl.style.display = "none"; xcEl.style.display = "none"; return; }
      var rem = my.cd[k];
      var ready = rem <= 0.01;
      var afford = !ready && G && G.sc[Game.side] >= s.cost;
      it.classList.toggle("ready", ready);
      it.classList.toggle("afford", afford && !ready);
      it.classList.toggle("no", !ready && !afford);
      it.classList.toggle("arming", k === 2 && Game.side === 0 && !!Game.live.barPrev);
      if (ready) {
        cdEl.style.display = "none";
        xcEl.style.display = "none";
      } else {
        cdEl.style.display = "flex";
        cdEl.style.height = Math.min(100, rem / s.cd * 100) + "%";
        cdEl.textContent = Math.ceil(rem);
        xcEl.style.display = afford ? "block" : "none";
        xcEl.textContent = "⚡" + s.cost;
      }
    });
  }

  function updateRes(st) {
    var show = st.over && !resDismiss;
    el.res.classList.toggle("show", !!show);
    if (!st.over) { resDismiss = false; return; }
    if (!el.res.getAttribute("data-built") || el.res.getAttribute("data-rnd") != st.rnd) {
      buildRes(st);
      el.res.setAttribute("data-rnd", st.rnd);
    }
    var bar = el.res.querySelector(".res-next i");
    if (bar) bar.style.width = Math.max(0, st.gt / OVER_SEC) * 100 + "%";
  }

  function buildRes(st) {
    var o = st.over;
    var wname = o.winner === -1 ? "平局" : (o.winner === 0 ? "警察阵营获胜" : "小偷阵营获胜");
    var cls = o.winner === 0 ? "blue" : o.winner === 1 ? "" : "gray";
    var emoji = o.winner === 0 ? "🚔" : o.winner === 1 ? "🦹" : "🤝";
    var reason = { sweep: "警方全歼! 所有小偷被缉拿", target: "率先达成目标分", time: "时间到, 积分领先", draw: "时间到, 双方积分相同", dev: "测试结束" }[o.reason] || "";
    var mvp = o.mvp ? (o.mvp.s === 0 ? "👮 " : "🦹 ") + esc(o.mvp.n) + " · " + o.mvp.sc + " 分" : "—";
    var rows = "";
    var meN = "";
    var me = Game.myEnt(); if (me) meN = me.n;
    for (var i = 0; i < o.rows.length; i++) {
      var r = o.rows[i];
      rows += '<tr class="' + (r.n === meN ? "me" : "") + '"><td class="' + (r.s === 0 ? "p" : "t") + '">' +
        (r.s === 0 ? "👮" : "🦹") + " " + esc(r.n) + (r.b ? '<span class="rb"> AI</span>' : "") + "</td>" +
        '<td class="rb">缉拿 ' + r.c + "</td>" +
        '<td class="rb">盗窃 ' + r.l + "</td>" +
        "<td><b>" + r.sc + "</b></td></tr>";
    }
    el.res.innerHTML =
      '<div class="res-card">' +
      '<div class="res-title">对局结果 · 第 ' + st.rnd + ' 局</div>' +
      '<div class="res-big ' + cls + '">' + emoji + " " + wname + "</div>" +
      '<div class="res-reason">' + reason + " · 积分 " + st.sc[0] + " : " + st.sc[1] + "</div>" +
      '<div class="res-mvp">🏅 MVP ' + mvp + "</div>" +
      '<table class="res-rows"><tr><th>玩家</th><th>缉拿</th><th>盗窃</th><th>积分</th></tr>' + rows + "</table>" +
      '<div class="res-next"><i></i></div>' +
      '<div class="res-btns">' +
      '<button class="rtb" data-f="1">🦹 加入小偷</button>' +
      '<button class="rpb" data-f="0">👮 加入警察</button>' +
      '<button class="rwb" id="resWatch">继续观战</button>' +
      "</div></div>";
    el.res.querySelectorAll("[data-f]").forEach(function (b) {
      b.addEventListener("click", function () { resDismiss = true; join(+b.getAttribute("data-f")); });
    });
    el.res.querySelector("#resWatch").addEventListener("click", function () { resDismiss = true; });
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  return { init: init, update: update, toast: toast, setJoined: setJoined };
})();
