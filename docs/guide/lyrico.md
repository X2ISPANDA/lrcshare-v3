# 在 Lyrico 中使用 LrcShare API

Lyrico 是安卓平台的音乐标签编辑器，支持通过插件接入自定义搜索源。装好 LrcShare 插件后，你可以直接在 Lyrico 里搜索 LrcShare 的歌词库，一次点击把**歌词、专辑封面、流派、词曲作者、曲目号**等标签写进音频文件——署名信息（`comment`）也会自动带上。

## 第一步：安装 Lyrico

前往 Lyrico 的 Releases 页面下载 APK：

> https://github.com/Replica0110/Lyrico/releases

认准最新版本（**v1.5.0 或更高**，插件协议需 API 4）下的 `.apk` 文件：

| 文件 | 适用设备 |
| --- | --- |
| `Lyrico-x.x.x-xxx-arm64-v8a.apk` | 绝大多数近几年的手机 |
| `Lyrico-x.x.x-xxx-armeabi-v7a.apk` | 老旧机型 |

不确定选哪个就下 `arm64-v8a`。下载后传到手机安装（需允许「安装未知来源应用」）。

## 第二步：下载 LrcShare 插件

前往 Lyrico 插件仓库的 Releases 页面：

> https://github.com/Replica0110/Lyrico-Plugins/releases

在最新 Release 的 Assets 里找到 **`com.lrcshare.source-x.x.x.zip`**（单插件包，文件名以 `com.lrcshare.source` 开头）下载，传到手机。**不要解压**，Lyrico 直接导入 zip。

::: tip
也可以下载聚合包 `Lyrico-Plugins.zip`（含全部官方插件），导入后在插件列表里只启用 LrcShare 即可。
:::

## 第三步：导入插件

![打开 Lyrico 主界面，点击设置按钮](/guide/lyrico/step-1.png){.lyrico-shot}

打开 Lyrico 主界面，点击右上角**设置按钮**。

![找到插件管理菜单](/guide/lyrico/step-2.png){.lyrico-shot}

在设置中找到**插件管理**菜单。

![点击加号添加插件](/guide/lyrico/step-3.png){.lyrico-shot}

点击右上角**加号**添加插件。

![在手机中找到插件 zip 所在目录并选中](/guide/lyrico/step-4.png){.lyrico-shot}

在文件选择器中找到你存放插件 zip 的目录，选中 `com.lrcshare.source-x.x.x.zip`，插件就导入完成了。无需任何配置——LrcShare API 匿名调用，没有 API Key 要填。

## 第四步：搜索并应用标签

![点击歌曲进入歌曲主页，点击上方的放大镜按钮进行搜索](/guide/lyrico/step-5.png){.lyrico-shot}

点击歌曲进入歌曲主页，点击上方的**放大镜按钮**进行搜索。

![下方显示 LrcShare 的音乐标签源](/guide/lyrico/step-6.png){.lyrico-shot}

下方会显示 LrcShare 的音乐标签源，选中正确的结果。

![点击应用](/guide/lyrico/step-7.jpg){.lyrico-shot}

点击**应用**，歌词、封面、流派、词曲作者等标签就一次性写入音频文件了。

## 常见问题

### 搜索没有任何结果？

LrcShare 是**小众人工整理曲库**（以中文说唱为主），库里没有这首歌就会返回空。可以先去 [LrcShare 主站](https://lrcshare.com) 搜一下确认这首歌是否在库——主站搜得到，Lyrico 里就搜得到。

### 下载的歌没有标签信息，搜索词是空的？

Lyrico 的搜索词由歌曲文件里的标签（歌名/艺术家）拼接而来。**如果你下载的歌本身没有任何标签，搜索词会是空的**——请先在 Lyrico 的歌曲编辑页手动补填歌名和艺术家（不用很精确，大致正确即可），再进行搜索。

### 插件更新了要重新下载吗？

是。插件新版本仍从 [Lyrico-Plugins 的 Releases](https://github.com/Replica0110/Lyrico-Plugins/releases) 下载，在插件管理里删旧导新即可。LrcShare 插件自带 24 小时目录缓存：每天第一次搜索会多花一两秒拉取全库目录，之后库里没有的歌会**直接跳过网络请求**，批量打标更快也更省流量。
