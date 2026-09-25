import Link from "next/link";
import { Icon } from "@/components/icon";

/**
 * A figure or a reference in a report that opens what produced it — a
 * statement's amount into its General Ledger, a ledger entry into its journal,
 * a journal into its document.
 *
 * One component, so every drill reads the same way on every report: the text
 * keeps its own look, the row's hover reveals a chevron beside it, and the link
 * itself tints on hover. A reader should not have to guess which numbers can
 * be clicked.
 */
export function Drill({
  href,
  title,
  children,
}: {
  href: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Link className="drl" href={href} title={title}>
      {children}
      <span className="drl-i" aria-hidden>
        <Icon name="chev" size={12} />
      </span>
    </Link>
  );
}
