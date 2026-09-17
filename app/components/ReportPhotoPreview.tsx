'use client';

import Image from 'next/image';
import { useState } from 'react';

export default function ReportPhotoPreview({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="report-photo-frame">
      {failed ? (
        <span className="photo-preview-fallback"><strong>Photo attached</strong><small>Preview unavailable for this format</small></span>
      ) : (
        <Image src={src} alt={name} fill sizes="(max-width: 600px) 40vw, 220px" unoptimized onError={() => setFailed(true)} />
      )}
    </div>
  );
}
