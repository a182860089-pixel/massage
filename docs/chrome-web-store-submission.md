# Chrome Web Store 提交说明

## 单一用途

该扩展的唯一用途是：

- 在 `chatgpt.com` / `chat.openai.com` 页面中保存当前对话
- 导出为 HTML、Markdown、PDF、JSON
- 保存当前会话里的上传文件、生成文件与上下文文件
- 在当前会话范围内补抓历史文件

## 权限说明

### `storage`

用于保存用户的导出设置、保存目录授权状态、自动保存开关、使用统计与卡密状态缓存。

### `downloads`

用于目录未授权时的下载兜底保存，以及少量浏览器下载能力相关的回退路径。

### `alarms`

用于定时刷新插件公告配置缓存，不读取用户对话内容。

### Host permissions

- `https://chatgpt.com/*`
- `https://chat.openai.com/*`

用途：

- 读取当前页面中的对话内容
- 监听当前会话的变化
- 调用 ChatGPT 官方文件下载接口以保存当前会话中的生成文件或补抓文件

- `https://seat.20050225.xyz/api/plugin/card-keys/*`

用途：

- 卡密激活
- 卡密状态校验
- 换绑设备
- 获取插件公告配置

## 数据使用说明

### 会发送到 `seat.20050225.xyz` 的数据

- 卡密
- 绑定邮箱
- 插件生成的客户端标识 `client_id`

### 不会发送到 `seat.20050225.xyz` 的数据

- ChatGPT 对话正文
- 用户导出的 HTML / Markdown / PDF / JSON 内容
- 用户上传文件或 ChatGPT 生成文件的文件内容
- 用户选择的本地文件夹路径

### 本地保存的数据

- 导出设置与保存目录授权状态
- 卡密状态缓存
- 对话导出内容
- 当前会话中的上传文件、生成文件与上下文 JSON

## 审核关注点说明

### 主世界注入

扩展在 ChatGPT 页面注入 `src/content/fetchInterceptor.js`，仅用于识别当前会话中的生成文件和上传文件候选，范围限定在 `chatgpt.com` / `chat.openai.com`，不在其他网站执行。

### 远程配置

远程服务只返回公告文本和升级链接配置，不返回可执行代码。扩展的所有逻辑都打包在扩展内部，不执行远程脚本。

### 联网范围

除 ChatGPT 官方域名外，第三方联网仅限 `seat.20050225.xyz/api/plugin/card-keys/*`。
