; =========================================================================
;  ResInvest ERP — Demo v2.4 (2.4.0) · instalator Windows (Inno Setup 6)
;
;  Budowanie (Windows):
;    1. npm run build                      (tworzy ResInvest_ERP_demo.html)
;    2. "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\ResInvestERP_Demo.iss
;    albo:  powershell -File installer\build-installer.ps1
;  Wynik: installer\Output\ResInvestERP_Demo_Setup_2.4.0.exe
;
;  Instalator kopiuje samodzielny plik HTML (bez serwera, bez internetu),
;  dokumentację i dane przykładowe; tworzy skróty w menu Start i na pulpicie.
;  Dane demonstratora są zapisywane w przeglądarce (localStorage) — odinstalowanie
;  nie usuwa ich; kopię zapasową wykonuje się w programie (Dane i ustawienia).
; =========================================================================

#define AppName "ResInvest ERP — demonstrator"
#define AppVersion "2.4.0"
#define AppPublisher "ResInvest Commodities"

[Setup]
AppId={{8C1B7E52-3E0B-4B7A-9E0D-5B2D6A1F4C10}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\ResInvest ERP Demo
DefaultGroupName=ResInvest ERP
DisableProgramGroupPage=yes
LicenseFile=..\LICENSE
OutputDir=Output
OutputBaseFilename=ResInvestERP_Demo_Setup_{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
UninstallDisplayName={#AppName} {#AppVersion}

[Languages]
Name: "polish"; MessagesFile: "compiler:Languages\Polish.isl"

[Tasks]
Name: "desktopicon"; Description: "Utwórz skrót na pulpicie"; GroupDescription: "Skróty:"

[Files]
Source: "..\ResInvest_ERP_demo.html"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\config\demo.config.json"; DestDir: "{app}\config"; Flags: ignoreversion
Source: "..\data\sample_data.json"; DestDir: "{app}\data"; Flags: ignoreversion
Source: "..\docs\*.md"; DestDir: "{app}\docs"; Flags: ignoreversion
Source: "..\tests\resinvest_demo_scenarios.md"; DestDir: "{app}\docs"; Flags: ignoreversion
Source: "..\TASKS.md"; DestDir: "{app}\docs"; Flags: ignoreversion
Source: "..\demo\assets\fonts\LICENSE-OFL.txt"; DestDir: "{app}\docs"; DestName: "LICENSE-czcionki-OFL.txt"; Flags: ignoreversion

[Icons]
Name: "{group}\ResInvest ERP — demonstrator"; Filename: "{app}\ResInvest_ERP_demo.html"
Name: "{group}\Scenariusze testowe"; Filename: "{app}\docs\resinvest_demo_scenarios.md"
Name: "{group}\Odinstaluj"; Filename: "{uninstallexe}"
Name: "{autodesktop}\ResInvest ERP — demonstrator"; Filename: "{app}\ResInvest_ERP_demo.html"; Tasks: desktopicon

[Run]
Filename: "{app}\ResInvest_ERP_demo.html"; Description: "Uruchom demonstrator"; Flags: shellexec postinstall skipifsilent nowait
