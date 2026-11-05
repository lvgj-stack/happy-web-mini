// The only things the page may ask of the app. No Node, no IPC beyond these.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('happyDesktop', {
    platform: process.platform,
    setBadge: (count) => ipcRenderer.send('desktop:badge', count),
    attention: () => ipcRenderer.send('desktop:attention'),
    notify: (note) => ipcRenderer.send('desktop:notify', note),
    onCommand: (fn) => ipcRenderer.on('desktop:command', (_e, name) => fn(name)),
    onOpenSession: (fn) => ipcRenderer.on('desktop:open-session', (_e, id) => fn(id)),
});
