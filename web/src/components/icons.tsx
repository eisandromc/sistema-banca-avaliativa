import type { ReactNode } from 'react';

/** Ícones em traço (SVG inline, sem dependências). Sempre decorativos: o texto ao lado dá o significado. */
function Svg({ size = 24, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconClock = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2.5 2.5M9.5 2.5h5M12 2.5V5" />
  </Svg>
);

export const IconClipboard = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4.5V3.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M8.5 11l2 2 4-4M8.5 17h7" />
  </Svg>
);

export const IconSliders = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </Svg>
);

export const IconArrowRight = ({ size = 18 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);

export const IconArrowLeft = ({ size = 18 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Svg>
);

export const IconExpand = ({ size = 18 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Svg>
);
