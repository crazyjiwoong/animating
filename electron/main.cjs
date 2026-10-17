// AMG (애니만들기힘들어서직접만듬) 데스크톱 앱 — Electron 메인 프로세스
const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
const DEV_URL = process.env.FRAMEFLOW_DEV_URL;
const isMac = process.platform === 'darwin';

// 앱 전용 주소(app://) — 저장소(IndexedDB)·클립보드가 안정적으로 동작하도록 표준 스킴으로 등록
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

let win = null;
let dirty = false;
let forceClose = false;
let pendingOpen = null;

/* ---------------------------------------------------------------- .amg 파일로 실행 */

function fileFromArgs(argv) {
  return argv.slice(1).find((a) => /\.(amg|ffanim)$/i.test(a) && fs.existsSync(a)) || null;
}

function openFileInWindow(file) {
  if (!file) return;
  if (win && !win.webContents.isLoading()) win.webContents.send('app:open-file', readFileEntry(file));
  else pendingOpen = file;
}

function readFileEntry(file) {
  return { name: path.basename(file), path: file, data: fs.readFileSync(file) };
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    openFileInWindow(fileFromArgs(argv));
  });
  // macOS: Finder 에서 파일을 더블클릭
  app.on('open-file', (e, file) => {
    e.preventDefault();
    openFileInWindow(file);
  });
  pendingOpen = fileFromArgs(process.argv);
}

/* ---------------------------------------------------------------- 창 */

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'AMG',
    backgroundColor: '#0b0d12',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });

  // 저장하지 않은 변경이 있으면 닫기 전에 묻는다
  win.on('close', (e) => {
    if (forceClose || !dirty) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['저장하고 닫기', '저장하지 않고 닫기', '취소'],
      defaultId: 0,
      cancelId: 2,
      title: 'AMG',
      message: '저장하지 않은 변경 사항이 있어요.',
      detail: '닫기 전에 저장할까요?',
    });
    if (choice === 0) win.webContents.send('app:save-and-close');
    else if (choice === 1) {
      forceClose = true;
      win.close();
    }
  });
  win.on('closed', () => {
    win = null;
  });

  // 외부 링크는 기본 브라우저로
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // 개발용: Ctrl/Cmd+Shift+I 개발자 도구, F11 전체 화면
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    } else if (!app.isPackaged && (input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i') {
      win.webContents.toggleDevTools();
      e.preventDefault();
    }
  });

  win.webContents.on('did-finish-load', () => {
    if (pendingOpen) {
      const f = pendingOpen;
      pendingOpen = null;
      setTimeout(() => win && win.webContents.send('app:open-file', readFileEntry(f)), 300);
    }
  });

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadURL('app://amg/index.html');
}

function buildMenu() {
  if (!isMac) {
    // Windows/Linux 는 화면 안의 메뉴(파일·편집·프레임)를 쓴다
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'AMG',
        submenu: [{ role: 'about', label: 'AMG 정보' }, { type: 'separator' }, { role: 'hide', label: '가리기' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit', label: 'AMG 종료' }],
      },
      {
        label: '편집',
        submenu: [{ role: 'cut', label: '오려두기' }, { role: 'copy', label: '복사' }, { role: 'paste', label: '붙여넣기' }, { role: 'selectAll', label: '전체 선택' }],
      },
      { label: '보기', submenu: [{ role: 'togglefullscreen', label: '전체 화면' }] },
      { role: 'windowMenu', label: '윈도우' },
    ]),
  );
}

/* ---------------------------------------------------------------- 파일 대화상자 */

/** 기본 폴더 — 없는 환경(일부 리눅스 등)에서는 문서 → 홈 순서로 대체 */
function folderPath(name) {
  for (const n of [name, 'documents', 'home']) {
    try {
      if (n) {
        const p = app.getPath(n);
        if (fs.existsSync(p)) return p;
      }
    } catch {
      /* 다음 후보 */
    }
  }
  return os.homedir();
}

ipcMain.handle('dialog:save', async (_e, opts) => {
  const r = await dialog.showSaveDialog(win, {
    title: opts.title || '저장',
    defaultPath: path.join(folderPath(opts.folder), opts.defaultName || '이름 없음'),
    filters: opts.filters || [],
  });
  return r.canceled ? null : r.filePath;
});

ipcMain.handle('dialog:open', async (_e, opts) => {
  const r = await dialog.showOpenDialog(win, {
    title: opts.title || '열기',
    defaultPath: folderPath('documents'),
    filters: opts.filters || [],
    properties: opts.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
  });
  if (r.canceled) return [];
  return r.filePaths.map(readFileEntry);
});

