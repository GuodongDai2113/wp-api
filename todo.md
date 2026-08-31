wp_client_list：输出保存所有的客户名称和站点。
wp_client_get：找到特定的客户，没有则直接报错。

wp_structure_get：获取结构数据，例如product meta，说明 wp 不默认存在的格式。
wp_rest_api：获取站点暴露的rest api接口

### SEO

需要站点安装Jelly SEO插件暴露post的meta部分。

控制三个meta
- `rank_math_title`
- `rank_math_description`
- `rank_math_focus_keyword`

wp_seo_get：获取单个post，rank math插件的标题、元描述、焦点关键词设定
wp_seo_update：设置单个post， rank math插件的标题、元描述、焦点关键词设定
wp_seo_batch_get：批量获取多个post的meta（未实现）
wp_seo_batch_update：批量的多个post的meta（未实现）

批量查询，额外支持导出一个csv，id，rank_math_title，rank_math_description，rank_math_focus_keyword
批量更新，额外支持导入一个csv，id，rank_math_title，rank_math_description，rank_math_focus_keyword

批量部分可能需要更新Jelly SEO插件