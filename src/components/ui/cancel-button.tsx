"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * A form's `Batal` — the one way out of an edit. A clean form leaves at once;
 * a dirty one asks first, because a stray click on Batal used to throw away
 * everything typed with nothing to say it had happened.
 *
 * `href` leaves the page; `onCancel` is for a form that discards in place,
 * like System Default, which has nowhere to go back to.
 */
export function CancelButton({
  href,
  onCancel,
  dirty,
  disabled,
}: {
  href?: string;
  onCancel?: () => void;
  dirty: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);

  function leave() {
    setAsking(false);
    if (onCancel) onCancel();
    else if (href) router.push(href);
  }

  const label = (
    <>
      <Icon name="back" size={15} /> Batal
    </>
  );

  return (
    <>
      {href && !onCancel ? (
        <Link
          className="btn"
          href={href}
          aria-disabled={disabled || undefined}
          onClick={(e) => {
            if (disabled) {
              e.preventDefault();
              return;
            }
            if (dirty) {
              e.preventDefault();
              setAsking(true);
            }
          }}
        >
          {label}
        </Link>
      ) : (
        <button
          className="btn"
          disabled={disabled}
          onClick={() => (dirty ? setAsking(true) : leave())}
        >
          {label}
        </button>
      )}
      <ConfirmDialog
        open={asking}
        icon="warn"
        tone="danger"
        title="Konfirmasi Buang Perubahan"
        body="Perubahan yang belum disimpan akan hilang."
        confirmLabel="Ya, Buang Perubahan"
        confirmTone="solid-danger"
        onConfirm={leave}
        onCancel={() => setAsking(false)}
      />
    </>
  );
}
