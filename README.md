# 耕读云镜 · 樟影书声

面向浙江古渊头村的原生微信小程序，以千年古樟串联村落游览、地方故事与耕读文化。项目使用 JavaScript、WXML、WXSS 和 WebGL。

## 主要功能

- **线上寻樟**。探索千年古樟、乌竹溪古水秤、承启堂和四本堂，完成任务并收集卡片、生成明信片。
- **古村漫行**。查看四景介绍、慢行路线和实景影册，记录本机打卡与游记。千年古樟提供内置 360° 全景。
- **古村问地**。村落伙伴「阿樟」可触发讲解。导览问答默认使用随工程提供的知识库离线演示。
- **乡味好物**。体验商品浏览、收藏、购物车和模拟结算。游览进度与演示订单保存在当前设备。

## 本地运行

1. 在微信开发者工具中选择「导入项目」，选中仓库根目录。
2. 使用测试号或自己有权限的 AppID，点击「编译」。首页为 `pages/guide/index`。
3. 小程序运行无需安装 npm 依赖。第三方全景嵌入依赖小程序的业务域名配置。

## 目录

| 路径 | 内容 |
| --- | --- |
| `pages/`、`components/`、`custom-tab-bar/` | 页面、组件和底部导航 |
| `utils/` | 导览知识库、资源映射和本地状态 |
| `assets/` | 插画、实景照片、商品素材和全景图 |
| `scripts/` | 工程检查及素材、知识库维护脚本 |
| `docs/` | 素材来源、知识库原稿和验收记录 |
| `index.html`、`web/panorama/` | 原版设计稿和独立全景网页 |

## 工程检查

```sh
node scripts/check-project.cjs
node scripts/check-upload.cjs
node scripts/check-asset-source.cjs
node scripts/check-place-pages.cjs
node scripts/check-shop-products.cjs
node scripts/check-pet.cjs
```

高清素材按原画质保留，微信正式发布前需要另行验证包体积和设备兼容性。更多工程细节见[开发与验收记录](docs/开发与验收记录.md)。
