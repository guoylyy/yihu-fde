// 装在以虎 One 上时页面带路径前缀: 先包好 fetch, 再加载其他模块(见 utils/base.js)
import { installBaseFetch } from './utils/base.js'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import en from 'element-plus/es/locale/lang/en'
import 'element-plus/dist/index.css'
import App from './App.vue'
import router from './router'
import { i18n, locale } from './i18n/index.js'
import { refreshEdition } from './api/edition.js'
import './assets/main.css'
import './assets/element-vi.css'

// 多实例: 版本与品牌信息运行时取, 必须在挂载前拿到 —— 登录页首帧就要用实例自己的品牌名与主色。
// 接口异常/超时按缓存或全量走, 不能让前端起不来。
const EDITION_TIMEOUT = 1500

installBaseFetch()

async function bootstrap() {
  await Promise.race([
    refreshEdition(),
    new Promise(resolve => setTimeout(resolve, EDITION_TIMEOUT))
  ])
  const app = createApp(App)
  app.use(createPinia())
  app.use(i18n)
  app.use(router)
  app.use(ElementPlus, { locale: locale === 'zh-CN' ? zhCn : en })
  app.mount('#app')
}

bootstrap()
