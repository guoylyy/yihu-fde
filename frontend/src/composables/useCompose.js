import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export const createThrottle = (fn, wait = 120) => {
  let timer = null
  let lastRun = 0

  return (...args) => {
    const now = Date.now()
    const remaining = wait - (now - lastRun)

    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      lastRun = now
      fn(...args)
      return
    }

    if (!timer) {
      timer = setTimeout(() => {
        timer = null
        lastRun = Date.now()
        fn(...args)
      }, remaining)
    }
  }
}

export const calculateColumnMetrics = ({
  containerWidth,
  targetItemWidth = 280,
  minColumnGap = 16,
  maxColumns = 4
}) => {
  if (!containerWidth) {
    return {
      columns: 1,
      itemWidth: targetItemWidth,
      columnGap: 0
    }
  }

  const columns = Math.max(
    1,
    Math.min(
      maxColumns,
      Math.floor((containerWidth + minColumnGap) / (targetItemWidth + minColumnGap))
    )
  )

  if (columns === 1) {
    return {
      columns,
      itemWidth: containerWidth,
      columnGap: 0
    }
  }

  return {
    columns,
    itemWidth: targetItemWidth,
    columnGap: (containerWidth - columns * targetItemWidth) / (columns - 1)
  }
}

export const calculateWaterfallLayout = ({
  itemHeights,
  columns,
  itemWidth,
  columnGap,
  rowGap
}) => {
  const columnHeights = new Array(columns).fill(0)

  const items = itemHeights.map((height) => {
    const top = Math.min(...columnHeights)
    const columnIndex = columnHeights.indexOf(top)
    const left = columnIndex * (itemWidth + columnGap)

    columnHeights[columnIndex] = top + height + rowGap

    return {
      left,
      top,
      width: itemWidth,
      height
    }
  })

  const height = Math.max(...columnHeights, 0)

  return {
    items,
    height: height > 0 ? height - rowGap : 0
  }
}

export const useCompose = ({
  source,
  targetItemWidth = 280,
  minColumnGap = 16,
  rowGap = 16,
  maxColumns = 4,
  throttleWait = 120
} = {}) => {
  const containerRef = ref(null)
  const itemStyles = ref([])
  const containerHeight = ref(0)
  const itemRefs = []
  let resizeObserver = null

  const containerStyle = computed(() => ({
    height: `${containerHeight.value}px`
  }))

  const setItemRef = (el, index) => {
    if (el) {
      itemRefs[index] = el
    }
  }

  const reset = () => {
    itemRefs.length = 0
    itemStyles.value = []
    containerHeight.value = 0
  }

  const layout = () => {
    const container = containerRef.value

    if (!container) {
      return
    }

    const { columns, itemWidth, columnGap } = calculateColumnMetrics({
      containerWidth: container.clientWidth,
      targetItemWidth,
      minColumnGap,
      maxColumns
    })

    const itemHeights = itemRefs.map((img) => {
      if (!img) {
        return itemWidth
      }

      if (img.naturalWidth && img.naturalHeight) {
        return itemWidth * (img.naturalHeight / img.naturalWidth)
      }

      return img.offsetHeight || itemWidth
    })

    const { items, height } = calculateWaterfallLayout({
      itemHeights,
      columns,
      itemWidth,
      columnGap,
      rowGap
    })

    itemStyles.value = items.map((item) => ({
      width: `${item.width}px`,
      height: `${item.height}px`,
      transform: `translate3d(${item.left}px, ${item.top}px, 0)`,
      opacity: 1
    }))
    containerHeight.value = height
  }

  const scheduleLayout = createThrottle(() => {
    nextTick(layout)
  }, throttleWait)

  const getItemStyle = (index) => {
    return itemStyles.value[index] || {
      width: `${targetItemWidth}px`,
      transform: 'translate3d(0, 0, 0)',
      opacity: 0
    }
  }

  onMounted(() => {
    scheduleLayout()
    window.addEventListener('resize', scheduleLayout)

    if (window.ResizeObserver && containerRef.value) {
      resizeObserver = new ResizeObserver(scheduleLayout)
      resizeObserver.observe(containerRef.value)
    }
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', scheduleLayout)

    if (resizeObserver) {
      resizeObserver.disconnect()
    }
  })

  if (source) {
    watch(
      source,
      () => {
        reset()
        scheduleLayout()
      },
      { flush: 'post' }
    )
  }

  return {
    containerRef,
    containerStyle,
    getItemStyle,
    layout,
    scheduleLayout,
    setItemRef
  }
}
