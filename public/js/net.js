/* ============ WebSocket 连接管理(自动重连) ============ */
window.Net = (function () {
  var ws = null, retry = null, tries = 0;
  var onMsg = null, onOpen = null, onClose = null;
  var url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;

  function connect() {
    try { ws = new WebSocket(url); } catch (e) { schedule(); return; }
    ws.onopen = function () {
      tries = 0;
      if (onOpen) onOpen();
    };
    ws.onmessage = function (e) {
      var m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (onMsg) onMsg(m);
    };
    ws.onclose = function () {
      if (onClose) onClose();
      schedule();
    };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }
  function schedule() {
    clearTimeout(retry);
    tries++;
    retry = setTimeout(connect, Math.min(2000 * tries, 6000));
  }
  function send(o) {
    if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(o)); } catch (e) {} }
  }
  return {
    start: connect,
    send: send,
    set onMsg(f) { onMsg = f; },
    set onOpen(f) { onOpen = f; },
    set onClose(f) { onClose = f; },
    get connected() { return ws && ws.readyState === 1; }
  };
})();
