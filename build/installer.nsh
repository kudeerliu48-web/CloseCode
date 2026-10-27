; 自定义 NSIS 安装脚本
; 目的：确保在用户目录创建 CloseCode 数据文件夹（跨盘符通用）

!include LogicLib.nsh

!macro customInit
  ; 修改默认安装目录，自动添加 CloseCode 子文件夹
  ; 如果用户选择了 D:\，实际安装路径变为 D:\CloseCode\

  ; 获取当前安装目录
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\CloseCode"

  ; 如果是 perMachine 安装，使用 Program Files
  ${If} $PerMachine == "1"
    StrCpy $INSTDIR "$PROGRAMFILES\CloseCode"
  ${EndIf}
!macroend

!macro customInstall
  ; 安装后的自定义操作
  DetailPrint "正在配置 CloseCode..."

  ; 在用户目录创建 CloseCode 数据文件夹（所有盘符通用）
  ; Windows: C:\Users\用户名\DoCode\
  CreateDirectory "$APPDATA\DoCode"
  DetailPrint "已创建数据目录: $APPDATA\DoCode"

  ; 创建必要的子目录
  CreateDirectory "$APPDATA\DoCode\data"
  CreateDirectory "$APPDATA\DoCode\data\sessions"
  CreateDirectory "$APPDATA\DoCode\projects"
  CreateDirectory "$APPDATA\DoCode\wallpapers"
  DetailPrint "数据目录初始化完成"
!macroend

!macro customUnInit
  ; 卸载前的自定义操作
  ; 注意：不删除 $APPDATA\DoCode 目录，保留用户数据
!macroend
