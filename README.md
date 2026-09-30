# 漫剧雷达

Windows 本机工具：查看近期热门 AI 漫剧，实时搜索百度网盘与夸克网盘的公开分享线索，并在各自账号授权后转存直达分享。

## 在其他电脑使用

从 GitHub Releases 下载 `漫剧雷达-Windows.zip`，完整解压后双击 `漫剧雷达.exe`。主程序和夸克组件已包含在压缩包里，无需安装 Node.js 或 Python。关闭程序窗口会停止本机搜索服务；再次双击即可启动。浏览器若未自动打开，可手动访问 <http://127.0.0.1:4177/>。

百度转存组件由百度官方提供，发行包不重新分发它。首次使用百度转存时，双击 `安装百度转存组件.cmd`：它从百度官方地址下载固定版本，并校验压缩包和程序的 SHA-256 后安装在 `%LOCALAPPDATA%\ManjuRadar\components`。刷新页面后点击“获取百度授权链接”，在百度官方页面登录，再把显示的授权码填回本机页面。此过程不需要用户自己申请开发者应用。

夸克转存：点击页面中的“扫码登录夸克网盘”，用夸克 App 扫码确认。登录完成后，直达分享的“一键转存”将文件保存到自己的 `/AI漫剧` 文件夹。百度转存保存到“我的应用数据 / bdpan / AI漫剧”，这是百度官方工具允许写入的范围。百度命令返回完成文件清单时，页面显示实际保存路径；只返回“任务已提交”时，页面会保留任务号并提示稍后核对，避免重复提交。

## 搜索说明

每次点击搜索会重新请求[盘搜索公开 API](https://www.pansousuo.com/api-docs)，按百度、夸克分栏显示。首页热门内容按公开索引热度和近 31 天收录时间筛选；收录时间不等于作品首播时间。可按作品剧集、教程素材和时间范围筛选。公开索引可能延迟，分享链接仍需用户核对有效性与使用授权。

若希望索引没有结果时补充公开网页搜索，可在页面底部填入 [Brave Search API](https://brave.com/search/api/) 密钥。密钥只保存在这台电脑的 `%LOCALAPPDATA%\ManjuRadar\config.local.json`，不会打进发行包。

## 账号与数据

- 百度使用[百度官方 bdpan 工具](https://github.com/baidu-netdisk/bdpan-storage)的 OAuth 授权。授权资料保存在 `%LOCALAPPDATA%\ManjuRadar\baidu`。官方工具的转存范围为 `/apps/bdpan/`。
- 夸克使用 [QuarkPan](https://github.com/lich0821/QuarkPan) 1.0.5。它依赖夸克非公开接口，平台更新后可能失效。登录 Cookie 由该组件以**明文 JSON**保存在 `%LOCALAPPDATA%\ManjuRadar\quark`。只在可信的私人电脑扫码登录。
- 百度、夸克账号各自独立授权；这些本机目录、搜索密钥及登录资料均不应上传到 GitHub。

## 从源码运行与构建

开发时需 Node.js 20 以上；运行 `npm install`、`npm test`、`npm start`。若不使用发行包，夸克组件可用 `安装夸克转存组件.cmd` 安装，它需要本机 Python 3；百度组件可用上述安装脚本安装。

Windows 发行包通过 Node 单文件程序和 PyInstaller 构建。先用 Python 3.12 的独立虚拟环境安装 `quarkpan==1.0.5`、`qrcode[pil]` 和 `pyinstaller`，构建 `quarkpan.exe`、`quark-login.exe` 放入 `build/quark-components`；再运行 `npm run build:win`，输出位于 `dist/漫剧雷达-Windows`。构建输出、虚拟环境、本机配置均被 `.gitignore` 排除。
