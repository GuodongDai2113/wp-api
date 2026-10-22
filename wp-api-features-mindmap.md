# wp-api MCP 服务功能全景

## 一、项目定位与整体能力

- 纯 Model Context Protocol（MCP）服务
  - 通过 STDIO 与 MCP host 通信
  - 面向 WordPress 站点管理
  - 暴露 55 个结构化工具
- 对接四类 WordPress REST API
  - 原生 WordPress REST API
  - Jelly Core
  - Jelly Catalog
  - Inquiry（Jelly Form）
- 产品能力面向 Jelly Catalog
  - 不作 WooCommerce 产品接口使用
  - 支持 product 与 product_cat 路由
- 多入口
  - wp-api-mcp：MCP STDIO 服务入口
  - wp-api-config：本地凭据配置网页入口
- 技术栈
  - Node.js 20.9+
  - TypeScript
  - @modelcontextprotocol/sdk
  - zod 输入校验
  - sharp 图像处理
  - parse5 HTML5 解析
  - archiver ZIP 打包

## 二、客户端与凭据管理

- 凭据配置网页 wp-api-config
  - 仅监听 127.0.0.1 随机端口
  - 自动打开默认浏览器
  - 新增 / 编辑 / 删除 / 测试连接
  - 密码保存后不再回显
  - 编辑时留空表示保留原密码
  - 15 分钟无活动自动退出
  - 不读取旧版明文配置
- 加密存储
  - 默认目录 ~/.wp-api/
  - vault.json：AES-256-GCM 密文
  - vault.key：每主机随机 256 位密钥
  - 原子替换写入
  - 跨进程文件锁
  - 支持 WP_API_CONFIG_DIR 自定义目录
  - 构建产物与 npm 包不含凭据
- 客户端查询工具
  - wp_client_list：列出全部连接名称与站点 URL
  - wp_client_get：按名称读取单个连接
  - 均不返回用户名、密码或密码状态
  - 不支持通过 MCP 新增、编辑、删除连接
- 调用约定
  - 远端工具需显式传入 client
  - siteUrl 可选，仅能改同源路径
  - 凭据使用 WordPress Application Password
  - HTTP Basic Authentication

## 三、结构发现与 REST Schema

- wp_structure_get
  - 纯本地、无需 client
  - 提供稳定用法指南
  - 支持结构目录
    - post / page / product
    - category / product-category
    - menu / media / seo-meta / elementor-page
  - 分段按需返回
    - overview 概览（默认）
    - write 写入字段
    - response 响应字段
    - example 示例
    - full 完整兼容结构
- wp_api_route
  - 公开只读 HTTPS 查询
  - 不接受 client / siteUrl
  - 仅接受裸 domain
  - 永不发送本地凭据
  - 分层按需披露
    - overview：命名空间与路由数量
    - routes / search：路由目录
    - apiPath：方法与字段数量
    - arguments：参数目录
    - fields：响应字段目录
    - names + full：完整定义
  - 目录分页 search / offset / limit
  - 兼容 detail: summary / full
- wp_catalog_fields_get
  - 认证读取 Jelly Catalog 字段目录
  - target：product | product_cat
  - 返回 dynamic_fields 标签、类型、选项
  - 返回完整重复组子字段 schema
  - 返回 meta_schema、endpoint、更新规则
  - 不提供字段定义的远程新增/删除/停用
- 动态字段工作流
  - 先 wp_catalog_fields_get 发现可填字段
  - 再 wp_resource_get（context: edit）读取现值
  - 再 wp_resource_update 提交 data.meta / metaFile
  - 更新后再次读取确认

## 四、WordPress 资源管理（8 个工具）

- 资源类型
  - posts（文章）
  - pages（页面）
  - products（Jelly Catalog 产品）
  - categories（文章分类）
  - product-categories（产品分类）
- 判别联合 target
  - type: post → posts / pages / products
  - type: taxonomy → categories / product-categories
  - 类型与资源不匹配时请求前报错
- 查询能力
  - wp_resource_count：读取过滤后总数
  - wp_resource_list：分页列表（perPage 1..100）
  - wp_resource_get：按 ID 读取
  - wp_resource_get 支持 context: view | edit
- 写入能力
  - wp_resource_create：单条创建
  - wp_resource_update：单条更新
  - wp_resource_delete：删除（文章可回收站）
- 批量能力
  - wp_resource_batch_create：批量创建
  - wp_resource_batch_update：批量更新
  - 通过 batch/v1 每批 25 条
  - 支持内联 items 或 CSV 导入
  - 单请求 ≤ 8 MiB
  - 单次调用 ≤ 25 MiB
  - 联网前完成大小校验
