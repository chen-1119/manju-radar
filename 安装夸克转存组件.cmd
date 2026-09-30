@echo off
cd /d "%~dp0"
py -3 -m venv .venv
if errorlevel 1 goto failed
".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto failed
".venv\Scripts\python.exe" -m pip install "quarkpan==1.0.5" "qrcode[pil]"
if errorlevel 1 goto failed
echo.
echo 夸克转存组件安装完成。现在可以双击“启动漫剧雷达.cmd”。
pause
exit /b 0
:failed
echo.
echo 安装失败。请检查 Python 3 和网络连接。
pause
exit /b 1
