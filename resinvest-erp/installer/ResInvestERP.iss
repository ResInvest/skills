; =========================================================================
;  ResInvest ERP 3.2 · instalator Windows (Inno Setup 7; zgodny z Inno Setup 6.3+)
;  Kodowanie pliku: UTF-8 z BOM (wymagane dla polskich i czeskich znaków — Inno Setup 7
;  przerywa kompilację przy bajtach niezgodnych ze stroną kodową pliku).
;
;  Budowanie (Windows, z katalogu resinvest-erp):
;    powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1
;  Skrypt: buduje ResInvest_ERP.html, generuje dane przykładowe, pobiera
;  środowisko Node.js (node.exe, weryfikacja SHA-256) do installer\runtime
;  i kompiluje ten plik.  Wynik: installer\Output\ResInvestERP_Setup_3.2.0.exe
;
;  Składniki:
;   * Program (tryb lokalny)   — samodzielny plik HTML; dane w przeglądarce,
;                                logowanie lokalne, bez serwera i bez internetu.
;   * Serwer (wielostanowiskowy) — ResInvest ERP Serwer: Node.js + SQLite,
;                                konta i sesje po stronie serwera, dziennik
;                                zmian z łańcuchem skrótów, kopie codzienne.
;                                Dane: C:\ProgramData\ResInvestERP (nie są
;                                usuwane przy odinstalowaniu). Poczta (zaproszenia,
;                                reset hasła): C:\ProgramData\ResInvestERP\server.env
;                                — tworzony z .env.example tylko przy pierwszej instalacji.
; =========================================================================

#define AppName "ResInvest ERP"
#define AppVersion "3.2.0"
#define AppPublisher "ResInvest Commodities"
#define AppURL "http://localhost:8080/"
#define ServerPort "8080"