- 内容字段
  - title / slug / status / excerpt
  - content 或 contentFile（content 优先）
  - gutenberg：HTML 转 Gutenberg 区块
  - featuredMedia：附件 ID，0 清空
  - categories：自动映射文章/产品分类
  - meta 或 metaFile（两者不可同时）
- 分类字段
  - name / slug / description
  - parent：0 移除父级
  - meta 或 metaFile
- CSV 导入导出
  - 文章表头：id,title,slug,status,excerpt,content,gutenberg,featuredMedia,categories,meta
  - 分类表头：id,name,slug,description,parent,meta
  - 严格表头校验
  - 空单元格省略，__EMPTY__ 显式清空
  - 数组与 meta 使用 JSON
  - 按每页 100 条增量导出
  - 动态跟随 X-WP-TotalPages
  - 排他硬链接原子发布，避免覆盖
- 删除语义
  - 文章/页面/产品默认进回收站
  - force: true 永久删除
  - taxonomy 无回收站，强制 force: true
- Jelly Catalog 产品 meta
  - _product_sku / product_sku
  - _product_videourl
  - product_file（附件 ID）
  - _product_image_gallery（逗号分隔 ID）
  - _product_attributes（规格行）
  - _product_faqs（问答行）
- Jelly Catalog 产品分类 meta
  - thumbnail_id / banner_id
  - category_h1_title / category_subtitle
  - category_why_choose_title / category_why_choose
  - category_advantages
  - category_applications_title / category_applications
  - category_cta_title / category_cta_button_text
  - category_buying_guide_title / category_buying_guide
  - category_faq_title / product_cat_faqs
  - category_inherit_parent_content（"0"/"1"）
- Meta 更新规则
  - 省略键保持原值
  - null 删除 Meta
  - 0、空字符串、空数组原样传递
  - 重复组整体替换，不按行合并
  - 数字用 JSON number，开关用 0/1
  - 以实时目录 schema 为最终依据

## 五、经典导航菜单管理（8 个工具）

- 菜单管理
  - wp_menu_list：列出菜单与主题位置分配
  - wp_menu_get：读取菜单及有序菜单项
  - wp_menu_create：创建菜单
  - wp_menu_update：更新菜单
  - wp_menu_delete：永久删除（必须 force: true）
- 菜单项管理
  - wp_menu_item_create：创建菜单项
  - wp_menu_item_update：更新菜单项
  - wp_menu_item_delete：删除菜单项
- 支持的菜单项类型
  - custom 自定义链接
  - post_type 文章类型
  - taxonomy 分类法
  - post_type_archive 文章类型归档
- 层级与排序
  - 支持 parent 调整层级
  - 支持 menuOrder 调整顺序
  - 支持 menuId 移动所属菜单
- 位置分配
  - locations 会替换该菜单全部分配
  - 分配前应先 wp_menu_list
  - 改层级/顺序前应先 wp_menu_get
- 删除语义
  - 菜单项默认进回收站
  - force: true 永久删除
  - 菜单无回收站，永久删除

## 六、SEO 管理（Rank Math）

- 读取与写入
  - wp_seo_get：读取 SEO 字段
  - wp_seo_update：更新或显式清空
  - wp_seo_list：分页列表或导出 CSV
  - wp_seo_batch_update：批量/CSV 更新
- 管理的字段
  - rank_math_title
  - rank_math_description
  - rank_math_focus_keyword
- 列表与导出
  - 内联结果分页 perPage 1..100
  - outputFile 时导出全部匹配
  - 无过滤的 posts 可导出整站
  - 固定四列 CSV
  - 空导入单元格显式清空
  - 与资源导出共用动态分页与原子发布
- 批量更新
  - 通过 batch/v1 每批 25 条
  - 内联 items 可省略不修改字段
  - CSV 四列必须完整
  - 单项错误记录后继续
  - 传输/协议错误终止调用
- 前置要求
  - Jelly SEO 或等效插件
  - meta 注册 show_in_rest
  - 当前用户具备编辑权限

## 七、文章正文编辑

- wp_post_link
  - list：列出正文链接
  - add：为可见文本添加链接
  - update：更新匹配链接（newHref/newText）
  - remove：移除链接保留锚文本
  - 支持 text 过滤
  - 仅允许 HTTP(S) 或安全相对 URL
  - 无控制字符
- wp_post_content_replace
  - 替换正文所有精确匹配文本
  - replacement: "" 表示删除匹配
  - 读取 context=edit 的 raw content
  - 需要编辑权限

## 八、媒体管理（12 个工具）

- 上传
  - wp_media_upload：单文件上传
  - wp_media_batch_import：批量导入 1..100 个
  - 支持 post 参数关联父文章
  - post: 0 表示不关联
  - 支持分类、标题、替代文本、说明等元数据
