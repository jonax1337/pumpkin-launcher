!include TextFunc.nsh

; Real legacy paths must never be consulted by side-by-side QA products.
!if "${PRODUCTNAME}" == "Pumpkin Launcher"
!if "${BUNDLEID}" == "dev.laux.launcher"
  !define PUMPKIN_LEGACY_PRODUCT_KEY "Software\laux\Pumpkin Launcher"
  !define PUMPKIN_LEGACY_DATA_NAME "dev.laux.launcher"
!endif
!endif

Var InstancesDir
Var InstancesMetadataDir
Var InstancesInput
Var InstancesPageShown
Var InstancesRequestWritten

Function ReadInstancesPath
  ; $0 is the candidate metadata directory; missing/invalid files leave the fallback unchanged.
  ClearErrors
  FileOpen $1 "$0\instances-path.txt" r
  IfErrors instances_read_done
  FileReadByte $1 $2
  FileReadByte $1 $3
  ${If} $2 == 255
  ${AndIf} $3 == 254
    FileSeek $1 2 SET
    FileReadUTF16LE $1 $2
    ${TrimNewLines} $2 $2
    StrCpy $3 $2 1 -1
    ${If} $3 == "\"
      StrCpy $2 $2 -1
    ${EndIf}
    !ifdef PUMPKIN_LEGACY_DATA_NAME
      ${If} $2 == "$APPDATA\${PUMPKIN_LEGACY_DATA_NAME}\instances"
        StrCpy $2 ""
      ${EndIf}
    !endif
    ; A path inside launcher metadata is the old default, not a user-chosen location.
    ${If} $2 != ""
    ${AndIf} $2 != "$0\instances"
      StrCpy $InstancesDir $2
    ${EndIf}
  ${EndIf}
  FileClose $1
  instances_read_done:
  ClearErrors
FunctionEnd

Function InitializeInstancesPath
  StrCpy $InstancesDir "$DOCUMENTS\${PRODUCTNAME}\Instances"
  StrCpy $InstancesMetadataDir "$APPDATA\${PRODUCTNAME}"
  !ifdef PUMPKIN_LEGACY_DATA_NAME
    StrCpy $0 "$APPDATA\${PUMPKIN_LEGACY_DATA_NAME}"
    Call ReadInstancesPath
    ; Do not create the friendly migration destination merely to leave a request.
    ${IfNot} ${FileExists} "$APPDATA\${PRODUCTNAME}\*.*"
    ${AndIf} ${FileExists} "$APPDATA\${PUMPKIN_LEGACY_DATA_NAME}\*.*"
      StrCpy $InstancesMetadataDir "$APPDATA\${PUMPKIN_LEGACY_DATA_NAME}"
    ${EndIf}
  !endif
  StrCpy $0 "$APPDATA\${PRODUCTNAME}"
  Call ReadInstancesPath
FunctionEnd

Function PageInstances
  ${If} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
  ${OrIf} ${Silent}
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "$(PumpkinInstancesTitle)" "$(PumpkinInstancesHint)"
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 48u "$(PumpkinInstancesText)"
  Pop $0
  ${NSD_CreateLabel} 0 58u 100% 12u "$(PumpkinInstancesFolder)"
  Pop $0
  ${NSD_CreateDirRequest} 0 74u 76% 14u "$InstancesDir"
  Pop $InstancesInput
  ${NSD_CreateBrowseButton} 79% 73u 21% 16u "$(PumpkinBrowse)"
  Pop $0
  ${NSD_OnClick} $0 BrowseInstances
  StrCpy $InstancesPageShown 1
  Call PumpkinApplyTheme
  nsDialogs::Show
FunctionEnd

Function BrowseInstances
  Pop $0
  ${NSD_GetText} $InstancesInput $0
  nsDialogs::SelectFolderDialog "$(PumpkinInstancesTitle)" "$0"
  Pop $0
  ${If} $0 != error
    ${NSD_SetText} $InstancesInput "$0"
  ${EndIf}
FunctionEnd

