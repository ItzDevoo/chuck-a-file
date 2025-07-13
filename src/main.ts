import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { autoUpdater } from 'electron-updater';

// This function handles opening the file selection dialog
async function handleFileSelect() {
  const { canceled, filePaths } = await dialog.showOpenDialog({});
  if (!canceled) {
    return filePaths[0];
  }
}

// This function handles opening the folder selection dialog
async function handleFolderSelect() {
  const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (!canceled) {
    return filePaths[0];
  }
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false, // Remove the toolbar/titlebar
    titleBarStyle: 'hidden', // Alternative: use hidden titlebar
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      webSecurity: false, // Allow cross-origin requests for development
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
};

app.whenReady().then(() => {
  // Set up listeners for our dialog events
  ipcMain.handle('dialog:selectFile', handleFileSelect);
  ipcMain.handle('dialog:selectFolder', handleFolderSelect);

  // Set up window control listeners
  ipcMain.on('window-minimize', () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) window.minimize();
  });

  ipcMain.on('window-maximize', () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      if (window.isMaximized()) {
        window.restore();
      } else {
        window.maximize();
      }
    }
  });

  ipcMain.on('window-close', () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) window.close();
  });

  createWindow();
  
  autoUpdater.checkForUpdatesAndNotify();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});