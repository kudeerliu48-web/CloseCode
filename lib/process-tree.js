"use strict";
const { execFile, spawnSync } = require("child_process");
const validPid = pid => Number.isSafeInteger(pid) && pid > 0;
function isAlive(pid) {
  if (!validPid(pid)) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
}
function killUnixTree(pid) {
  // 本应用启动的 shell 都有独立进程组；连同其持有输出管道的子进程一起停止。
  try { process.kill(-pid, "SIGKILL"); return true; }
  catch { try { process.kill(pid, "SIGKILL"); return true; } catch (e) { return e.code === "ESRCH"; } }
}
function killTree(pid) {
  if (!validPid(pid)) return Promise.resolve(false);
  if (process.platform !== "win32") return Promise.resolve(killUnixTree(pid));
  return new Promise(resolve => {
    let settled = false, killer;
    const finish = ok => {
      if (settled) return;
      settled = true; clearTimeout(watchdog);
      // 即使 taskkill 不可用，也尽量停止主进程；不谎称子树已全部停止。
      if (!ok) { try { process.kill(pid, "SIGKILL"); } catch {} }
      resolve(ok);
    };
    // execFile's timeout still waits for close; inherited handles can prevent it.
    const watchdog = setTimeout(() => {
      finish(false);
      try { killer?.kill(); } catch {}
      killer?.stdout?.destroy(); killer?.stderr?.destroy(); killer?.unref();
    }, 5500);
    try {
      killer = execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 5000 }, error => finish(!error));
    } catch { finish(false); }
  });
}
function killTreeSync(pid) {
  if (!validPid(pid)) return false;
  if (process.platform !== "win32") return killUnixTree(pid);
  const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 5000, stdio: "ignore" });
  return !result.error && result.status === 0;
}
module.exports = { isAlive, killTree, killTreeSync };
