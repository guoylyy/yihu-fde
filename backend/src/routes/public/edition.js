// v2.7.0 版本信息(免登录) —— SaaS 多实例: 一个镜像跑多个客户, 前端在登录前就要知道
// 自己跑在哪个版本上、用哪个品牌。
import express from 'express'
import { editionName, enabledModuleList } from '../../config/edition.js'
import { getBrand } from '../../config/brand.js'
import { appInfo } from '../../lib/yihuOne.js'

const router = express.Router()

router.get('/', async (req, res) => {
  // 外观跟随以虎 One: 先刷新应用信息缓存(10 分钟内用缓存, 取不到用上次的或默认)
  await appInfo()
  res.json({
    code: 0,
    data: {
      edition: editionName(),
      brand: getBrand(),
      enabledModules: enabledModuleList(),
      // v2.11.1(#1183) 官网已拆到独立项目: 生产系统自己不再带官网前台与商城。
      // 这两个字段留给还缓存着旧前端的浏览器(据此把官网页转去登录)
      publicSite: false,
      mall: false
    }
  })
})

export default router
