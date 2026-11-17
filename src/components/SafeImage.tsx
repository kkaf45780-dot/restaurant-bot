import { UtensilsCrossed } from 'lucide-react';
import { useEffect, useState } from 'react';
import { resolveAssetUrl } from '../lib/imageAssets.ts';

interface SafeImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  fallbackClassName?: string;
  iconClassName?: string;
  fallbackIconClassName?: string;
  width?: number;
  height?: number;
  loading?: 'lazy' | 'eager';
  decoding?: 'async' | 'sync' | 'auto';
}

export function SafeImage({
  src,
  alt,
  className = 'w-full h-full object-cover',
  fallbackClassName,
  iconClassName,
  fallbackIconClassName,
  width,
  height,
  loading = 'lazy',
  decoding = 'async',
}: SafeImageProps) {
  const resolved = resolveAssetUrl(src);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
  }, [resolved]);

  const resolvedFallbackClass =
    fallbackClassName ??
    `${className} flex items-center justify-center bg-gradient-to-br from-[#F7F3E9] to-[#EAE2D0] dark:from-[#14201B] dark:to-[#0E1713] text-[#176B45]/45 dark:text-[#4ADE80]/40`;
  const resolvedIconClass = fallbackIconClassName ?? iconClassName ?? 'w-8 h-8';

  if (!resolved || broken) {
    return (
      <div className={resolvedFallbackClass} role="img" aria-label={alt}>
        <UtensilsCrossed className={resolvedIconClass} />
      </div>
    );
  }

  return (
    <img
      src={resolved}
      alt={alt}
      width={width}
      height={height}
      loading={loading}
      decoding={decoding}
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className={className}
    />
  );
}
