import type { SVGProps } from 'react';

/**
 * Inline icons.
 *
 * Hand-drawn rather than pulled from an icon package: the set is small and
 * fixed, and a dependency would ship a few hundred unused glyphs to satisfy
 * eight. Every icon inherits `currentColor` and is `aria-hidden` by default —
 * an icon next to a label is decoration, and announcing it twice is noise. Icon
 * *buttons* supply their own accessible name.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const GaugeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 21a9 9 0 1 0-9-9" />
    <path d="M3 12h2M12 3v2M20.5 7.5 19 9" />
    <path d="m12 12 5-3" />
  </Icon>
);

export const AccountsIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18M9 9v11" />
  </Icon>
);

export const JournalIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3Z" />
    <path d="M5 17a3 3 0 0 1 3-3h11" />
    <path d="M9 8h6" />
  </Icon>
);

export const TransferIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 8h13l-3-3M20 16H7l3 3" />
  </Icon>
);

export const ApiIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m9 8-5 4 5 4M15 8l5 4-5 4" />
  </Icon>
);

export const ReportsIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </Icon>
);

export const SearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);

export const PlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const CheckIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m4 12 5 5L20 6" />
  </Icon>
);

export const AlertIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3 2 20h20Z" />
    <path d="M12 10v4M12 17h.01" />
  </Icon>
);

export const SunIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
);

export const MoonIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
  </Icon>
);

export const MonitorIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </Icon>
);

export const ArrowRightIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

export const ArrowLeftIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M19 12H5M11 18l-6-6 6-6" />
  </Icon>
);

export const ScaleIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 4v16M7 20h10M5 8h14M5 8l-3 6h6ZM19 8l-3 6h6Z" />
  </Icon>
);

/** A stacked pallet: what a lot of stock physically looks like. */
export const StockIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 8.5 12 4l9 4.5-9 4.5Z" />
    <path d="M3 12.5 12 17l9-4.5" />
    <path d="M3 16.5 12 21l9-4.5" />
  </Icon>
);

export const WebhookIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9 10.5a3 3 0 1 1 4.2 2.75L15.5 17" />
    <path d="M17.5 13a3 3 0 1 1-1.6 5.54H11" />
    <path d="M6.5 13A3 3 0 1 0 8.1 18.5" />
  </Icon>
);

export const SettingsIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
  </Icon>
);

export const DownloadIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3v12" />
    <path d="m7 11 5 5 5-5" />
    <path d="M4 19h16" />
  </Icon>
);

/** A receipt, torn at the foot — the shape of a filing. */
export const ReceiptIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21Z" />
    <path d="M9 8h6M9 12h6" />
  </Icon>
);

export const CalendarIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Icon>
);
