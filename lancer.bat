@echo off
setlocal enableextensions
title Compte rendu de diagnostic

rem ==========================================================================
rem  lancer.bat  -  Double-cliquez sur ce fichier pour ouvrir l'application.
rem  Il demarre le serveur local et ouvre votre navigateur. Rien d'autre a faire.
rem ==========================================================================

rem  Se placer dans le dossier de ce fichier (quel que soit l'endroit d'appel).
cd /d "%~dp0"

echo.
echo   ===============================================
echo     COMPTE RENDU DE DIAGNOSTIC
echo   ===============================================
echo.

rem --- 1. Python est-il installe ? -----------------------------------------
python --version >nul 2>&1
if errorlevel 1 (
  echo   PROBLEME : Python n'est pas installe sur cet ordinateur.
  echo.
  echo   Que faire :
  echo     1. Ouvrez  https://www.python.org/downloads/
  echo     2. Telechargez Python 3, lancez l'installateur.
  echo     3. IMPORTANT : cochez "Add Python to PATH" avant d'installer.
  echo     4. Relancez ce fichier "lancer.bat".
  echo.
  pause
  exit /b 1
)

rem --- 2. Premier lancement : creation de l'environnement + installation ----
if not exist ".venv\Scripts\python.exe" (
  echo   Premier lancement : preparation de l'application.
  echo   Cette etape ne se produit qu'une seule fois et peut durer
  echo   quelques minutes ^(telechargements^). Merci de patienter...
  echo.
  python -m venv .venv
  if errorlevel 1 (
    echo   PROBLEME : impossible de creer l'environnement Python.
    pause
    exit /b 1
  )
  ".venv\Scripts\python.exe" -m pip install --upgrade pip
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 (
    echo   PROBLEME : l'installation des composants a echoue.
    echo   Verifiez votre connexion internet et relancez "lancer.bat".
    pause
    exit /b 1
  )
  echo.
  echo   Installation terminee.
  echo.
)

rem --- 3. Creer config.txt depuis le modele au premier lancement -----------
if not exist "config.txt" (
  copy /y "config.txt.example" "config.txt" >nul
)

rem --- 4. La cle Claude est-elle renseignee dans config.txt ? ---------------
set "KEY="
for /f "usebackq eol=# tokens=1,* delims==" %%A in ("config.txt") do (
  if /i "%%A"=="ANTHROPIC_API_KEY" set "KEY=%%B"
)
if not defined KEY (
  echo   PROBLEME : la cle Claude n'est pas configuree.
  echo.
  echo   Que faire :
  echo     1. Ouvrez le fichier "config.txt" ^(dans ce meme dossier^).
  echo     2. Collez votre cle apres  ANTHROPIC_API_KEY=
  echo     3. Enregistrez le fichier, puis relancez "lancer.bat".
  echo.
  pause
  exit /b 1
)

rem --- 5. Ouvrir le navigateur ^(apres un court delai^) puis lancer le serveur
echo   Demarrage... votre navigateur va s'ouvrir automatiquement.
echo   Laissez cette fenetre noire OUVERTE tant que vous utilisez l'outil.
echo   Pour quitter : fermez cette fenetre.
echo.
start "" cmd /c "timeout /t 4 >nul & start "" http://127.0.0.1:8000"

".venv\Scripts\python.exe" -m uvicorn app:app --host 127.0.0.1 --port 8000

rem  Si uvicorn s'arrete sur une erreur, on garde la fenetre visible.
echo.
echo   Le serveur s'est arrete.
pause
