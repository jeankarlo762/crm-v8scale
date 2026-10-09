import { InputHTMLAttributes, forwardRef, ReactNode, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '../../utils/cn'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  icon?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, icon, className, id, type, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s/g, '-')
    const isPassword = type === 'password'
    const [showPassword, setShowPassword] = useState(false)

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500">{icon}</div>
          )}
          <input
            ref={ref}
            id={inputId}
            type={isPassword ? (showPassword ? 'text' : 'password') : type}
            className={cn(
              'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-base text-gray-900 dark:text-gray-100',
              'placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-colors',
              'focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-400',
              'disabled:bg-gray-50 dark:disabled:bg-gray-700 disabled:cursor-not-allowed',
              icon ? 'pl-10' : undefined,
              isPassword ? 'pr-10' : undefined,
              error ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : undefined,
              className,
            )}
            {...props}
          />
          {isPassword && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          )}
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    )
  },
)

Input.displayName = 'Input'
