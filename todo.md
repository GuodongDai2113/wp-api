wp_client_list：输出保存所有的客户名称和站点。
wp_client_get：找到特定的客户，没有则直接报错。

wp_structure_get：获取结构数据，例如product meta，说明 wp 不默认存在的格式。
wp_rest_api：获取站点暴露的rest api接口

### Log System

为资源操作的成功追加日志记录，未来用于审计等。

### SEO

需要站点安装Jelly SEO插件暴露post的meta部分。

控制三个meta
- `rank_math_title`
- `rank_math_description`
- `rank_math_focus_keyword`

wp_seo_get：获取单个post，rank math插件的标题、元描述、焦点关键词设定
wp_seo_update：设置单个post， rank math插件的标题、元描述、焦点关键词设定
wp_seo_list：批量获取多个post的meta,有查询（未实现）
wp_seo_batch_update：批量的多个post的meta（未实现）

批量查询（wp_seo_list），额外支持导出一个csv，id，rank_math_title，rank_math_description，rank_math_focus_keyword
批量更新（wp_seo_batch_update），额外支持导入一个csv，id，rank_math_title，rank_math_description，rank_math_focus_keyword

批量处理走 /wp-json/batch/v1，可能需要更新Jelly SEO插件

## CRUD（已完成）
- [x] `wp_resource_count`：从分页 Header 获取总数和总页数。
- [x] `wp_resource_list`：有界分页查询，并按每页 100 条追加导出 post/taxonomy 类型 CSV。
- [x] `wp_resource_get` / `wp_resource_create` / `wp_resource_update`：单条 CRUD 保持兼容。
- [x] `wp_resource_batch_create` / `wp_resource_batch_update`：通过 `/wp-json/batch/v1` 每 25 条导入处理。
- [x] `wp_resource_delete`：仅保留单条危险删除操作。
- [x] 资源输入使用 `target: { type, resource }`，写入字段放入 `data`；批量条目使用 `{ id?, data }`。
- [x] 移除 MCP 的 `product_tag` 支持，统一用 `categories` 自动映射文章分类或产品分类。
- [x] 资源 batch 增加 8 MiB 单请求和 25 MiB 整次调用上限，并按实际 JSON 字节分块。
- [x] 资源和 SEO CSV 使用排他原子发布，并根据每页最新分页头处理页数漂移。

产品部署仍需确认 Jelly Core 或 WordPress 环境提供 `/wp-json/batch/v1`。

## Media

上传媒体


## Option
get_option
update_option

参考wp的函数方式

## User
