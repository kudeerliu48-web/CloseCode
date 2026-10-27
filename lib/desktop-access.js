"use strict";
const { randomBytes, timingSafeEqual } = require("crypto");
const HEADER = "x-closecode-desktop-access";
let state = null;

function initialize(app, port, env = process.env) {
  if (state) throw new Error("Desktop access already initialized");
  if (!app.isPackaged && env.CLOSECODE_DESKTOP_ACCESS_TEST !== "1") return false;
  port = Number(port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid desktop port");
  state = { port, origin: `http://127.0.0.1:${port}`, secret: randomBytes(32).toString("hex"), authorizationUser: 'desktop_' + randomBytes(16).toString('hex') };
  return true;
}
function enabled() { return !!state; }
function port() { return state?.port; }
function headers() { return state ? { [HEADER]: state.secret } : {}; }
function sameOrigin(url) {
  try { const u = new URL(url); return !!state && u.origin === state.origin && !u.username && !u.password; } catch { return false; }
}
function trustedDocument(url) {
  if (!sameOrigin(url)) return false;
  const u = new URL(url);
  return ["/", "/loading.html", "/index.html"].includes(u.pathname);
}
function authorized(req) {
  if (!state) return true;
  const host = `127.0.0.1:${req.socket.localPort}`;
  const raw = req.rawHeaders || [];
  for (const name of ["host", HEADER]) {
    if (raw.filter((v, i) => i % 2 === 0 && v.toLowerCase() === name).length !== 1) return false;
  }
  const value = req.headers[HEADER];
  return req.socket.localPort === state.port && req.headers.host === host &&
    typeof value === "string" && /^[a-f0-9]{64}$/.test(value) &&
    timingSafeEqual(Buffer.from(value, "hex"), Buffer.from(state.secret, "hex"));
}
function middleware(req, res, next) {
  if (!authorized(req)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    return res.end("Forbidden");
  }
  // 此身份仅在桌面凭证通过后赋值，用于临时目录审批，不冒充业务登录用户。
  if (state) Object.defineProperty(req, 'desktopAccessUser', { value: state.authorizationUser });
  // Routes, error reporters and echo endpoints must never see the credential.
  delete req.headers[HEADER];
  if (req.rawHeaders) req.rawHeaders = req.rawHeaders.flatMap((v, i, a) => i % 2 === 0 && v.toLowerCase() !== HEADER ? [v, a[i + 1]] : []);
  if (state && req.url === "/__desktop_health") { res.writeHead(204); return res.end(); }
  next();
}
function guardUpgrades(server) {
  // No inbound WebSocket service currently exists. Fail closed for all upgrades;
  // a future handler must authenticate before taking ownership of the socket.
  if (state) server.on("upgrade", (req, socket) => {
    const status = authorized(req) ? "426 Upgrade Required" : "403 Forbidden";
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  });
}
function protectWindow(win, session, { openExternal } = {}) {
  if (!state) return;
  const wc = win.webContents;
  // Until the renderer uses an isolated preview origin + sandbox, forbid frame
  // embedding (including srcdoc/blob, which may not produce a network request).
  // Separate preview servers remain usable in the system browser.
  session.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    if (details.webContentsId === wc.id && details.resourceType === "mainFrame" && trustedDocument(details.url)) {
      const name = Object.keys(responseHeaders).find(k => k.toLowerCase() === "content-security-policy") || "Content-Security-Policy";
      const existing = responseHeaders[name] || [];
      responseHeaders[name] = [...(Array.isArray(existing) ? existing : [existing]), "frame-src blob:; object-src 'none'; base-uri 'self'"];
    }
    callback({ responseHeaders });
  });
  let firstNavigation = true;
  const isTop = frame => {
    try { return !!frame && frame.parent === null && frame.processId === wc.mainFrame.processId && frame.routingId === wc.mainFrame.routingId; } catch { return false; }
  };
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = { ...details.requestHeaders };
    for (const name of Object.keys(requestHeaders)) if (name.toLowerCase() === HEADER) delete requestHeaders[name];
    let allow = false;
    if (!wc.isDestroyed() && details.webContentsId === wc.id && sameOrigin(details.url)) {
      if (details.resourceType === "mainFrame") {
        // Chromium may not yet expose a WebFrameMain on the initial navigation.
        // Only the explicitly loaded entry document gets this one-time exception.
        allow = trustedDocument(details.url) && (
          // A provisional top frame can have a new routing ID before commit.
          (details.frame && details.frame.parent === null) ||
          (firstNavigation && !details.frame && ["", "about:blank"].includes(wc.getURL())));
      } else {
        allow = details.resourceType !== "subFrame" && isTop(details.frame) && trustedDocument(details.frame.url);
      }
    }
    if (allow) requestHeaders[HEADER] = state.secret;
    callback({ requestHeaders });
  });
  wc.on("did-finish-load", () => { firstNavigation = false; });
  wc.on("will-navigate", (event, url) => { if (!trustedDocument(url)) event.preventDefault(); });
  wc.on("will-redirect", (event, url, _inPlace, isMainFrame) => { if (isMainFrame && !trustedDocument(url)) event.preventDefault(); });
  wc.on("will-frame-navigate", (event, details) => {
    // Electron versions expose either event details or a second details object.
    const d = details && typeof details === "object" ? details : event;
    if (d.isMainFrame && !trustedDocument(d.url)) event.preventDefault();
    if (!d.isMainFrame && sameOrigin(d.url)) event.preventDefault();
  });
  wc.setWindowOpenHandler(({ url } = {}) => {
    // 仅可信主文档发起的标准网页链接可交给系统浏览器；应用端口绝不外开。
    try {
      const target = new URL(url);
      if (trustedDocument(wc.getURL()) && !sameOrigin(url) && ['http:', 'https:'].includes(target.protocol) && !target.username && !target.password && openExternal) {
        Promise.resolve(openExternal(target.href)).catch(() => {});
      }
    } catch {}
    return { action: "deny" };
  });
  wc.on("will-attach-webview", event => event.preventDefault());
}
module.exports = { initialize, enabled, port, headers, middleware, guardUpgrades, protectWindow };
