/**
 * obsidian-tray v0.3.5
 * (c) 2023 dragonwocky <thedragonring.bod@gmail.com> (https://dragonwocky.me/)
 * (https://github.com/dragonwocky/obsidian-tray/) under the MIT license
 */

"use strict";

const LOG_PREFIX = "obsidian-tray",
  LOG_LOADING = "loading",
  LOG_CLEANUP = "cleaning up",
  LOG_SHOWING_WINDOWS = "showing windows",
  LOG_HIDING_WINDOWS = "hiding windows",
  LOG_WINDOW_CLOSE = "intercepting window close",
  LOG_TRAY_ICON = "creating tray icon",
  LOG_REGISTER_HOTKEY = "registering hotkey",
  LOG_UNREGISTER_HOTKEY = "unregistering hotkey",
  ACTION_QUICK_NOTE = "快速笔记",
  ACTION_SHOW = "显示仓库",
  ACTION_HIDE = "隐藏仓库",
  ACTION_RELAUNCH = "重启 Obsidian",
  ACTION_CLOSE = "关闭仓库",
  DEFAULT_DATE_FORMAT = "YYYY-MM-DD",
  ACCELERATOR_FORMAT = `
    此快捷键为全局注册，即使 Obsidian 没有键盘焦点也会生效。格式：
    <a href="https://www.electronjs.org/docs/latest/tutorial/keyboard-shortcuts#accelerators" target="_blank" rel="noopener">
    Electron 快捷键（accelerator）</a>
  `,
  MOMENT_FORMAT = `
    格式：
    <a href="https://momentjs.com/docs/#/displaying/format/" target="_blank" rel="noopener">
    Moment.js 格式字符串</a>
  `,
  // 16x16 base64 obsidian icon: generated from obsidian.asar/icon.png
  OBSIDIAN_BASE64_ICON = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAHZSURBVDhPlZKxTxRBFMa/XZcF7nIG7mjxjoRCwomJxgsFdhaASqzQxFDzB1AQKgstLGxIiBQGJBpiCCGx8h+wgYaGgAWNd0dyHofeEYVwt/PmOTMZV9aDIL/s5pvZvPfN9yaL/+HR3eXcypta0m4juFbP5GHuXc9IbunDFc9db/G81/ZzhDMN7g8td47mll4R5BfHwZN4LOaA+fHa259PbUmIYzWkt3e2NZNo3/V9v1vvU6kkstk+tLW3ItUVr/m+c3N8MlkwxYqmBFcbwUQQCNOcyVzDwEAWjuPi5DhAMV/tKOYPX5hCyz8Gz1zX5SmWjBvZfmTSaRBJkGAIoxJHv+pVW2yIGNxOJ8bUVNcFEWLxuG1ia6JercTbttwQTeDwPS0kCMXiXtgk/jQrFUw7ptYSMWApF40yo/ytjHq98fdk3ayVE+cn2CxMb6ruz9qAJKFUKoWza1VJSi/n0+ffgYHdWW2gHuxXymg0gjCB0sjpmiaDnkL3RzDyzLqBUKns2ztQqUR0fk2TwSrGSf1eczqF5vsPZRCQSSAFLk6gqctgQRkc6TWRQLV2YMYQki9OoNkqzFQ9r+WOGuW5CrJbOzyAlPKr6MSGLbkcDwbf35oY/jRkt6cAfgNwowruAMz9AgAAAABJRU5ErkJggg==`,
  log = (message) => console.log(`${LOG_PREFIX}: ${message}`);

let tray, plugin;
const obsidian = require("obsidian"),
  { app, Tray, Menu } = require("electron").remote,
  { nativeImage, BrowserWindow } = require("electron").remote,
  { getCurrentWindow, globalShortcut } = require("electron").remote;

const vaultWindows = new Set(),
  maximizedWindows = new Set(),
  getWindows = () => [...vaultWindows],
  observeWindows = () => {
    const onWindowCreation = (win) => {
      vaultWindows.add(win);
      win.setSkipTaskbar(plugin.settings.hideTaskbarIcon);
      win.on("close", () => {
        if (win !== getCurrentWindow()) vaultWindows.delete(win);
      });
      // preserve maximised windows after minimisation
      if (win.isMaximized()) maximizedWindows.add(win);
      win.on("maximize", () => maximizedWindows.add(win));
      win.on("unmaximize", () => maximizedWindows.delete(win));
    };
    onWindowCreation(getCurrentWindow());
    getCurrentWindow().webContents.on("did-create-window", onWindowCreation);
    if (process.platform === "darwin") {
      // on macos, the "hide taskbar icon" option is implemented
      // via app.dock.hide(): thus, the app as a whole will be
      // hidden from the dock, including windows from other vaults.
      // when a vault is closed via the "close vault" button,
      // the cleanup process will call app.dock.show() to restore
      // access to any other open vaults w/out the tray enabled
      // => thus, this listener is required to re-hide the dock
      // if switching to another vault with the option enabled
      getCurrentWindow().on("focus", () => {
        if (plugin.settings.hideTaskbarIcon) hideTaskbarIcons();
      });
    }
  },
  showWindows = () => {
    log(LOG_SHOWING_WINDOWS);
    getWindows().forEach((win) => {
      if (maximizedWindows.has(win)) {
        win.maximize();
        win.focus();
      } else win.show();
    });
  },
  hideWindows = () => {
    log(LOG_HIDING_WINDOWS);
    getWindows().forEach((win) => [
      win.isFocused() && win.blur(),
      plugin.settings.runInBackground ? win.hide() : win.minimize(),
    ]);
  },
  toggleWindows = (checkForFocus = true) => {
    const openWindows = getWindows().some((win) => {
      return (!checkForFocus || win.isFocused()) && win.isVisible();
    });
    if (openWindows) hideWindows();
    else showWindows();
  };

const onWindowClose = (event) => event.preventDefault(),
  onWindowUnload = (event) => {
    log(LOG_WINDOW_CLOSE);
    getCurrentWindow().hide();
    event.stopImmediatePropagation();
    // setting return value manually is more reliable than
    // via `return false` according to electron
    event.returnValue = false;
  },
  interceptWindowClose = () => {
    // intercept in renderer
    window.addEventListener("beforeunload", onWindowUnload, true);
    // intercept in main: is asynchronously executed when registered
    // from renderer, so won't prevent close by itself, but counteracts
    // the 3-second delayed window force close in obsidian.asar/main.js
    getCurrentWindow().on("close", onWindowClose);
  },
  allowWindowClose = () => {
    getCurrentWindow().removeListener("close", onWindowClose);
    window.removeEventListener("beforeunload", onWindowUnload, true);
  };

const hideTaskbarIcons = () => {
    getWindows().forEach((win) => win.setSkipTaskbar(true));
    if (process.platform === "darwin") app.dock.hide();
  },
  showTaskbarIcons = () => {
    getWindows().forEach((win) => win.setSkipTaskbar(false));
    if (process.platform === "darwin") app.dock.show();
  },
  setLaunchOnStartup = () => {
    const { launchOnStartup, runInBackground, hideOnLaunch } = plugin.settings;
    app.setLoginItemSettings({
      openAtLogin: launchOnStartup,
      openAsHidden: runInBackground && hideOnLaunch,
    });
  };

const cleanup = () => {
    log(LOG_CLEANUP);
    unregisterHotkeys();
    showTaskbarIcons();
    allowWindowClose();
    destroyTray();
  },
  relaunchApp = () => {
    app.relaunch();
    app.exit(0);
  },
  closeVault = () => {
    log(LOG_CLEANUP);
    cleanup();
    const vaultWindows = getWindows(),
      obsidianWindows = BrowserWindow.getAllWindows();
    if (obsidianWindows.length === vaultWindows.length) {
      // quit app directly if only remaining windows are in the
      // current vault - necessary for successful quit on macos
      app.quit();
    } else vaultWindows.forEach((win) => win.destroy());
  };

const addQuickNote = () => {
    const { quickNoteLocation, quickNoteDateFormat } = plugin.settings,
      pattern = quickNoteDateFormat || DEFAULT_DATE_FORMAT,
      date = obsidian.moment().format(pattern),
      name = obsidian
        .normalizePath(`${quickNoteLocation ?? ""}/${date}`)
        .replace(/\*|"|\\|<|>|:|\||\?/g, "-"),
      // manually create and open file instead of depending
      // on createAndOpenMarkdownFile to force file creation
      // relative to the root instead of the active file
      // (in case user has default location for new notes
      // set to "same folder as current file")
      leaf = plugin.app.workspace.getLeaf(),
      root = plugin.app.fileManager.getNewFileParent(""),
      openMode = { active: true, state: { mode: "source" } };
    plugin.app.fileManager
      .createNewMarkdownFile(root, name)
      .then((file) => leaf.openFile(file, openMode));
    showWindows();
  },
  replaceVaultName = (str) => {
    return str.replace(/{{vault}}/g, plugin.app.vault.getName());
  },
  destroyTray = () => {
    tray?.destroy();
    tray = undefined;
  },
  createTrayIcon = () => {
    destroyTray();
    if (!plugin.settings.createTrayIcon) return;
    log(LOG_TRAY_ICON);
    const obsidianIcon = nativeImage.createFromDataURL(
        plugin.settings.trayIconImage ?? OBSIDIAN_BASE64_ICON
      ),
      contextMenu = Menu.buildFromTemplate([
        {
          type: "normal",
          label: ACTION_QUICK_NOTE,
          accelerator: plugin.settings.quickNoteHotkey,
          click: addQuickNote,
        },
        {
          type: "normal",
          label: ACTION_SHOW,
          accelerator: plugin.settings.toggleWindowFocusHotkey,
          click: showWindows,
        },
        {
          type: "normal",
          label: ACTION_HIDE,
          accelerator: plugin.settings.toggleWindowFocusHotkey,
          click: hideWindows,
        },
        { type: "separator" },
        { label: ACTION_RELAUNCH, click: relaunchApp },
        { label: ACTION_CLOSE, click: closeVault },
      ]);
    tray = new Tray(obsidianIcon);
    tray.setContextMenu(contextMenu);
    tray.setToolTip(replaceVaultName(plugin.settings.trayIconTooltip));
    tray.on("click", () => {
      if (process.platform === "darwin") {
        // macos does not register separate left/right click actions
        // for menu items, icon should open menu w/out causing toggle
        tray.popUpContextMenu();
      } else toggleWindows(false);
    });
  };

const registerHotkeys = () => {
    log(LOG_REGISTER_HOTKEY);
    try {
      const { toggleWindowFocusHotkey, quickNoteHotkey } = plugin.settings;
      if (toggleWindowFocusHotkey) {
        globalShortcut.register(toggleWindowFocusHotkey, toggleWindows);
      }
      if (quickNoteHotkey) {
        globalShortcut.register(quickNoteHotkey, addQuickNote);
      }
    } catch {}
  },
  unregisterHotkeys = () => {
    log(LOG_UNREGISTER_HOTKEY);
    try {
      globalShortcut.unregister(plugin.settings.toggleWindowFocusHotkey);
      globalShortcut.unregister(plugin.settings.quickNoteHotkey);
    } catch {}
  };

const OPTIONS = [
  "窗口管理",
  {
    key: "launchOnStartup",
    name: "登录时启动",
    desc: "登录电脑时自动打开 Obsidian。",
    type: "toggle",
    default: false,
    onChange: setLaunchOnStartup,
  },
  {
    key: "hideOnLaunch",
    name: "启动时隐藏",
    desc: `
      应用启动时自动最小化 Obsidian。若已启用「后台运行」，窗口会隐藏到系统
      托盘/菜单栏，而不是最小化到任务栏/程序坞。
    `,
    type: "toggle",
    default: false,
  },
  {
    key: "runInBackground",
    name: "后台运行",
    desc: `
      点击关闭按钮或使用切换焦点快捷键时，隐藏应用并让它在后台继续运行，
      而不是直接退出。
    `,
    type: "toggle",
    default: false,
    onChange() {
      setLaunchOnStartup();
      if (plugin.settings.runInBackground) interceptWindowClose();
      else [allowWindowClose(), showWindows()];
    },
  },
  {
    key: "hideTaskbarIcon",
    name: "隐藏任务栏图标",
    desc: `
      从程序坞/任务栏中隐藏窗口图标。使用此项时建议先启用托盘图标。
      在 Linux 上可能无效。
    `,
    type: "toggle",
    default: false,
    onChange() {
      if (plugin.settings.hideTaskbarIcon) hideTaskbarIcons();
      else showTaskbarIcons();
    },
  },
  {
    key: "createTrayIcon",
    name: "创建托盘图标",
    desc: `
      在系统托盘/菜单栏添加图标：单击可将隐藏的 Obsidian 窗口唤回前台，
      也可通过右键菜单彻底退出或重启应用。
    `,
    type: "toggle",
    default: true,
    onChange: createTrayIcon,
  },
  {
    key: "trayIconImage",
    name: "托盘图标图片",
    desc: `
      设置托盘/菜单栏图标使用的图片。建议尺寸：16x16
      <br>预览：<img data-preview style="height: 16px; vertical-align: bottom;">
    `,
    type: "image",
    default: OBSIDIAN_BASE64_ICON,
    onChange: createTrayIcon,
  },
  {
    key: "trayIconTooltip",
    name: "托盘图标提示文字",
    desc: `
      设置用于标识托盘/菜单栏图标的文字。
      <code>{{vault}}</code> 占位符会被替换为仓库名称。
      <br>预览：<b class="u-pop" data-preview></b>
    `,
    type: "text",
    default: "{{vault}} | Obsidian",
    postprocessor: replaceVaultName,
    onChange: createTrayIcon,
  },
  {
    key: "toggleWindowFocusHotkey",
    name: "切换窗口焦点快捷键",
    desc: ACCELERATOR_FORMAT,
    type: "hotkey",
    default: "CmdOrCtrl+Shift+Tab",
    onBeforeChange: unregisterHotkeys,
    onChange: registerHotkeys,
  },
  "快速笔记",
  {
    key: "quickNoteLocation",
    name: "快速笔记存放位置",
    desc: "新建的快速笔记会放入此文件夹。",
    type: "text",
    placeholder: "示例：notes/quick",
  },
  {
    key: "quickNoteDateFormat",
    name: "快速笔记日期格式",
    desc: `
      快速笔记将使用此模式作为文件名。${MOMENT_FORMAT}
      <br>预览：<b class="u-pop" data-preview></b>
    `,
    type: "moment",
    default: DEFAULT_DATE_FORMAT,
  },
  {
    key: "quickNoteHotkey",
    name: "快速笔记快捷键",
    desc: ACCELERATOR_FORMAT,
    type: "hotkey",
    default: "CmdOrCtrl+Shift+Q",
    onBeforeChange: unregisterHotkeys,
    onChange: registerHotkeys,
  },
];

const keyToLabel = (key, name) =>
    name ??
    (key[0].toUpperCase() +
      key
        .slice(1)
        .split(/(?=[A-Z])/)
        .map((word) => word.toLowerCase())
        .join(" ")),
  htmlToFragment = (html) =>
    document
      .createRange()
      .createContextualFragment((html ?? "").replace(/\s+/g, " "));

class SettingsTab extends obsidian.PluginSettingTab {
  display() {
    this.containerEl.empty();
    for (const opt of OPTIONS) {
      const setting = new obsidian.Setting(this.containerEl);
      if (typeof opt === "string") {
        setting.setName(opt);
        setting.setHeading();
      } else {
        if (opt.default) opt.placeholder ??= `示例：${opt.default}`;
        setting.setName(keyToLabel(opt.key, opt.name));
        setting.setDesc(htmlToFragment(opt.desc));
        const onChange = async (value) => {
          await opt.onBeforeChange?.();
          plugin.settings[opt.key] = value;
          await plugin.saveSettings();
          await opt.onChange?.();
        };

        const value = plugin.settings[opt.key] ?? opt.default ?? "";
        if (opt.type === "toggle") {
          setting.addToggle((toggle) => {
            toggle.setValue(value).onChange(onChange);
          });
        } else if (opt.type === "image") {
          const previewImg = setting.descEl.querySelector("img[data-preview");
          if (previewImg) previewImg.src = value;
          const fileUpload = setting.descEl.createEl("input");
          fileUpload.style.visibility = "hidden";
          fileUpload.type = "file";
          fileUpload.onchange = (event) => {
            const file = event.target.files[0],
              reader = new FileReader();
            reader.onloadend = () => {
              onChange(reader.result);
              if (previewImg) previewImg.src = reader.result;
            };
            reader.readAsDataURL(file);
          };
          setting.addButton((button) => {
            button.setIcon("image").onClick(() => fileUpload.click());
          });
        } else if (opt.type === "moment") {
          setting.addMomentFormat((moment) => {
            const previewEl = setting.descEl.querySelector("[data-preview]");
            if (previewEl) moment.setSampleEl(previewEl);
            moment
              .setPlaceholder(opt.placeholder)
              .setDefaultFormat(opt.default ?? "")
              .setValue(value)
              .onChange(onChange);
          });
        } else {
          const previewEl = setting.descEl.querySelector("[data-preview]"),
            updatePreview = (value) => {
              if (!previewEl) return;
              previewEl.innerText = opt?.postprocessor(value) ?? value;
            };
          updatePreview(value);
          setting.addText((text) => {
            text
              .setPlaceholder(opt.placeholder)
              .setValue(value)
              .onChange((value) => [onChange(value), updatePreview(value)]);
          });
        }
      }
    }
  }
}

class TrayPlugin extends obsidian.Plugin {
  async onload() {
    log(LOG_LOADING);
    await this.loadSettings();
    this.addSettingTab(new SettingsTab(this.app, this));
    const { settings } = this;

    plugin = this;
    createTrayIcon();
    registerHotkeys();
    setLaunchOnStartup();
    observeWindows();
    if (settings.runInBackground) interceptWindowClose();
    if (settings.hideTaskbarIcon) hideTaskbarIcons();
    if (settings.hideOnLaunch) {
      this.registerEvent(this.app.workspace.onLayoutReady(hideWindows));
    }

    // add as command: can be called from command palette
    // and can have non-global hotkey assigned via in-app menu
    this.addCommand({
      id: "relaunch-app",
      name: ACTION_RELAUNCH,
      callback: relaunchApp,
    });
    this.addCommand({
      id: "close-vault",
      name: ACTION_CLOSE,
      callback: closeVault,
    });
  }
  onunload() {
    cleanup();
  }

  getCurrentWindow = getCurrentWindow
  getWindows = getWindows;
  showWindows = showWindows;
  hideWindows = hideWindows;
  toggleWindows = toggleWindows;

  async loadSettings() {
    const DEFAULT_SETTINGS = OPTIONS.map((opt) => ({ [opt.key]: opt.default }));
    this.settings = Object.assign(...DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
}
module.exports = TrayPlugin;
