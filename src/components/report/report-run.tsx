"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon } from "@/components/icon";
import { CompanyFilter } from "@/components/master/company-filter";

/**
 * *Tampilkan* lives where every form's Simpan lives — in `.ph-act`, top right
 * of the sticky header — while the fields it runs sit in the filter below. The
 * two are different parts of the page, so this context joins them: the filter
 * says what running means and whether it may, the button in the header does it.
 *
 * A filter registers through `useReportRun`; the button renders nothing until
 * one has, so a Report View without a filter carries no dead button.
 */
type RunStatus = { blocked: boolean; hint?: string; pending: boolean };

type RunContextValue = {
  status: RunStatus | null;
  setStatus: (s: RunStatus | null) => void;
  setRun: (run: (() => void) | null) => void;
  run: () => void;
};

const RunContext = createContext<RunContextValue | null>(null);

export function ReportRunProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<RunStatus | null>(null);
  const runRef = useRef<(() => void) | null>(null);
  const setRun = useCallback((run: (() => void) | null) => {
    runRef.current = run;
  }, []);
  const run = useCallback(() => runRef.current?.(), []);
  const value = useMemo(() => ({ status, setStatus, setRun, run }), [status, setRun, run]);
  return <RunContext.Provider value={value}>{children}</RunContext.Provider>;
}

/** Called by a filter on every render: what running means, and whether it may. */
export function useReportRun(run: () => void, status: RunStatus) {
  const ctx = useContext(RunContext);
  const setRun = ctx?.setRun;
  const setStatus = ctx?.setStatus;
  const { blocked, hint, pending } = status;

  // The latest closure every render, so the button always runs what the
  // fields hold now rather than what they held when it first registered.
  useEffect(() => {
    setRun?.(run);
  });
  useEffect(() => {
    setStatus?.({ blocked, hint, pending });
  }, [setStatus, blocked, hint, pending]);
  useEffect(() => {
    return () => {
      setRun?.(null);
      setStatus?.(null);
    };
  }, [setRun, setStatus]);
}

/** The header's primary action: runs whatever the filter below registered. */
export function ReportRunButton() {
  const ctx = useContext(RunContext);
  if (!ctx?.status) return null;
  const { blocked, hint, pending } = ctx.status;
  return (
    <button
      className="btn primary"
      onClick={ctx.run}
      disabled={blocked || pending}
      title={blocked ? hint : undefined}
    >
      <Icon name="srch" size={13} /> Tampilkan
    </button>
  );
}

/**
 * The Company, as the first field of a report's first row.
 *
 * It navigates the moment it changes, unlike everything after it: the pickers
 * that follow — accounts, cash resources, Partners — belong to the Company, so
 * their options have to be read again before anything else can be chosen. A
 * reader who may see one Company is shown nothing, because one option is not a
 * choice.
 */
export function ReportCompany({
  options,
  selectedId,
}: {
  options: { id: number; label: string; name: string }[];
  selectedId: number;
}) {
  if (options.length < 2) return null;
  return (
    <>
      <span className="rl">Company</span>
      <div className="rf">
        <CompanyFilter options={options} selectedId={selectedId} />
      </div>
    </>
  );
}
