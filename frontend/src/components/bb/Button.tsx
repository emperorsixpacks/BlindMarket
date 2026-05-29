import { type ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline' | 'ghost';
  size?: 'sm' | 'md';
  label: string;
}

export function Button({ variant = 'outline', size = 'md', label, className = '', ...props }: ButtonProps) {
  const sizeClass = size === 'sm' ? 'px-3 py-1.5 text-2xs' : 'px-5 py-2.5 text-xs';

  if (variant === 'primary') {
    return (
      <button className={`btn-bracket-primary ${sizeClass} ${className}`} {...props}>
        <span className="opacity-40">[</span> {label} <span className="opacity-40">]</span>
      </button>
    );
  }

  if (variant === 'ghost') {
    return (
      <button className={`btn-ghost ${sizeClass} ${className}`} {...props}>
        {label}
      </button>
    );
  }

  return (
    <button className={`btn-bracket ${sizeClass} ${className}`} {...props}>
      <span className="opacity-40">[</span> {label} <span className="opacity-40">]</span>
    </button>
  );
}
