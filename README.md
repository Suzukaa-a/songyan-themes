# 松烟键盘外观编辑器

在浏览器里编辑松烟（Songyan）的键盘外观文件（`*.songyanappearance.json`，格式第 1 版）。改配色、字体、按键、间隙和候选栏，右边实时预览，改好后导出文件，再导入松烟。页面是纯静态的，不联网，草稿只保存在你的浏览器里。

## 使用

1. 打开页面，从一个内置外观开始，或者导入已有的文件（选择文件、拖进页面、粘贴 JSON 都行）。
2. 改完后点「下载文件」。手机上也可以点「分享」，或者「复制 JSON」。
3. 预览里可以切换浅色 / 深色、Android / iPhone，以及输入中 / 工具栏。编辑器只提供 Android 和 iPhone 都会读取的设置：颜色、按键边框和候选栏。文件里的其他项目会原样保留。iPhone 上键盘底色由系统绘制，所以键盘底色只对 Android 有效。

## 导入松烟

- Android：设置 > 键盘外观 > 导入。
- iPhone：打开松烟 App 的键盘外观页面，点导入。

`fixtures/` 里有每个内置外观和一个改动很多的示例（`sample-lantern`），可以直接导入试试。把内置外观的文件导入 Android 版，会得到一份新的副本，内置的那份不会被改动。

## 运行与测试

直接部署到 GitHub Pages 即可，没有构建步骤。本地查看：`python3 -m http.server`，再打开 `http://localhost:8000`。
部分浏览器（例如 Chrome）不允许从 `file://` 加载模块，请用 Firefox 或上面的本地服务器。

测试需要 Node 20 以上，没有依赖：

```
node --test tests/
```

修改内置外观后，用 `UPDATE_FIXTURES=1 node --test tests/` 重写 `fixtures/`。文件格式见 [FORMAT.md](FORMAT.md)。

---

# Songyan keyboard appearance editor

A static web editor for Songyan keyboard appearance files (`*.songyanappearance.json`, format version 1). Change colours, fonts, keys, gaps and the candidate bar, watch the live preview, then export the file and import it into Songyan. No network requests; your draft stays in your browser.

## Use

1. Start from a built-in appearance, or import a file (picker, drag and drop, or paste JSON).
2. Click "Download file". On a phone you can also use "Share" or "Copy JSON".
3. The preview switches between light and dark, Android and iPhone, and typing and toolbar. The editor only offers settings both Android and iPhone read: colours, key border and the candidate bar. Everything else in a file is kept as it is. On iPhone the system draws the keyboard background, so the keyboard background colour only applies on Android.

## Import into Songyan

- Android: Settings > Keyboard appearance > Import.
- iPhone: open the appearance page in the Songyan app and tap Import.

`fixtures/` holds every built-in appearance plus a heavily edited sample (`sample-lantern`) for trying imports. Importing a built-in's file into the Android app creates a separate copy; the built-in itself is untouched.

## Run and test

Deploy to GitHub Pages as is; there is no build step. To view locally run `python3 -m http.server` and open `http://localhost:8000`. Some browsers (Chrome, for one) refuse ES modules from `file://`; use Firefox or the local server.

Tests need Node 20 or newer and have no dependencies:

```
node --test tests/
```

After changing a built-in appearance, run `UPDATE_FIXTURES=1 node --test tests/` to rewrite `fixtures/`. The file format is described in [FORMAT.md](FORMAT.md).

## License

GPL-3.0-only.
