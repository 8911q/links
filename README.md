- ## 主界面效果图

![主界面效果图](https://raw.githubusercontent.com/relieved2025/blog-pic/main/202603131349741.png)

- ## 后台管理效果图

![后台管理效果图](https://raw.githubusercontent.com/relieved2025/blog-pic/main/202603131349622.jpg)

- ## 部署指南

  ### 第一步：创建 KV 命名空间

  该短链工具依赖两个 KV 数据库：一个存储链接数据，一个存储验证码。

  1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)。
  2. 导航至 **Workers & Pages** > **KV**。
  3. 点击 **Create a namespace**，分别创建以下两个空间：
     - 名称：`LINKS_KV`
     - 名称：`CAPTCHAS_KV`
  4. 记录下它们的名称，稍后需要绑定。

  ### 第二步：创建并配置 Worker

  1. 在 **Workers & Pages** > **Overview** 中点击 **Create application**。
  2. 点击 **Create Worker**，随便取个名字（如 `my-shortener`），点击 **Deploy**。
  3. 进入该 Worker 页面，点击 **Edit Code**。
  4. 将 [worker.js](https://github.com/8911q/links/blob/main/worker.js) 的完整代码粘贴进去，点击 **Save and Deploy**。

  ------

  ### 第三步：设置环境变量

  为了确保安全，必须在控制台手动设置敏感变量：

  1. 在 Worker 的管理界面，点击 **Settings** 选项卡。
  2. 选择 **Variables** 栏目。
  3. 在 **Environment Variables** 下点击 **Add variable**，添加以下三个项：
     - **ADMIN_USER**: 你的后台登录名（如 `my_admin`）。
     - **ADMIN_PASS**: 你的后台密码。
     - **ADMIN_PATH**: 后台访问路径，**必须以 `/` 开头**（如 `/manage_links`）。
  4. 点击 **Save and deploy**。

  ------

  ### 第四步：绑定 KV 命名空间

  这是代码能够读写数据库的关键步骤：

  1. 依然在 **Settings** > **Variables** 页面。
  2. 向下滚动到 **KV Namespace Bindings**。
  3. 点击 **Add binding**：
     - **Variable name**: 输入 `LINKS_KV`，在右侧下拉框选择你刚才创建的对应空间。
     - 再次点击 **Add binding**，**Variable name**: 输入 `CAPTCHAS_KV`，选择对应的空间。
  4. 点击 **Save and deploy**。

  ------

  ### 第五步：测试运行

  1. **前端页面**：访问你的 Worker 默认域名（如 `https://xxx.workers.dev/`），你应该能看到生成器界面。
  2. **验证码**：如果验证码图片能正常显示并刷新，说明 KV 绑定和代码逻辑无误。
  3. **管理后台**：访问 `你的域名/你设置的ADMIN_PATH`。浏览器会弹出身份验证框，输入你设置的环境变量即可进入。

  ------

  ## 💡 后续维护建议

  - **自定义域名**：在 Worker 的 **Triggers** 选项卡中，点击 **Add Custom Domain**，可以绑定你自己的短域名。
  - **代码更新**：如果你需要增加功能，请务必保留现有的环境变量读取逻辑 和功能完整性。
