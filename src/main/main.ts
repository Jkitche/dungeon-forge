import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { watchFile } from 'node:fs';
import type { MenuAction, OpenRequest, OpenedFile, SaveRequest, WriteRequest } from '../shared/ipc.ts';

// Compiled layout: dist/main/main.js, dist/main/preload.cjs, dist/renderer/index.html
const here = import.meta.dirname;

let win: BrowserWindow | null = null;

// The renderer may only write files whose directory and name stem the user picked in a save dialog,
// so e.g. choosing "crypt.foundry.json" also allows the companion "crypt.png".
const approvedStems = new Set<string>();
const stemOf = (p: string): string => path.join(path.dirname(p), path.basename(p).split('.')[0] ?? '');
const writtenPaths = new Set<string>();

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#16171b',
    title: 'Dungeon Forge',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void win.loadFile(path.join(here, '..', 'renderer', 'index.html'));
  win.on('closed', () => {
    win = null;
  });
}

// Under `npm run dev`, the dev script touches this file after each renderer rebuild.
if (process.env.DUNGEON_FORGE_DEV) {
  watchFile(path.join(here, '..', '.reload'), { interval: 100 }, () => win?.webContents.reloadIgnoringCache());
}

const send = (action: MenuAction) => () => win?.webContents.send('menu', action);

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as const] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Dungeon', accelerator: 'CmdOrCtrl+N', click: send('new') },
        { label: 'New Blank Map', accelerator: 'CmdOrCtrl+Shift+N', click: send('blank') },
        { label: 'Regenerate (Same Seed)', accelerator: 'CmdOrCtrl+R', click: send('regenerate') },
        { type: 'separator' },
        { label: 'Open Map…', accelerator: 'CmdOrCtrl+O', click: send('open') },
        { label: 'Save Map…', accelerator: 'CmdOrCtrl+S', click: send('save') },
        { type: 'separator' },
        { label: 'Export…', accelerator: 'CmdOrCtrl+E', click: send('export') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Edit Map', accelerator: 'CmdOrCtrl+Shift+E', click: send('toggle-edit') },
        { label: 'Toggle GM / Player View', accelerator: 'CmdOrCtrl+G', click: send('toggle-gm') },
        { label: 'Fit Map to Window', accelerator: 'CmdOrCtrl+0', click: send('fit') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'About Universal VTT format', click: () => void shell.openExternal('https://arkenforge.com/universal-vtt-files/') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('choose-save-path', async (_e, req: SaveRequest): Promise<string | null> => {
  if (!win) return null;
  const result = await dialog.showSaveDialog(win, {
    title: req.title ?? 'Save',
    defaultPath: path.join(app.getPath('documents'), path.basename(String(req.defaultName ?? 'dungeon'))),
    filters: req.filters,
  });
  if (result.canceled || !result.filePath) return null;
  approvedStems.add(stemOf(result.filePath));
  return result.filePath;
});

ipcMain.handle('write-files', async (_e, files: WriteRequest[]): Promise<string[]> => {
  const written: string[] = [];
  for (const f of files) {
    const target = path.resolve(String(f.path));
    if (!approvedStems.has(stemOf(target))) throw new Error(`Refusing to write unapproved path: ${target}`);
    let data: string | Buffer;
    if (typeof f.data === 'string') data = f.encoding === 'base64' ? Buffer.from(f.data, 'base64') : f.data;
    else data = Buffer.from(f.data);
    await fs.writeFile(target, data);
    writtenPaths.add(target);
    written.push(target);
  }
  return written;
});

ipcMain.handle('open-file', async (_e, req: OpenRequest): Promise<OpenedFile | null> => {
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, { title: req.title ?? 'Open', filters: req.filters, properties: ['openFile'] });
  const filePath = result.filePaths[0];
  if (result.canceled || !filePath) return null;
  return { path: filePath, text: await fs.readFile(filePath, 'utf8') };
});

ipcMain.handle('show-in-folder', (_e, p: string): void => {
  const target = path.resolve(String(p));
  if (writtenPaths.has(target)) shell.showItemInFolder(target);
});

void app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