Function PageLeaveInstances
  ${NSD_GetText} $InstancesInput $InstancesDir
  ${If} $InstancesDir == ""
    Goto instances_invalid
  ${EndIf}
  ; Require a drive-qualified absolute path or UNC path, not drive-relative or root-relative.
  StrCpy $0 $InstancesDir 2
  StrCpy $1 $InstancesDir 2 1
  ${If} $0 != "\\"
  ${AndIf} $1 != ":\"
    Goto instances_invalid
  ${EndIf}
  ${StrLoc} $0 $InstancesDir "$\r" ">"
  ${If} $0 != ""
    Goto instances_invalid
  ${EndIf}
  ${StrLoc} $0 $InstancesDir "$\n" ">"
  ${If} $0 != ""
    Goto instances_invalid
  ${EndIf}
  ; GetFullPathNameW does not require the parent folder to exist (NSIS GetFullPathName does).
  System::Call 'kernel32::GetFullPathNameW(w "$InstancesDir", i ${NSIS_MAX_STRLEN}, w .r2, p 0) i.r0'
  ${If} $0 == 0
  ${OrIf} $0 >= ${NSIS_MAX_STRLEN}
  ${OrIf} $2 == ""
    Goto instances_invalid
  ${EndIf}
  StrCpy $InstancesDir $2
  System::Call 'shlwapi::PathIsRootW(w "$InstancesDir") i.r0'
  ${If} $0 != 0
    Goto instances_invalid
  ${EndIf}
  ; Compare folders without a trailing separator (the root check above already ran).
  StrCpy $0 $InstancesDir 1 -1
  ${If} $0 == "\"
    StrCpy $InstancesDir $InstancesDir -1
  ${EndIf}
  ; A program directory can be replaced during updates. Never put worlds there.
  StrLen $0 $INSTDIR
  StrCpy $1 $InstancesDir $0
  ${If} $1 == $INSTDIR
    StrCpy $1 $InstancesDir 1 $0
    ${If} $1 == ""
    ${OrIf} $1 == "\"
      Goto instances_invalid
    ${EndIf}
  ${EndIf}
  ${If} $InstancesDir == $WINDIR
  ${OrIf} $InstancesDir == $SYSDIR
  ${OrIf} $InstancesDir == $PROGRAMFILES
  ${OrIf} $InstancesDir == $PROGRAMFILES64
  ${OrIf} $InstancesDir == $APPDATA
  ${OrIf} $InstancesDir == $LOCALAPPDATA
  ${OrIf} $InstancesDir == $InstancesMetadataDir
    Goto instances_invalid
  ${EndIf}
  ; The profile container and its well-known personal folders hold unrelated user data.
  ${GetParent} "$PROFILE" $0
  ${If} $InstancesDir == $0
  ${OrIf} $InstancesDir == $PROFILE
  ${OrIf} $InstancesDir == $DOCUMENTS
  ${OrIf} $InstancesDir == $DESKTOP
  ${OrIf} $InstancesDir == "$PROFILE\Downloads"
    Goto instances_invalid
  ${EndIf}
  ; Downloads may be redirected; ask the shell for FOLDERID_Downloads.
  System::Call 'shell32::SHGetKnownFolderPath(g "{374DE290-123F-4565-9164-39C4925E467B}", i 0, p 0, *p .r1) i.r2'
  ${If} $2 == 0
    System::Call '*$1(&w${NSIS_MAX_STRLEN} .r3)'
    System::Call 'ole32::CoTaskMemFree(p r1)'
    ${If} $3 != ""
    ${AndIf} $InstancesDir == $3
      Goto instances_invalid
    ${EndIf}
  ${EndIf}
  Return
  instances_invalid:
  MessageBox MB_OK|MB_ICONEXCLAMATION "$(PumpkinInstancesInvalid)"
  Abort
FunctionEnd

Function WriteInstancesRequest
  ${If} $InstancesPageShown != 1
  ${OrIf} $InstancesRequestWritten == 1
  ${OrIf} $UpdateMode = 1
    Return
  ${EndIf}
  ClearErrors
  CreateDirectory "$InstancesMetadataDir"
  IfErrors instances_write_failed
  GetTempFileName $2 "$InstancesMetadataDir"
  IfErrors instances_write_failed
  FileOpen $0 "$2" w
  IfErrors instances_write_cleanup
  FileWriteByte $0 255
  FileWriteByte $0 254
  FileWriteUTF16LE $0 "$InstancesDir$\r$\n"
  IfErrors instances_write_close_failed
  FileClose $0
  IfErrors instances_write_cleanup
  System::Call 'kernel32::MoveFileExW(w "$2", w "$InstancesMetadataDir\instances-path-request.txt", i 9) i.r0'
  ${If} $0 == 0
    Goto instances_write_cleanup
  ${EndIf}
  StrCpy $InstancesRequestWritten 1
  Return
  instances_write_close_failed:
  FileClose $0
  instances_write_cleanup:
  Delete "$2"
  instances_write_failed:
  MessageBox MB_OK|MB_ICONEXCLAMATION "$(PumpkinInstancesWriteFailed)"
  ClearErrors
FunctionEnd

!macro PumpkinRemoveAccountPresets ROOT
  ; Never recurse: old instances and externally selected instance roots are not uninstall data.
  Delete "${ROOT}\accounts.json"
  Delete "${ROOT}\skins.json"
  Delete "${ROOT}\templates.json"
!macroend
