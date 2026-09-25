@echo off
cd /d "%~dp0"
where py >nul 2>&1
if errorlevel 1 goto python
py -3 serve.py %*
exit /b %errorlevel%

:python
python serve.py %*
exit /b %errorlevel%