ipcMain.handle('fs:write', async (_e, file, data) => {
  await fs.promises.writeFile(file, Buffer.from(data));
  app.addRecentDocument(file);
  return true;
});

ipcMain.handle('shell:show', (_e, file) => shell.showItemInFolder(file));

ipcMain.on('app:set-dirty', (_e, v) => {
  dirty = !!v;
  if (win) win.setDocumentEdited?.(dirty);
});
ipcMain.on('app:close-now', () => {
  forceClose = true;
  win?.close();
});

/* ---------------------------------------------------------------- 동영상 (ffmpeg) */

function ffmpegPath() {
  // 설치본에서는 asar 밖으로 풀린 실행 파일을 써야 한다
  return require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
}

const jobs = new Map();
let jobSeq = 0;

ipcMain.handle('video:start', async (_e, o) => {
  const id = ++jobSeq;
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${o.width}x${o.height}`, '-framerate', String(o.fps), '-i', 'pipe:0'];
  let tmpAudio = null;
  const total = o.frames / o.fps;
  if (o.audio) {
    const ext = path.extname(o.audio.name || '') || '.audio';
    tmpAudio = path.join(os.tmpdir(), `amg-${process.pid}-${id}${ext}`);
    await fs.promises.writeFile(tmpAudio, Buffer.from(o.audio.data));
    const a = o.audio;
    const loopLen = o.loopFrames / o.fps;
    const delayMs = Math.max(0, Math.round(a.delay * 1000));
    const loops = Math.max(1, o.frames / o.loopFrames);
    // 앞부분 자르기 → 시작 프레임만큼 지연 → 한 바퀴 길이로 맞추기 → 반복 → 볼륨
    // asetpts=N/SR/TB: 샘플 수로 시간을 다시 매겨 AAC 인코딩 때 길이가 어긋나지 않게 한다
    const n = Math.max(1, Math.round(loops));
    let f = `[1:a]atrim=start=${a.trim.toFixed(4)},asetpts=PTS-STARTPTS,adelay=${delayMs}:all=1,aresample=48000,apad=whole_dur=${loopLen.toFixed(4)},atrim=0:${loopLen.toFixed(4)},asetpts=N/SR/TB`;
    if (n > 1) {
      const labels = Array.from({ length: n }, (_, i) => `[l${i}]`).join('');
      f += `,asplit=${n}${labels};${labels}concat=n=${n}:v=0:a=1`;
    }
    f += `,asetpts=N/SR/TB,volume=${a.volume.toFixed(3)}[a]`;
    args.push('-i', tmpAudio, '-filter_complex', f, '-map', '0:v', '-map', '[a]');
  }
  if (o.format === 'webm') {
    args.push('-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-b:v', '0', '-crf', '30', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4');
    if (o.audio) args.push('-c:a', 'libopus', '-b:a', '160k');
  } else {
    args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', String(o.quality ?? 18), '-movflags', '+faststart');
    if (o.audio) args.push('-c:a', 'aac', '-b:a', '192k');
  }
  args.push('-t', total.toFixed(4), o.path);

  const proc = spawn(ffmpegPath(), args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  proc.stderr.on('data', (d) => (err += d.toString()));
  const done = new Promise((resolve) =>
    proc.on('close', (code) => {
      if (tmpAudio) fs.promises.unlink(tmpAudio).catch(() => {});
      resolve({ ok: code === 0, error: code === 0 ? null : err.trim().split('\n').slice(-3).join('\n') || `ffmpeg 종료 코드 ${code}` });
    }),
  );
  proc.on('error', (e) => (err += String(e)));
  proc.stdin.on('error', () => {});
  jobs.set(id, { proc, done });
  return id;
});

ipcMain.handle('video:frame', async (_e, id, data) => {
  const job = jobs.get(id);
  if (!job) throw new Error('작업이 없어요');
  const buf = Buffer.from(data);
  if (!job.proc.stdin.write(buf)) await new Promise((r) => job.proc.stdin.once('drain', r));
  return true;
});

ipcMain.handle('video:finish', async (_e, id) => {
  const job = jobs.get(id);
  if (!job) return { ok: false, error: '작업이 없어요' };
  job.proc.stdin.end();
  const r = await job.done;
  jobs.delete(id);
  return r;
});

ipcMain.handle('video:cancel', async (_e, id) => {
  const job = jobs.get(id);
  if (!job) return;
  job.proc.kill('SIGKILL');
  jobs.delete(id);
});

/* ---------------------------------------------------------------- 시작 */

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    let rel = decodeURIComponent(pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  for (const j of jobs.values()) j.proc.kill('SIGKILL');
  if (!isMac) app.quit();
});