[Setup]
AppId={{8C1B7E52-3E0B-4B7A-9E0D-5B2D6A1F4C10}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppCopyright=Copyright (c) 2026 Mateusz Roesner — program stworzony dla ResInvest Commodities
VersionInfoCompany=ResInvest Commodities
VersionInfoDescription=ResInvest ERP — instalator
VersionInfoVersion={#AppVersion}
DefaultDirName={autopf}\ResInvest ERP
DefaultGroupName=ResInvest ERP
DisableProgramGroupPage=yes
LicenseFile=..\LICENSE
OutputDir=Output
OutputBaseFilename=ResInvestERP_Setup_{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
UninstallDisplayName={#AppName} {#AppVersion}
UninstallDisplayIcon={app}\runtime\node.exe
CloseApplications=yes
SetupLogging=yes

[Languages]
Name: "polish"; MessagesFile: "compiler:Languages\Polish.isl"
Name: "czech"; MessagesFile: "compiler:Languages\Czech.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
polish.CompLocal=Program — tryb lokalny (jedno stanowisko)
czech.CompLocal=Program — místní režim (jedno pracoviště)
english.CompLocal=Program — local mode (single workstation)
polish.CompServer=Serwer wielostanowiskowy (Node.js + SQLite)
czech.CompServer=Víceuživatelský server (Node.js + SQLite)
english.CompServer=Multi-user server (Node.js + SQLite)
polish.TypeFull=Pełna instalacja (program i serwer)
czech.TypeFull=Úplná instalace (program a server)
english.TypeFull=Full installation (program and server)
polish.TypeLocal=Tylko program (tryb lokalny)
czech.TypeLocal=Pouze program (místní režim)
english.TypeLocal=Program only (local mode)
polish.TaskDesktop=Skrót na pulpicie
czech.TaskDesktop=Zástupce na ploše
english.TaskDesktop=Desktop shortcut
polish.TaskAutostart=Uruchamiaj serwer przy logowaniu do Windows
czech.TaskAutostart=Spouštět server při přihlášení do Windows
english.TaskAutostart=Start the server when signing in to Windows
polish.TaskFirewall=Zezwól na dostęp z sieci lokalnej (zapora, port {#ServerPort})
czech.TaskFirewall=Povolit přístup z místní sítě (brána firewall, port {#ServerPort})
english.TaskFirewall=Allow access from the local network (firewall, port {#ServerPort})
polish.Shortcuts=Skróty:
czech.Shortcuts=Zástupci:
english.Shortcuts=Shortcuts:
polish.ServerGroup=Serwer:
czech.ServerGroup=Server:
english.ServerGroup=Server:
polish.LnkLocal=ResInvest ERP (tryb lokalny)
czech.LnkLocal=ResInvest ERP (místní režim)
english.LnkLocal=ResInvest ERP (local mode)
polish.LnkServer=ResInvest ERP Serwer — uruchom
czech.LnkServer=ResInvest ERP Server — spustit
english.LnkServer=ResInvest ERP Server — start
polish.LnkOpen=ResInvest ERP (serwer) — otwórz w przeglądarce
czech.LnkOpen=ResInvest ERP (server) — otevřít v prohlížeči
english.LnkOpen=ResInvest ERP (server) — open in browser
polish.LnkBackup=Kopia zapasowa bazy teraz
czech.LnkBackup=Záloha databáze nyní
english.LnkBackup=Back up the database now
polish.LnkCheck=Kontrola spójności bazy
czech.LnkCheck=Kontrola konzistence databáze
english.LnkCheck=Database integrity check
polish.LnkData=Folder danych serwera
czech.LnkData=Složka dat serveru
english.LnkData=Server data folder
polish.LnkEnv=Konfiguracja poczty i adresu (server.env)
czech.LnkEnv=Nastavení pošty a adresy (server.env)
english.LnkEnv=E-mail and address settings (server.env)
polish.LnkDocs=Instrukcja (README)
czech.LnkDocs=Návod (README)
english.LnkDocs=Manual (README)
polish.RunLocal=Uruchom ResInvest ERP (tryb lokalny)
czech.RunLocal=Spustit ResInvest ERP (místní režim)
english.RunLocal=Start ResInvest ERP (local mode)
polish.RunServer=Uruchom serwer i otwórz program
czech.RunServer=Spustit server a otevřít program
english.RunServer=Start the server and open the program

[Types]
Name: "full"; Description: "{cm:TypeFull}"
Name: "local"; Description: "{cm:TypeLocal}"

[Components]
Name: "app"; Description: "{cm:CompLocal}"; Types: full local; Flags: fixed
Name: "server"; Description: "{cm:CompServer}"; Types: full

[Tasks]
Name: "desktopicon"; Description: "{cm:TaskDesktop}"; GroupDescription: "{cm:Shortcuts}"
Name: "autostart"; Description: "{cm:TaskAutostart}"; GroupDescription: "{cm:ServerGroup}"; Components: server
Name: "firewall"; Description: "{cm:TaskFirewall}"; GroupDescription: "{cm:ServerGroup}"; Components: server; Flags: unchecked

[Dirs]
Name: "{commonappdata}\ResInvestERP"; Components: server; Permissions: users-modify; Flags: uninsneveruninstall

[Files]
; --- program (tryb lokalny; ten sam plik serwuje serwer) ---
Source: "..\ResInvest_ERP.html"; DestDir: "{app}"; Components: app; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Components: app; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; Components: app; Flags: ignoreversion
Source: "..\config\app.config.json"; DestDir: "{app}\config"; Components: app; Flags: ignoreversion
Source: "..\data\sample_data.json"; DestDir: "{app}\data"; Components: app; Flags: ignoreversion
Source: "..\docs\*.md"; DestDir: "{app}\docs"; Components: app; Flags: ignoreversion
Source: "..\tests\resinvest_demo_scenarios.md"; DestDir: "{app}\docs"; Components: app; Flags: ignoreversion
Source: "..\app\assets\fonts\LICENSE-OFL.txt"; DestDir: "{app}\docs"; DestName: "LICENSE-czcionki-OFL.txt"; Components: app; Flags: ignoreversion
; --- serwer: kod, silnik (wspólny z przeglądarką), konfiguracja, środowisko Node.js ---
Source: "..\server\*.mjs"; DestDir: "{app}\server"; Components: server; Flags: ignoreversion
Source: "..\app\src\*.js"; DestDir: "{app}\app\src"; Components: server; Flags: ignoreversion
Source: "..\package.json"; DestDir: "{app}"; Components: server; Flags: ignoreversion
Source: "..\config\server.config.json"; DestDir: "{app}\config"; Components: server; Flags: onlyifdoesntexist uninsneveruninstall
Source: "..\.env.example"; DestDir: "{app}\config"; Components: server; Flags: ignoreversion
; plik z kluczem poczty — tylko przy pierwszej instalacji; aktualizacja nie nadpisuje, odinstalowanie nie usuwa
Source: "..\.env.example"; DestDir: "{commonappdata}\ResInvestERP"; DestName: "server.env"; Components: server; Flags: onlyifdoesntexist uninsneveruninstall
Source: "runtime\node.exe"; DestDir: "{app}\runtime"; Components: server; Flags: ignoreversion
Source: "runtime\LICENSE-node.txt"; DestDir: "{app}\runtime"; Components: server; Flags: ignoreversion skipifsourcedoesntexist
Source: "scripts\*.cmd"; DestDir: "{app}"; Components: server; Flags: ignoreversion

[INI]
Filename: "{app}\ResInvest ERP (serwer).url"; Section: "InternetShortcut"; Key: "URL"; String: "{#AppURL}"; Components: server

[Icons]
Name: "{group}\{cm:LnkLocal}"; Filename: "{app}\ResInvest_ERP.html"; Components: app
Name: "{group}\{cm:LnkServer}"; Filename: "{app}\ResInvestERP-Serwer.cmd"; WorkingDir: "{app}"; Components: server
Name: "{group}\{cm:LnkOpen}"; Filename: "{app}\ResInvest ERP (serwer).url"; Components: server
Name: "{group}\{cm:LnkBackup}"; Filename: "{app}\ResInvestERP-Kopia.cmd"; WorkingDir: "{app}"; Components: server
Name: "{group}\{cm:LnkCheck}"; Filename: "{app}\ResInvestERP-Kontrola.cmd"; WorkingDir: "{app}"; Components: server
Name: "{group}\{cm:LnkData}"; Filename: "{commonappdata}\ResInvestERP"; Components: server
Name: "{group}\{cm:LnkEnv}"; Filename: "{sys}\notepad.exe"; Parameters: """{commonappdata}\ResInvestERP\server.env"""; Components: server
Name: "{group}\{cm:LnkDocs}"; Filename: "{app}\README.md"; Components: app
Name: "{group}\{uninstallexe}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{cm:LnkLocal}"; Filename: "{app}\ResInvest_ERP.html"; Tasks: desktopicon; Components: app and not server
Name: "{autodesktop}\{cm:LnkOpen}"; Filename: "{app}\ResInvest ERP (serwer).url"; Tasks: desktopicon; Components: server
Name: "{commonstartup}\{cm:LnkServer}"; Filename: "{app}\ResInvestERP-Serwer.cmd"; Parameters: "--no-open"; WorkingDir: "{app}"; Flags: runminimized; Tasks: autostart

[Run]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""ResInvest ERP Serwer"" dir=in action=allow protocol=TCP localport={#ServerPort} profile=private,domain"; Flags: runhidden; Tasks: firewall
Filename: "{app}\ResInvestERP-Serwer.cmd"; WorkingDir: "{app}"; Description: "{cm:RunServer}"; Flags: postinstall skipifsilent nowait runminimized; Components: server
Filename: "{app}\ResInvest_ERP.html"; Description: "{cm:RunLocal}"; Flags: shellexec postinstall skipifsilent nowait unchecked; Components: app

[UninstallRun]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""ResInvest ERP Serwer"""; Flags: runhidden; RunOnceId: "fw"; Tasks: firewall
Filename: "{sys}\taskkill.exe"; Parameters: "/F /FI ""WINDOWTITLE eq ResInvest ERP Serwer*"""; Flags: runhidden; RunOnceId: "stop"; Components: server

[UninstallDelete]
Type: files; Name: "{app}\ResInvest ERP (serwer).url"