- 图片处理
  - 支持 .avif / .gif / .jpeg / .jpg / .png / .webp
  - JPEG/PNG 自动校正 EXIF 方向
  - 按尺寸阈值缩放
  - 质量 85 编码为 WebP
  - 保留 PNG 透明度
  - GIF/AVIF/WebP 保持原格式
  - 内存内转换，不改源文件
- 媒体库查询
  - wp_media_list：分页筛选列表
  - wp_media_get：按 ID 读取
  - 支持 context: view | edit
  - 支持 search/include/exclude/parent/mediaType/mimeType
- 媒体更新与删除
  - wp_media_update：更新元数据（不替换文件）
  - wp_media_alt_update：独立更新/清空替代文本
  - wp_media_delete：永久删除附件及文件（force: true）
  - 空字符串清空文本，post: 0 解除关联
- 媒体分类（Jelly Editor）
  - wp_media_category_list
  - wp_media_category_get
  - wp_media_category_create
  - wp_media_category_update
  - wp_media_category_delete
  - 路由：wp/v2/media_category
  - 支持层级 parent 与空分类
  - 删除仅移除分类与关联，保留文件
  - 需要 manage_categories / upload_files
- 批量导入特性
  - 上传前校验全部参数与路径
  - 逐项上传，单项失败不中断
  - 不回滚已成功项
  - 返回 total/succeeded/failed/items
  - 不自动重试，避免重复附件

## 九、Elementor 本地文件工作流（4 个工具）

- 工作流
  - pull → inspect → edit（可重复）→ push
  - 固定操作 pages
  - 保留布局、样式与插件扩展字段
- wp_elementor_pull
  - 拉取完整页面 data
  - 写入版本化本地 JSON
  - 含站点、页面 ID、基线 revision
  - 支持 outputFile / overwrite
- wp_elementor_inspect
  - 纯本地，不需要 client
  - 查看文件元数据
  - 按 JSON Pointer 定位
  - 按 elementId / widgetType / searchText 匹配
  - 支持 includeSubtree / limit
  - 返回最新文件 SHA-256
- wp_elementor_edit
  - 纯本地
  - 用 expectedFileSha256 做并发保护
  - 原子应用操作并替换文件
  - 支持 operations 或 operationsFile
  - 单次最多 100 个操作
- edit 操作类型
  - update_settings：新增/覆盖/删除顶层 settings
  - replace_element：整元素及子树替换，ID 不变
  - insert_child：插入子元素，可指定索引
  - remove_element：删除元素及子树
  - move_element：移动元素及子树，禁止移入自身子树
- wp_elementor_push
  - 读取 dataFile
  - 校验来源、页面与基线 revision
  - 上传完整 data 树
  - 回读验证落盘
  - 刷新 Elementor 全站缓存
  - 原子更新本地基线
  - 远端已一致时按安全重试处理
- 限制与要求
  - data 默认 ≤ 100 MiB
  - ≤ 100,000 个元素
  - ≤ 100 层深度
  - WP_API_MAX_ELEMENTOR_DATA_BYTES 可调
  - 站点需 show_in_rest 暴露 _elementor_data

## 十、插件、主题与本地打包（8 个工具）

- 远端查询
  - wp_package_list：列出插件/主题
  - wp_package_get：读取单个插件/主题
  - 支持 status 过滤与 search
- 远端变更
  - wp_package_install：从本地 ZIP 安装
  - wp_package_update：从本地 ZIP 更新
  - wp_package_activate：激活插件/切换主题
  - wp_package_deactivate：停用插件（主题不支持）
- 本地打包
  - wp_package_pack_theme：打包主题 ZIP
  - wp_package_pack_plugin：打包插件 ZIP
  - 纯本地，不使用 client
  - 保留源文件夹为顶层目录
  - outputPath 必须 .zip
  - 输出不能位于源目录内
  - 拒绝符号链接与特殊文件
  - 临时文件写入后原子替换
- Jelly Core 依赖
  - 插件安装/更新需要
  - 主题安装/更新需要
  - 主题激活需要
  - 操作前检查所有活动插件
  - 检查失败则停止，不上传
- 安全签名（Jelly Core 1.4.0）
  - HMAC-SHA256 固定协议密钥
  - 签名绑定方法、路由、时间戳、Nonce、请求体 SHA-256
  - 使用 X-Jelly-Timestamp / X-Jelly-Nonce / X-Jelly-Signature
  - Nonce 5 分钟内有效且不可复用

## 十一、Inquiry 询价管理（4 个工具）

- wp_inquiry_settings_get
  - 读取收件人、通知、跳转、脱敏 SMTP 设置
  - 返回 password_set，不返回密码
- wp_inquiry_settings_update
  - 更新收件人、通知、跳转、SMTP 字段
  - 未提供字段保持不变
  - 省略 SMTP 密码表示保留
