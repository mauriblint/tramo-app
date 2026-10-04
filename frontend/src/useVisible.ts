import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/** Becomes true (once) when the element scrolls near the viewport. */
export function useVisible(el: Ref<HTMLElement | undefined>, rootMargin = '200px') {
  const visible = ref(false)
  let io: IntersectionObserver | undefined
  onMounted(() => {
    if (!el.value) return
    io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          visible.value = true
          io?.disconnect()
        }
      },
      { rootMargin },
    )
    io.observe(el.value)
  })
  onBeforeUnmount(() => io?.disconnect())
  return visible
}
