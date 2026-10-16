; The unpacked Theia runtime contains paths longer than MAX_PATH. Opt both
; installer and uninstaller into Windows long-path support.
ManifestLongPathAware true

; Retain electron-builder's atomic update and rollback, with an actionable
; diagnostic if Windows refuses to move an installed file.
!macro customRemoveFiles
  ${if} ${isUpdated}
    CreateDirectory "$PLUGINSDIR\old-install"
    Push ""
    Call un.atomicRMDir
    Pop $R0
    ${if} $R0 != 0
      DetailPrint "Cannot replace installed file: $R0"
      FileOpen $R1 "$TEMP\Singularity-uninstall-error.log" a
      FileWrite $R1 "Cannot replace installed file: $R0$\r$\n"
      FileClose $R1
      Push ""
      Call un.restoreFiles
      Pop $R0
      Abort 'Cannot replace installed files. See $TEMP\Singularity-uninstall-error.log.'
    ${endif}
  ${endif}
  SetOutPath $TEMP
  RMDir /r $INSTDIR
!macroend
