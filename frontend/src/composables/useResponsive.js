// 统一响应式工具（H5 适配 #1250）
// 断点约定（全站统一, 与 Element Plus xs/sm/md 对齐）：
//   手机: width <  768
//   平板: 768 ≤ width < 1024
//   桌面: width ≥ 1024
// 用法：
//   const { isMobile, isTablet, width } = useResponsive()
//   isMobile.value → 模板里直接用
//   或只读布尔：const isMobile = useIsMobile()
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

export const BP_MOBILE = 768
export const BP_TABLET = 1024

// 单例：多组件共用一个监听, 旋转/拖动窗口时全局同步
const width = ref(0)
const height = ref(0)
let listenerCount = 0
let mediaMobile = null
let mediaTablet = null

function readViewport() {
  width.value = window.innerWidth
  height.value = window.innerHeight
}

function ensureListeners() {
  if (listenerCount === 0) {
    readViewport()
    // matchMedia 比 resize 监听更准（只在跨越断点时触发）, 但仍需 resize 同步具体宽度
    mediaMobile = window.matchMedia(`(max-width: ${BP_MOBILE - 1}px)`)
    mediaTablet = window.matchMedia(`(max-width: ${BP_TABLET - 1}px)`)
    mediaMobile.addEventListener('change', readViewport)
    mediaTablet.addEventListener('change', readViewport)
    window.addEventListener('resize', readViewport, { passive: true })
    window.addEventListener('orientationchange', readViewport, { passive: true })
  }
  listenerCount++
}

function releaseListeners() {
  listenerCount--
  if (listenerCount === 0) {
    mediaMobile?.removeEventListener('change', readViewport)
    mediaTablet?.removeEventListener('change', readViewport)
    window.removeEventListener('resize', readViewport)
    window.removeEventListener('orientationchange', readViewport)
    mediaMobile = null
    mediaTablet = null
  }
}

export function useResponsive() {
  onMounted(ensureListeners)
  onBeforeUnmount(releaseListeners)

  const isMobile = computed(() => width.value > 0 && width.value < BP_MOBILE)
  const isTablet = computed(() => width.value >= BP_MOBILE && width.value < BP_TABLET)
  const isDesktop = computed(() => width.value >= BP_TABLET)

  return { width, height, isMobile, isTablet, isDesktop }
}

// 便捷封装：只关心是不是手机时
export function useIsMobile() {
  return useResponsive().isMobile
}
