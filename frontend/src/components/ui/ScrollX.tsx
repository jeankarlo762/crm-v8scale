import { ReactNode, useEffect, useRef, useState } from 'react'
import { cn } from '../../utils/cn'

/**
 * Container de rolagem horizontal com indicação clara pro usuário:
 * barra fina visível (via classe .scroll-x) + degradê e dica "deslize →"
 * no lado direito, que só aparecem quando há conteúdo escondido pra rolar.
 */
export function ScrollX({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState(false)
  const [atEnd, setAtEnd] = useState(true)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => {
      const canScroll = el.scrollWidth - el.clientWidth > 4
      setOverflow(canScroll)
      setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4)
    }
    check()
    el.addEventListener('scroll', check, { passive: true })
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', check)
      ro.disconnect()
    }
  }, [children])

  return (
    <div className="relative">
      <div ref={ref} className={cn('scroll-x overflow-x-auto', className)}>
        {children}
      </div>
      {overflow && !atEnd && (
        <>
          <div className="pointer-events-none absolute right-0 top-0 bottom-2 w-14 bg-gradient-to-l from-white dark:from-gray-900 to-transparent rounded-r-xl" />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-wide text-orange-600 bg-white/90 dark:bg-gray-900/90 border border-orange-200 dark:border-orange-900 px-2 py-1 rounded-full shadow-sm">
            deslize →
          </span>
        </>
      )}
    </div>
  )
}
