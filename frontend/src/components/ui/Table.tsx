import { ReactNode } from 'react'
import { cn } from '../../utils/cn'
import { ScrollX } from './ScrollX'

interface Column<T> {
  key: string
  header: string
  cell: (row: T) => ReactNode
  className?: string
}

interface TableProps<T> {
  columns: Column<T>[]
  data: T[]
  keyExtractor: (row: T) => string
  emptyMessage?: string
  loading?: boolean
  onRowClick?: (row: T) => void
}

export function Table<T>({ columns, data, keyExtractor, emptyMessage = 'Nenhum registro encontrado', loading, onRowClick }: TableProps<T>) {
  return (
    <ScrollX className="rounded-xl border border-gray-200 dark:border-gray-700">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead className="bg-gray-50 dark:bg-gray-800">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider',
                  col.className,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-700">
          {loading ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500 text-sm">
                Carregando...
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500 text-sm">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row) => (
              <tr
                key={keyExtractor(row)}
                onClick={() => onRowClick?.(row)}
                className={cn('hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors', onRowClick && 'cursor-pointer')}
              >
                {columns.map((col) => (
                  <td key={col.key} className={cn('px-4 py-3 text-sm text-gray-700 dark:text-gray-300', col.className)}>
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </ScrollX>
  )
}
