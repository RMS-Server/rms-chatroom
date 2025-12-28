const { app, BrowserWindow, session, ipcMain, globalShortcut, shell } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs'); // ✅ 新增：读 html 文件
const Store = require('electron-store').default;

// =====================
// Store（原有不变 + 新增 toggleMic 默认快捷键）
// =====================
const store = new Store({
  defaults: {
    shortcuts: {
      toggleWindow: 'CommandOrControl+Alt+K',
      toggleMic: 'CommandOrControl+Alt+M', // ✅ 新增：开关麦克风
    },
  },
});

let mainWin = null;
let currentToggleShortcut = null;
let currentMicShortcut = null; // ✅ 新增：记录麦克风快捷键

// =====================
// SSO 回调服务器（✅ 改：返回 html 文件）
// =====================
let callbackServer = null;
let callbackUrl = null;

// ✅ 新增：统一把同目录 html 文件读出来返回
function sendHtmlFile(res, filename, statusCode = 200) {
  const filePath = path.join(__dirname, filename);

  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) {
      // 兜底：如果 html 文件不存在/读失败，至少别让接口挂着
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(`Cannot read file: ${filename}`);
    }

    res.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
}

function startCallbackServer(win) {
  return new Promise((resolve) => {
    if (callbackServer && callbackUrl) return resolve(callbackUrl);

    callbackServer = http.createServer((req, res) => {
      try {
        const u = new URL(req.url, 'http://127.0.0.1');

        if (u.pathname === '/callback') {
          const token = u.searchParams.get('token');
          const code = u.searchParams.get('code');
          const state = u.searchParams.get('state');

          console.log('[sso callback] got:', { token: !!token, code: !!code, state: !!state, raw: req.url });

          if (win && !win.isDestroyed()) {
            win.webContents.send('auth:callback', {
              token: token || null,
              code: code || null,
              state: state || null,
              raw: req.url,
            });
          }

          // ✅ 成功回调：返回 loginSuccess.html（同目录）
          sendHtmlFile(res, './statusWebpage/loginSuccess.html', 200);
          return;
        }

        // ✅ 其它路径：返回 404.html（同目录）
        sendHtmlFile(res, './statusWebpage/404.html', 404);
      } catch (e) {
        console.log('[sso callback] server error:', e);

        // ✅ 服务内部出错：返回 serverError.html（同目录，文件名带空格没问题）
        sendHtmlFile(res, './statusWebpage/serverError.html', 500);
      }
    });

    callbackServer.listen(0, '127.0.0.1', () => {
      const { port } = callbackServer.address();
      callbackUrl = `http://127.0.0.1:${port}/callback`;
      console.log('[sso callback] listening at:', callbackUrl);
      resolve(callbackUrl);
    });

    callbackServer.on('error', (err) => {
      console.log('[sso callback] listen error:', err);
      callbackUrl = null;
      resolve(null);
    });
  });
}

// =====================
// 创建窗口（保持不变）
// =====================
function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log('[renderer]', message, 'at', `${sourceId}:${line}`);
  });

  win.webContents.on('did-fail-load', (event, code, desc, url) => {
    console.log('[did-fail-load]', { code, desc, url });
  });

  win.webContents.on('render-process-gone', (event, details) => {
    console.log('[render-process-gone]', details);
  });

  const distDir = path.join(__dirname, 'frontend', 'dist');
  const indexHtml = path.join(distDir, 'index.html');

  console.log('[electron] distDir =', distDir);
  console.log('[electron] indexHtml =', indexHtml);

  win.loadFile(indexHtml);
  win.webContents.openDevTools();

  return win;
}

// =====================
// 原有：窗口显示/隐藏快捷键（保持不变）
// =====================
function toggleMainWindow() {
  if (!mainWin) return;
  if (mainWin.isVisible()) mainWin.hide();
  else { mainWin.show(); mainWin.focus(); }
}

function registerToggleShortcut(accelerator) {
  if (currentToggleShortcut) {
    globalShortcut.unregister(currentToggleShortcut);
    currentToggleShortcut = null;
  }

  if (!accelerator) return { ok: false, error: '快捷键为空' };

  const ok = globalShortcut.register(accelerator, toggleMainWindow);
  if (!ok) {
    return { ok: false, error: '注册失败：可能被系统/其他软件占用，换个组合键' };
  }

  currentToggleShortcut = accelerator;
  return { ok: true };
}

// =====================
// ✅ 新增：麦克风开关快捷键（全局）
// 触发时只发事件给渲染进程，真正“静音/开麦”由 Vue 控制
// =====================
function toggleMic() {
  if (!mainWin || mainWin.isDestroyed()) return;
  mainWin.webContents.send('mic:toggle');
}

function registerMicShortcut(accelerator) {
  if (currentMicShortcut) {
    globalShortcut.unregister(currentMicShortcut);
    currentMicShortcut = null;
  }

  if (!accelerator) return { ok: false, error: '快捷键为空' };

  const ok = globalShortcut.register(accelerator, toggleMic);
  if (!ok) {
    return { ok: false, error: '注册失败：可能被系统/其他软件占用，换个组合键' };
  }

  currentMicShortcut = accelerator;
  return { ok: true };
}

// =====================
// IPC（原有 shortcuts:get / shortcuts:set 不改名，只扩展 toggleMic）
// =====================
function setupIpc() {
  // ---- 原有：读快捷键
  ipcMain.handle('shortcuts:get', () => store.get('shortcuts'));

  // ---- 原有：写快捷键（扩展支持 toggleMic）
  ipcMain.handle('shortcuts:set', (event, key, accelerator) => {
    store.set(`shortcuts.${key}`, accelerator);

    if (key === 'toggleWindow') return registerToggleShortcut(accelerator);
    if (key === 'toggleMic') return registerMicShortcut(accelerator); // ✅ 新增

    return { ok: true };
  });

  // ---- SSO：给渲染进程拿回调地址
  ipcMain.handle('auth:getCallbackUrl', async () => {
    if (!callbackUrl && mainWin) {
      await startCallbackServer(mainWin);
    }
    return callbackUrl;
  });

  // ---- SSO：打开系统默认浏览器
  ipcMain.handle('auth:openExternal', async (event, url) => {
    try {
      await shell.openExternal(url);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });
}

// =====================
// App 生命周期（保持你原 CSP + 原逻辑）
// =====================
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "script-src 'self'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data: https:; " +
          "connect-src 'self' https://preview-chatroom.rms.net.cn wss://preview-chatroom.rms.net.cn",
        ],
      },
    });
  });

  setupIpc();

  mainWin = createWindow();

  await startCallbackServer(mainWin);

  // 启动时注册：窗口快捷键
  const winAcc = store.get('shortcuts.toggleWindow');
  registerToggleShortcut(winAcc);

  // ✅ 启动时注册：麦克风快捷键
  const micAcc = store.get('shortcuts.toggleMic');
  registerMicShortcut(micAcc);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();

  try {
    if (callbackServer) callbackServer.close();
  } catch (_) {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWin = createWindow();
  }
});
