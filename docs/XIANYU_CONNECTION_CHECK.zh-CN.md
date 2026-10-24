# 闲鱼消息连接策略核实（2026-10-24）

仅查看公开页面与公开前端脚本；未读取登录状态、Cookie、聊天正文或私有接口，未发送聊天消息，也未使用鉴权令牌。

- 公开消息页：[https://www.goofish.com/im](https://www.goofish.com/im)。
- 页面加载的公开脚本：[p_im-index.js](https://g.alicdn.com/idle-pc/xy-site/0.0.179/js/p_im-index.js)。
- 同版布局脚本：[p_layout.js](https://g.alicdn.com/idle-pc/xy-site/0.0.179/js/p_layout.js)。
- 公开 IM 脚本 SHA-256：`ec9c8491cc0ef9366f8491ae5d68ec0b8d44620129078136c245b4b126770093`。

公开脚本的正式 goofish 配置指定 `wss://wss-goofish.dingtalk.com:443`，随后作为 `wsUrl` 传入 IMPaas。公开 ACCS 初始化指定 `msgacs.m.taobao.com` 代理及 `wss:` 协议，其 URL 构造方法使用 `/accs/auth` 路径和运行期令牌参数；本次没有获取该参数或调用鉴权。

此前请求策略及请求主机提取都只接受 HTTPS，因此会在两个位置拒绝这些 WSS 握手。修复只允许上述两个精确主机、WSS 默认 443、GET 和 Electron `webSocket` 资源类型；ACCS 进一步限制 `/accs/auth` 路径。普通页面导航、其他钉钉／淘宝主机、非 443 端口、明文 WS、用户信息和尾点主机仍拒绝。继续检查联网开关和公开 DNS。

Electron 资源类型大小写依据：[WebRequest 官方文档](https://www.electronjs.org/docs/latest/api/web-request#webrequestonbeforerequestfilter-listener)。

该证据确认旧策略会阻断官方脚本需要的连接，但不能证明这是用户截图断连的唯一原因。真实账号登录、服务器响应、代理兼容及实际聊天连接仍待真实站点验收；不能用页面加载或本地夹具代替聊天连接成功。

独立窗口销毁崩溃已由严格 BrowserWindow mock 重现：`closed` 回调再次读取已销毁窗口的 `webContents` getter，主进程抛出 `TypeError: Object has been destroyed`。修复提前捕获 WebContents，并让关闭清理只使用该引用。
