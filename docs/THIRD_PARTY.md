# 第三方依赖与素材记录

本轮没有引入现成校园平台项目。页面布局与样式围绕用户确认的概念实现，功能图标来自 Lucide；没有下载真人头像、付费图片或把参考截图作为产品素材。

以下版本与许可来自本机安装包元数据；完整间接依赖以 pnpm-lock.yaml 和各包 LICENSE 为准，提交前还需生成完整清单。

| 包 | 版本 | 包声明许可 |
| --- | --- | --- |
| React | 19.3.1 | MIT |
| Vite | 8.3.4 | MIT |
| Motion | 14.2.0 | MIT |
| lucide-react | 1.57.0 | ISC |
| Express | 5.3.0 | MIT |
| Prisma Client | 7.10.0 | Apache-2.0 |
| argon2 | 0.45.1 | MIT |
| embedded-postgres 开发启动组件 | 18.4.0-beta.17 | MIT；内置 PostgreSQL 及其库仍有各自许可 |

接口兼容核对参考：[Prisma PostgreSQL 适配器](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql)、[Prisma 配置](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference)、[Vite 启动要求](https://vite.dev/guide/)、[本地 PostgreSQL 组件原始说明](https://github.com/leinelissen/embedded-postgres)。实际选用版本以锁文件和本机验证结果为准，不自动升级 latest 指向的候选大版本。
