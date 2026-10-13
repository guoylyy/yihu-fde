// 按需引入的 echarts: 只打包用到的图表与组件(全量引入约 1MB)。
// 新图表要用别的类型/组件时在这里补注册, 页面统一 import { echarts } from '@/utils/echarts.js'
import * as echarts from 'echarts/core'
import { LineChart, BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, CanvasRenderer])

export { echarts }
