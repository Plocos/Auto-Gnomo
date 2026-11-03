import { useEffect, useState } from 'react';
import { copyToClipboard } from './copy';

export function CopyValue({ display, value }: { display: string; value: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <button
      type="button"
      title={`Copiar ${value}`}
      className={`cursor-copy px-0.5 hover:bg-black/5 ${copied ? 'text-surface-ok' : ''}`}
      onClick={async () => {
        await copyToClipboard(value);
        setCopied(true);
      }}
    >
      {copied ? 'Copiado ✓' : display}
    </button>
  );
}
