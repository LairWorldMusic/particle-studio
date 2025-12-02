const { app, BrowserWindow, ipcMain, shell, dialog, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// Регистрируем deep link протокол
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('particle-studio', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('particle-studio');
}

// ВАЖНО: отключаем троттлинг когда окно не видно
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// Включаем захват системного аудио
app.commandLine.appendSwitch('enable-features', 'AudioServiceOutOfProcess');
app.commandLine.appendSwitch('enable-usermedia-screen-capturing');

let mainWindow;
let pythonProcess = null;
let pendingAuthData = null;

// Обработчики кнопок окна
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.on('window-close', () => {
  app.quit();
});

// Получение источников для захвата аудио
ipcMain.handle('get-desktop-sources', async () => {
  const sources = await desktopCapturer.getSources({ 
    types: ['screen', 'window'],
    fetchWindowIcons: false
  });
  return sources.map(s => ({ id: s.id, name: s.name }));
});

// Settings file path
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

// Default settings
const defaultSettings = {
  firstLaunch: true,
  theme: 'dark',
  camera: '',
  quality: '720',
  profiles: [],
  currentProfile: ''
};

// Load settings
ipcMain.handle('load-settings', async () => {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      return JSON.parse(data);
    }
    // Create default settings file
    fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2));
    return defaultSettings;
  } catch (e) {
    console.error('Error loading settings:', e);
    return defaultSettings;
  }
});

// Save settings
ipcMain.handle('save-settings', async (event, settings) => {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return true;
  } catch (e) {
    console.error('Error saving settings:', e);
    return false;
  }
});

// Открытие внешних ссылок в браузере
ipcMain.on('open-external', (event, url) => {
  shell.openExternal(url);
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    frame: false,
    title: 'Particle Studio',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Разрешаем доступ к камере и аудио
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'display-capture') {
      callback(true);
    } else {
      callback(false);
    }
  });

  // В dev режиме грузим с vite, в проде — из dist
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5174');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../build/index.html'));
  }

  // ESC для выхода
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape') {
      app.quit();
    }
  });
}

// Обработка deep link на Windows
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    // Кто-то пытался запустить второй экземпляр
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    
    // Проверяем deep link в командной строке
    const url = commandLine.find(arg => arg.startsWith('particle-studio://'));
    if (url) {
      handleDeepLink(url);
    }
  });
}

function handleDeepLink(url) {
  try {
    const urlObj = new URL(url);
    if (urlObj.pathname === '//auth' || urlObj.host === 'auth') {
      const userParam = urlObj.searchParams.get('user');
      if (userParam) {
        const userData = JSON.parse(decodeURIComponent(userParam));
        // Отправляем данные в renderer
        if (mainWindow) {
          mainWindow.webContents.send('auth-success', userData);
          mainWindow.show();
          mainWindow.focus();
        } else {
          pendingAuthData = userData;
        }
      }
    }
  } catch (e) {
    console.error('Deep link error:', e);
  }
}

app.whenReady().then(async () => {
  createWindow();
  
  // Проверяем deep link при запуске
  const url = process.argv.find(arg => arg.startsWith('particle-studio://'));
  if (url) {
    handleDeepLink(url);
  }
  
  // Запускаем Python скрипт для виртуальной камеры
  setTimeout(() => startVirtualCam(), 2000);
});

function startVirtualCam() {
  // Путь к скрипту
  const scriptPath = path.join(app.getAppPath(), 'virtual_cam.py');
  
  // Проверяем есть ли скрипт
  if (!fs.existsSync(scriptPath)) {
    console.log('virtual_cam.py не найден:', scriptPath);
    return;
  }
  
  console.log('Запускаю виртуальную камеру...');
  
  pythonProcess = spawn('python', [scriptPath], {
    cwd: app.getAppPath(),
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  pythonProcess.stdout.on('data', (data) => {
    console.log('VirtualCam:', data.toString());
  });
  
  pythonProcess.stderr.on('data', (data) => {
    console.log('VirtualCam Error:', data.toString());
  });
  
  pythonProcess.on('close', (code) => {
    console.log('VirtualCam закрыт:', code);
    pythonProcess = null;
  });
}

function stopVirtualCam() {
  if (pythonProcess) {
    pythonProcess.kill();
    pythonProcess = null;
  }
}

app.on('window-all-closed', () => {
  app.quit();
});

// Функция проверки драйвера при первом запуске
async function checkAndInstallDriver() {
  const configPath = path.join(app.getPath('userData'), 'config.json');
  let config = {};
  
  try {
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {}
  
  if (!config.driverAsked) {
    const result = await dialog.showMessageBox({
      type: 'question',
      title: 'Виртуальная камера',
      message: 'Хочешь использовать эффект как веб-камеру?',
      detail: 'Для этого нужно установить OBS или SplitCam.\nПосле установки эффект будет доступен в Zoom, Discord и других приложениях.',
      buttons: ['Установить', 'Позже', 'Не спрашивать'],
      defaultId: 0
    });
    
    if (result.response === 0) {
      await downloadAndInstallDriver();
    }
    
    if (result.response === 2) {
      config.driverAsked = true;
      fs.writeFileSync(configPath, JSON.stringify(config));
    }
  }
}

async function downloadAndInstallDriver() {
  const result = await dialog.showMessageBox({
    type: 'info',
    title: 'Виртуальная камера',
    message: 'Выбери способ:',
    detail: 'OBS (рекомендуется):\nУстанови OBS Studio — в нём уже есть виртуальная камера.\n\nSplitCam (альтернатива):\nБесплатная программа с виртуальной камерой.',
    buttons: ['Скачать OBS', 'Скачать SplitCam', 'Отмена']
  });
  
  if (result.response === 0) {
    shell.openExternal('https://obsproject.com/download');
  } else if (result.response === 1) {
    shell.openExternal('https://splitcam.com/download');
  }
}

