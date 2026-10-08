!ifndef PUMPKIN_THEME_INCLUDED
!define PUMPKIN_THEME_INCLUDED

!addplugindir /x86-unicode "${__FILEDIR__}"
SetFont "Hanken Grotesk" 10
!define PUMPKIN_INSTALLER_DIR "${__FILEDIR__}\.."

!macro PumpkinInitTheme HEADER
  InitPluginsDir
  !if "${SIDEBARIMAGE}" != ""
    File "/oname=$PLUGINSDIR\pumpkin-sidebar.bmp" "${SIDEBARIMAGE}"
    !define PUMPKIN_SIDEBAR_PATH "$PLUGINSDIR\pumpkin-sidebar.bmp"
  !else
    !define PUMPKIN_SIDEBAR_PATH ""
  !endif
  !if "${HEADER}" != ""
    File "/oname=$PLUGINSDIR\pumpkin-header.bmp" "${HEADER}"
    !define PUMPKIN_HEADER_PATH "$PLUGINSDIR\pumpkin-header.bmp"
  !else
    !define PUMPKIN_HEADER_PATH ""
  !endif
  PumpkinTheme::InitTheme /NOUNLOAD "${PUMPKIN_SIDEBAR_PATH}" "${PUMPKIN_HEADER_PATH}"
  !undef PUMPKIN_SIDEBAR_PATH
  !undef PUMPKIN_HEADER_PATH
!macroend

!define MUI_CUSTOMFUNCTION_GUIINIT PumpkinApplyTheme
!define MUI_CUSTOMFUNCTION_UNGUIINIT un.PumpkinApplyTheme

Function PumpkinApplyTheme
  PumpkinTheme::Apply /NOUNLOAD
FunctionEnd

Function un.PumpkinApplyTheme
  PumpkinTheme::Apply /NOUNLOAD
FunctionEnd

!endif
