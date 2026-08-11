# Audio Switcher

一个面向 Windows 的轻量音频设备切换器，专门解决电脑上存在多套扬声器、耳机、桌面麦克风、虚拟麦克风时，切换设备麻烦的问题。

## 为什么做它

Windows 系统自带的音频设备切换入口层级较深，正在游戏、会议、直播或录屏时，频繁切换输入输出设备会打断当前操作。

Audio Switcher 将常用的音频控制放进一个小巧的灵动岛式悬浮面板中：

- 一眼看到当前使用的输出设备和输入设备
- 点击设备图标即可快速静音或解除静音
- 点击空白区域展开设备面板
- 在同一个面板里切换多套输出设备和输入设备
- 直接调整当前设备音量
- 支持设备数量较多时在列表区域独立滚动
- 支持 `Pill` 独立悬浮模式和 `Attached` 顶部贴合模式
- 支持托盘、开机自启和全局快捷键

## 界面理念

界面保持纯黑、低干扰和紧凑布局。收起时只显示扬声器与麦克风两个控制图标，展开后才显示对应的设备列表，避免面板长期遮挡正在使用的应用。

它不是一个完整的音频工作站，而是一个专注于“多套设备快速切换”的 Windows 小工具。

## 技术栈

- [Tauri 2](https://tauri.app/)
- React 19
- HeroUI
- Framer Motion
- Rust Windows Core Audio API

## 开发

环境要求：

- Windows
- Node.js
- Rust stable
- Tauri 2 所需的 Windows 开发环境

安装依赖并启动开发模式：

```bash
npm install
npm run tauri:dev
```

构建 Windows 应用：

```bash
npm run tauri:build
```

## 项目结构

```text
src/                 React 界面、动画和样式
src-tauri/src/audio.rs  Windows 音频设备枚举与控制
src-tauri/src/lib.rs    Tauri 命令、托盘和窗口逻辑
src-tauri/tauri.conf.json  Tauri 应用配置
```

## License

License 待补充。
