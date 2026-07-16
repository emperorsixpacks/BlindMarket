import { cn } from '../lib/utils';

interface EncryptionIndicatorProps {
  encrypted: boolean;
  className?: string;
}

export function EncryptionIndicator({ encrypted, className }: EncryptionIndicatorProps) {
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      {encrypted ? (
        <>
          <svg className="w-4 h-4 text-ink" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <span className="text-xs text-ink font-medium">Encrypted</span>
        </>
      ) : (
        <>
          <svg className="w-4 h-4 text-ink-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
          </svg>
          <span className="text-xs text-ink-3 font-medium">Unencrypted</span>
        </>
      )}
    </div>
  );
}
