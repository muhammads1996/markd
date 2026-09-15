"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "./participant.module.css";

export interface ParticipantNavItem {
  href: string;
  label: string;
  icon: string;
}

export function BottomNav({
  items,
  label,
  activeHref,
}: {
  items: readonly ParticipantNavItem[];
  label: string;
  activeHref?: string;
}) {
  const pathname = usePathname();

  return (
    <nav className={styles.bottomNav} aria-label={label}>
      {items.map((item) => {
        const active = activeHref
          ? activeHref === item.href
          : pathname === item.href;
        return (
          <Link
            className={`${styles.navLink} ${active ? styles.navActive : ""}`}
            href={item.href}
            aria-current={active ? "page" : undefined}
            key={item.href}
          >
            <span aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