- wp_inquiry_list
  - 列出并筛选非垃圾询价
  - 支持 search/page/perPage/日期/排序
  - 只读
- wp_inquiry_get
  - 按 ID 读取单条非垃圾询价
  - 只读
- 前置要求
  - 启用 jelly-form/v1 的 Inquiry 插件
  - 设置操作需 manage_options

## 十二、内容与媒体处理引擎

- Gutenberg 转换
  - 使用 HTML5 parser 解析
  - 标签与属性允许列表
  - WordPress 允许协议列表
  - 移除事件属性与内联样式
  - 移除 javascript: / data: 等活动协议
  - 移除活动嵌入内容
  - 未知容器解包但保留安全文本
  - 生成 Gutenberg 区块标记
- 图像处理
  - EXIF 方向自动校正
  - 参考插件尺寸阈值缩放
  - 质量 85 WebP 编码
  - 透明通道保留
  - 动画格式不重编码
- CSV / JSON 基础能力
  - 有界 JSON 读取
  - 严格 CSV 表头解析
  - JSON 单元格编解码
  - 原子文件发布

## 十三、安全模型

- 站点 URL 规则
  - 允许 HTTP/HTTPS
  - 禁止内嵌凭据
  - 禁止 query 与 fragment
  - siteUrl 覆盖必须同源
  - 认证请求不跟随重定向
- 凭据安全
  - AES-256-GCM 加密
  - 每主机独立密钥
  - 仅当前用户文件权限
  - 建议专用低权限账号并定期轮换
- 本地文件边界
  - 默认限制在进程 cwd
  - WP_API_ALLOWED_LOCAL_ROOTS 扩展
  - 同时校验词法路径与真实路径
  - 阻止符号链接逃逸
  - 应用层边界，非操作系统沙箱
  - 涉及 contentFile/metaFile/csvFile/outputFile/filePath/folderPath 等
- 大结果外置
  - 紧凑 JSON 超过 8 KiB 时保存为文件
  - 默认 .wp-api-results
  - WP_API_RESULT_DIR 可配置
  - 返回路径、字节数、SHA-256
  - 结果目录自动成为可信本地根
- 写入安全
  - 失败以 MCP tool error 返回
  - 写操作应确认目标与破坏性语义
  - Jelly Core 检查在变更之前

## 十四、资源限制与运行约束

- 网络请求超时 30 秒
- 单个 REST 响应 25 MiB
- contentFile 25 MiB
- metaFile 10 MiB
- 单媒体文件 50 MiB
- 插件/主题 ZIP 100 MiB
- Elementor data 100 MiB / 100,000 元素 / 100 层
- 资源 CSV 导入 25 MiB
- 单个 batch 请求 8 MiB
- 单次 batch 调用 25 MiB
- 本地打包源 20,000 条目 / 512 MiB 未压缩
- perPage 统一限制 1..100

## 十五、部署与集成

- 安装构建
  - npm install
  - npm run build
  - npm start
  - npm link
- MCP host 接入
  - Codex（~/.codex/config.toml 或 .codex/config.toml）
  - 通用 mcpServers JSON 宿主
  - 使用绝对路径启动
  - 显式设置 cwd 作为文件边界
  - 可调整 tool_timeout_sec
- 环境变量
  - WP_API_ALLOWED_LOCAL_ROOTS
  - WP_API_CONFIG_DIR
  - WP_API_RESULT_DIR
  - WP_API_MAX_ELEMENTOR_DATA_BYTES
- 系统要求
  - Node.js 20.9+
  - REST API 可访问的 WordPress
  - Application Password
  - 相应 REST 权限
  - SEO 需 Rank Math 字段可读写
  - 产品需 Jelly Catalog
  - 部分软件包操作需 Jelly Core

## 十六、工具统计与分类

- 客户端配置 2 个
- 结构与 Schema 发现 3 个
- WordPress 资源 8 个
- 经典导航菜单 8 个
- SEO 与文章编辑 6 个
- 媒体 12 个
- Elementor 4 个
- 插件/主题/打包 8 个
- Inquiry 4 个
- 合计 55 个结构化工具

## 十七、开发与质量保障

- TypeScript 源码结构
  - src/mcp/tools：各领域工具实现
  - src/wordpress：REST 客户端与领域逻辑
  - src/config：凭据存储与配置服务
  - src/shared：文件与通用工具
- 测试
  - npm test（构建后 node --test）
  - npm run test:unit
- 文档
  - README.md / README.zh-CN.md
  - mcp.md 详细工具参考
  - CHANGELOG.md 版本记录
  - CONTRIBUTING.md / SECURITY.md
- 发布
  - npm 公共包
  - 仅发布 build 与文档
  - prepack 自动构建
