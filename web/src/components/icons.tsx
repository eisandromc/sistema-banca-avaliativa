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

export const IconDoc = ({ size = 16 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h6" />
  </Svg>
);

export const IconAdvisor = ({ size = 16 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M2 9l10-5 10 5-10 5z" />
    <path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5M22 9v5" />
  </Svg>
);

export const IconUsers = ({ size = 16 }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.6-3.5 3.3-5.5 6.5-5.5s5.9 2 6.5 5.5" />
    <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .6 3.2 2.4 3.5 5.2" />
  </Svg>
);

export const IconGithub = ({ size = 16 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />
  </Svg>
);

export const IconArticle = ({ size = 16 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
    <path d="M8 16.5v-4h1.3a1.2 1.2 0 0 1 0 2.4H8M12.2 16.5v-4h1a2 2 0 0 1 0 4zM16.5 12.5H15v4M15 14.5h1.3" />
  </Svg>
);

export const IconSlides = ({ size = 16 }: { size?: number }) => (
  <Svg size={size}>
    <rect x="3" y="4" width="18" height="12" rx="1.5" />
    <path d="M12 16v4M8 20h8M7 12l3-3 2 2 4-4" />
  </Svg>
);

export const IconLink = ({ size = 16 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </Svg>
);
