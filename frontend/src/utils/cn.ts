type ClassValue = string | undefined | null | boolean | Record<string, boolean>

export function cn(...classes: ClassValue[]): string {
  return classes
    .flatMap((c) => {
      if (!c || typeof c === 'boolean') return []
      if (typeof c === 'string') return [c]
      return Object.entries(c)
        .filter(([, v]) => v)
        .map(([k]) => k)
    })
    .join(' ')
}
