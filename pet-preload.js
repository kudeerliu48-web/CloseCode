"use strict";
/** 桌面宠物窗口的预加载脚本：仅开放桌宠专用单向通道，页面拿不到 node 能力。 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("wbPet", {
  isLinux: process.platform === "linux",
  voiceEntrance: () => ipcRenderer.send("pet:voice-entrance"),
  onState: (cb) => ipcRenderer.on("pet:state", (_e, s) => { try { cb(s); } catch {} }),
  onPointer: (cb) => {
    const listener = (_e, point) => { try { cb(point); } catch {} };
    ipcRenderer.on("pet:pointer", listener);
    return () => ipcRenderer.removeListener("pet:pointer", listener);
  },
  dragStart: () => ipcRenderer.send("pet:drag-start"),
  dragEnd: (cancelled) => ipcRenderer.send("pet:drag-end", !!cancelled),
  showMain: () => ipcRenderer.send("pet:show-main"),
  onClick: (cb) => ipcRenderer.on("pet:click", (_e, id) => {
    let woke = false;
    try { woke = cb() === true; } catch {}
    ipcRenderer.send("pet:click-result", id, woke);
  }),
  menu: () => ipcRenderer.send("pet:menu"),
  // 光标压没压在宠物实体上：主进程据此开关点击穿透，别让透明方框挡住底下的应用
  hit: (on) => ipcRenderer.send("pet:hit", !!on),
});
