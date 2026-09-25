"use client";

import {
  Home,
  Inbox,
  CalendarDays,
  CircleAlert,
  LogOut,
  Search,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import styles from "./operator-chrome.module.css";

type NavigationItem = {
  href: string;
  icon: LucideIcon;
  label: string;
  match: (pathname: string) => boolean;
};

const navigation: NavigationItem[] = [
  {
    href: "/operator",
    icon: Home,
    label: "Today",
    match: (pathname) => pathname === "/operator",
  },
  {
    href: "/operator/tomorrow",
    icon: CalendarDays,
    label: "Tomorrow",
    match: (pathname) => pathname.startsWith("/operator/tomorrow"),
  },
  {
    href: "/operator/inbox",
    icon: Inbox,
    label: "Inbox",
    match: (pathname) => pathname.startsWith("/operator/inbox"),
  },
  {
    href: "/operator/exceptions",
    icon: CircleAlert,
    label: "Exceptions",
    match: (pathname) => pathname.startsWith("/operator/exceptions"),
  },
  {
    href: "/operator/onboard",
    icon: UserPlus,
    label: "Add",
    match: (pathname) => pathname.startsWith("/operator/onboard"),
  },
  {
    href: "/search",
    icon: Search,
    label: "Search",
    match: (pathname) =>
      pathname.startsWith("/search") ||
      pathname.startsWith("/workers/") ||
      pathname.startsWith("/contractors/"),
  },
];

function Navigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={mobile ? "Operator navigation" : "Primary navigation"}
      className={mobile ? styles.bottomNavigation : styles.navigation}
    >
      {navigation.map(({ href, icon: Icon, label, match }) => {
        const current = match(pathname);
        return (
          <Link
            aria-current={current ? "page" : undefined}
            className={styles.navigationLink}
            href={href}
            key={href}
          >
            <Icon aria-hidden="true" size={mobile ? 21 : 19} strokeWidth={2} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function OperatorChrome({ children }: { children: ReactNode }) {
  return (
    <div className={styles.operatorRoot}>
      <a className={styles.skipLink} href="#operator-content">
        Skip to content
      </a>
      <aside className={styles.rail}>
        <Link
          className={styles.brand}
          href="/operator"
          aria-label="MARKD Today"
        >
          MARKD<span aria-hidden="true">.</span>
        </Link>
        <div className={styles.workspaceLabel}>
          <span aria-hidden="true" />
          Operator workspace
        </div>
        <Navigation />
        <form action="/auth/sign-out" className={styles.signOut} method="post">
          <button type="submit">
            <LogOut aria-hidden="true" size={18} />
            Sign out
          </button>
        </form>
      </aside>

      <div className={styles.workspace}>
        <header className={styles.mobileHeader}>
          <Link
            className={styles.brand}
            href="/operator"
            aria-label="MARKD Today"
          >
            MARKD<span aria-hidden="true">.</span>
          </Link>
          <div className={styles.mobileActions}>
            <span className={styles.mobileContext}>Operator</span>
            <form action="/auth/sign-out" method="post">
              <button aria-label="Sign out" title="Sign out" type="submit">
                <LogOut aria-hidden="true" size={19} />
              </button>
            </form>
          </div>
        </header>
        <div className={styles.content} id="operator-content" tabIndex={-1}>
          {children}
        </div>
        <Navigation mobile />
      </div>
    </div>
  );
}
