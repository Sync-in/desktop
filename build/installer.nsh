!macro customUnInstall
${ifNot} ${isUpdated}
  RMDir /r "$APPDATA\Sync-in-Profile"
${endIf}
!macroend
